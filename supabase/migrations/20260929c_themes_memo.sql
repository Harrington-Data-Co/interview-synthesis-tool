-- Phase 4: themes and the findings memo.
--
-- Run once in the Supabase SQL editor on a database that has
-- 20260929b_notes.sql applied. A fresh database doesn't need this:
-- schema.sql already includes everything below.
--
-- Adds:
--   - Themes as proposals a person confirms. Claude's land 'proposed'; the
--     memo may only rest on 'confirmed' ones. Every member code belongs to
--     the theme's project. theme_run / theme_rejection as for coding.
--   - The human layer for themes: create, update, confirm, merge, split,
--     delete, revert — each logged with before and after values.
--   - Memo templates, like note templates: product_template gains a library
--     and project copies; product_section gains an author and may fill from
--     'themes' or code types.
--   - Memos as rows: product_item cites themes (product_item_theme) and codes
--     (product_item_code); each cites at least one of its own project, checked
--     at commit. product_run / product_item_rejection, and a logged human
--     layer, as for notes.
--   - Evidence can't be pulled from under a memo: a theme or code a memo
--     cites can't be deleted. Deleting a whole project still cascades.

begin;

-- ─── themes ──────────────────────────────────────────────────────────────

create table theme_run (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references project (id) on delete cascade,
  status         run_status not null default 'running',
  model          text not null,
  served_by      text,
  effort         text,
  prompt_version text not null,
  started_by     uuid not null references seat (user_id),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  input_tokens   integer,
  output_tokens  integer,
  cost_usd       numeric(10, 4),
  proposed       integer,
  accepted       integer,
  rejected       integer,
  error          text
);
create index on theme_run (project_id, started_at desc);
create trigger theme_run_keep_started_by
  before update on theme_run
  for each row execute function keep_attribution('started_by');

alter table theme
  add column description  text,
  add column origin       code_origin not null default 'human',
  add column run_id       uuid references theme_run (id) on delete set null,
  add column status       text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  add column confirmed_by uuid references seat (user_id),
  add column confirmed_at timestamptz,
  add constraint theme_title_present check (btrim(title) <> '');

create table theme_rejection (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references theme_run (id) on delete cascade,
  project_id     uuid not null references project (id) on delete cascade,
  proposal       jsonb not null,
  reason         text not null,
  resolution     text check (resolution in ('fixed', 'dismissed')),
  fixed_theme_id uuid references theme (id) on delete set null,
  resolved_by    uuid references seat (user_id),
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index on theme_rejection (project_id) where resolution is null;

-- A theme's codes come from its own project, and a merged code can't be
-- newly added (add the code it was merged into).
create or replace function check_theme_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c code%rowtype;
begin
  select * into c from code where id = new.code_id;
  if not exists (
    select 1 from theme th join transcript t on t.project_id = th.project_id
    where th.id = new.theme_id and t.id = c.transcript_id
  ) then
    raise exception 'A theme can only include codes from its own project.';
  end if;
  if c.merged_into_id is not null then
    raise exception '% was merged into another code; add that one instead.', c.ref;
  end if;
  return new;
end;
$$;

create trigger theme_code_checked
  before insert on theme_code
  for each row execute function check_theme_code();

create or replace function next_theme_ref(p_project_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select 'TH-' || (coalesce(max(nullif(regexp_replace(ref, '^TH-', ''), '')::integer), 0) + 1)::text
  from theme where project_id = p_project_id and ref ~ '^TH-[0-9]+$';
$$;

create or replace function theme_snapshot(p_theme_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'title', th.title, 'description', th.description, 'status', th.status,
    'code_ids', coalesce((select jsonb_agg(tc.code_id order by tc.code_id) from theme_code tc where tc.theme_id = th.id), '[]')
  )
  from theme th where th.id = p_theme_id;
$$;

create or replace function log_theme_change(p_theme_id uuid, p_project_id uuid, p_text text, p_before jsonb, p_after jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into edit (object_type, object_id, text, before, after, edited_by)
  values ('theme', p_theme_id, p_text, p_before, p_after, auth.uid());
  insert into activity (project_id, actor, verb, object)
  values (p_project_id, auth.uid(), 'edited themes', p_text);
end;
$$;

-- Replace a theme's codes with exactly these (at least one).
create or replace function set_theme_codes(p_theme_id uuid, p_code_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(cardinality(p_code_ids), 0) = 0 then
    raise exception 'A theme needs at least one code.';
  end if;
  delete from theme_code where theme_id = p_theme_id and not code_id = any(p_code_ids);
  insert into theme_code (theme_id, code_id)
  select p_theme_id, c from unnest(p_code_ids) c
  where not exists (select 1 from theme_code where theme_id = p_theme_id and code_id = c);
end;
$$;

create or replace function start_theme_run(p_project_id uuid, p_model text, p_effort text, p_prompt_version text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can propose themes.' using errcode = '42501';
  end if;
  if not exists (select 1 from project where id = p_project_id) then
    raise exception 'Unknown project.' using errcode = 'P0002';
  end if;
  update theme_run set status = 'failed', finished_at = now(), error = 'No result reported; presumed interrupted.'
  where project_id = p_project_id and status = 'running' and started_at < now() - interval '15 minutes';
  if exists (select 1 from theme_run where project_id = p_project_id and status = 'running') then
    raise exception 'Themes are already being proposed for this project.';
  end if;
  insert into theme_run (project_id, model, effort, prompt_version, started_by)
  values (p_project_id, p_model, p_effort, p_prompt_version, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Saves Claude's proposed themes, each on its own: one the rules refuse
-- becomes a rejection instead of sinking the run.
create or replace function save_theme_run(p_run_id uuid, p_themes jsonb, p_rejections jsonb default '[]', p_usage jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r          theme_run%rowtype;
  th         jsonb;
  v_theme    uuid;
  v_accepted integer := 0;
  v_rejected integer := 0;
begin
  select * into r from theme_run where id = p_run_id for update;
  if not found then
    raise exception 'Unknown theme run.' using errcode = 'P0002';
  end if;
  if r.started_by is distinct from auth.uid() then
    raise exception 'Only the person who started a run can save it.' using errcode = '42501';
  end if;
  if r.status <> 'running' then
    raise exception 'This run has already finished.';
  end if;

  for th in select * from jsonb_array_elements(p_themes) loop
    begin
      insert into theme (project_id, ref, title, description, ordinal, origin, run_id, status, created_by)
      values (r.project_id, next_theme_ref(r.project_id), btrim(th ->> 'title'), nullif(btrim(th ->> 'description'), ''),
              coalesce((select max(ordinal) + 1 from theme where project_id = r.project_id), 1),
              'claude', p_run_id, 'proposed', r.started_by)
      returning id into v_theme;
      perform set_theme_codes(v_theme, array(select x::uuid from jsonb_array_elements_text(th -> 'code_ids') x));
      v_accepted := v_accepted + 1;
    exception when others then
      insert into theme_rejection (run_id, project_id, proposal, reason) values (p_run_id, r.project_id, th, sqlerrm);
      v_rejected := v_rejected + 1;
    end;
  end loop;

  insert into theme_rejection (run_id, project_id, proposal, reason)
  select p_run_id, r.project_id, x -> 'proposal', x ->> 'reason' from jsonb_array_elements(p_rejections) x;
  v_rejected := v_rejected + jsonb_array_length(p_rejections);

  update theme_run set
    status = 'done', finished_at = now(),
    served_by = p_usage ->> 'served_by',
    input_tokens = (p_usage ->> 'input_tokens')::integer,
    output_tokens = (p_usage ->> 'output_tokens')::integer,
    cost_usd = (p_usage ->> 'cost_usd')::numeric,
    proposed = v_accepted + v_rejected, accepted = v_accepted, rejected = v_rejected
  where id = p_run_id;
  insert into activity (project_id, actor, verb, object)
  values (r.project_id, r.started_by, 'proposed themes', format('%s themes, %s for review', v_accepted, v_rejected));
  return jsonb_build_object('accepted', v_accepted, 'rejected', v_rejected);
end;
$$;

create or replace function fail_theme_run(p_run_id uuid, p_error text, p_usage jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  update theme_run set
    status = 'failed', finished_at = now(), error = left(p_error, 2000),
    served_by = p_usage ->> 'served_by',
    input_tokens = (p_usage ->> 'input_tokens')::integer,
    output_tokens = (p_usage ->> 'output_tokens')::integer,
    cost_usd = (p_usage ->> 'cost_usd')::numeric
  where id = p_run_id and started_by = auth.uid() and status = 'running';
end;
$$;

-- Clears Claude's unconfirmed proposals (and open rejections) before a new
-- run. Confirmed themes, and any theme a memo cites, stay.
create or replace function discard_proposed_themes(p_project_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can discard themes.' using errcode = '42501';
  end if;
  delete from theme th
  where th.project_id = p_project_id and th.origin = 'claude' and th.status = 'proposed'
    and not exists (select 1 from product_item_theme pit where pit.theme_id = th.id);
  get diagnostics v_n = row_count;
  delete from theme_rejection where project_id = p_project_id and resolution is null;
  return v_n;
end;
$$;

-- A person's theme: confirmed by its author. Passing a rejection marks it fixed.
create or replace function create_theme(
  p_project_id uuid, p_title text, p_description text, p_code_ids uuid[], p_rejection_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can create themes.' using errcode = '42501';
  end if;
  insert into theme (project_id, ref, title, description, ordinal, origin, status, confirmed_by, confirmed_at, created_by)
  values (p_project_id, next_theme_ref(p_project_id), btrim(p_title), nullif(btrim(p_description), ''),
          coalesce((select max(ordinal) + 1 from theme where project_id = p_project_id), 1),
          'human', 'confirmed', auth.uid(), now(), auth.uid())
  returning id into v_id;
  perform set_theme_codes(v_id, p_code_ids);
  update theme_code set confirmed = true, confirmed_by = auth.uid() where theme_id = v_id;
  if p_rejection_id is not null then
    update theme_rejection set resolution = 'fixed', fixed_theme_id = v_id, resolved_by = auth.uid(), resolved_at = now()
    where id = p_rejection_id and project_id = p_project_id and resolution is null;
  end if;
  perform log_theme_change(v_id, p_project_id, format('created %s', (select ref from theme where id = v_id)), null, theme_snapshot(v_id));
  return v_id;
end;
$$;

-- Change a theme's title, description and/or codes. Present keys apply.
create or replace function update_theme(p_theme_id uuid, p_changes jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  th       theme%rowtype;
  v_before jsonb;
  v_after  jsonb;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit themes.' using errcode = '42501';
  end if;
  select * into th from theme where id = p_theme_id for update;
  if not found then
    raise exception 'Unknown theme.' using errcode = 'P0002';
  end if;
  v_before := theme_snapshot(p_theme_id);
  if p_changes ? 'title' then
    update theme set title = btrim(p_changes ->> 'title') where id = p_theme_id;
  end if;
  if p_changes ? 'description' then
    update theme set description = nullif(btrim(p_changes ->> 'description'), '') where id = p_theme_id;
  end if;
  if p_changes ? 'code_ids' then
    perform set_theme_codes(p_theme_id, array(select x::uuid from jsonb_array_elements_text(p_changes -> 'code_ids') x));
    if th.status = 'confirmed' then
      update theme_code set confirmed = true, confirmed_by = coalesce(confirmed_by, auth.uid()) where theme_id = p_theme_id;
    end if;
  end if;
  v_after := theme_snapshot(p_theme_id);
  if v_after = v_before then
    return 0;
  end if;
  perform log_theme_change(p_theme_id, th.project_id, format('%s: edited', th.ref), v_before, v_after);
  return 1;
end;
$$;

-- Confirm (or un-confirm) a theme. Only confirmed themes feed the memo.
create or replace function confirm_theme(p_theme_id uuid, p_confirmed boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare
  th theme%rowtype;
  v_before jsonb;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can confirm themes.' using errcode = '42501';
  end if;
  select * into th from theme where id = p_theme_id for update;
  if not found then
    raise exception 'Unknown theme.' using errcode = 'P0002';
  end if;
  if (th.status = 'confirmed') = p_confirmed then
    return;
  end if;
  v_before := theme_snapshot(p_theme_id);
  update theme set
    status = case when p_confirmed then 'confirmed' else 'proposed' end,
    confirmed_by = case when p_confirmed then auth.uid() end,
    confirmed_at = case when p_confirmed then now() end
  where id = p_theme_id;
  update theme_code set confirmed = p_confirmed, confirmed_by = case when p_confirmed then auth.uid() end
  where theme_id = p_theme_id;
  perform log_theme_change(p_theme_id, th.project_id,
    format('%s %s %s', case when p_confirmed then 'confirmed' else 'un-confirmed' end, th.ref, th.title),
    v_before, theme_snapshot(p_theme_id));
end;
$$;

-- Fold themes into one: their codes join it, and they go. Refused for a
-- theme a memo cites (edit the memo first, so its evidence stays true).
create or replace function merge_themes(p_keep uuid, p_merge uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  k theme%rowtype;
  m theme%rowtype;
  v_before jsonb;
  n integer := 0;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can merge themes.' using errcode = '42501';
  end if;
  select * into k from theme where id = p_keep for update;
  if not found then
    raise exception 'Unknown theme.' using errcode = 'P0002';
  end if;
  v_before := theme_snapshot(p_keep);
  for m in select * from theme where id = any(p_merge) and id <> p_keep for update loop
    if m.project_id <> k.project_id then
      raise exception 'Themes can only be merged within one project.';
    end if;
    if exists (select 1 from product_item_theme where theme_id = m.id) then
      raise exception '% is cited by a memo; edit the memo before merging it away.', m.ref;
    end if;
    insert into theme_code (theme_id, code_id, confirmed, confirmed_by)
    select p_keep, tc.code_id, k.status = 'confirmed', case when k.status = 'confirmed' then auth.uid() end
    from theme_code tc join code c on c.id = tc.code_id
    where tc.theme_id = m.id and c.merged_into_id is null
      and not exists (select 1 from theme_code x where x.theme_id = p_keep and x.code_id = tc.code_id);
    perform log_theme_change(m.id, m.project_id, format('merged %s into %s', m.ref, k.ref), theme_snapshot(m.id), null);
    delete from theme where id = m.id;
    n := n + 1;
  end loop;
  if n > 0 then
    perform log_theme_change(p_keep, k.project_id, format('%s: merged in %s', k.ref, n), v_before, theme_snapshot(p_keep));
  end if;
  return n;
end;
$$;

-- Move some of a theme's codes into a new theme, which takes the original's
-- status. Both must keep at least one code.
create or replace function split_theme(p_theme_id uuid, p_code_ids uuid[], p_title text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  th theme%rowtype;
  v_before jsonb;
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can split themes.' using errcode = '42501';
  end if;
  select * into th from theme where id = p_theme_id for update;
  if not found then
    raise exception 'Unknown theme.' using errcode = 'P0002';
  end if;
  if coalesce(cardinality(p_code_ids), 0) = 0
     or not exists (select 1 from theme_code where theme_id = p_theme_id and not code_id = any(p_code_ids)) then
    raise exception 'A split needs some codes to move and some to stay.';
  end if;
  v_before := theme_snapshot(p_theme_id);
  insert into theme (project_id, ref, title, ordinal, origin, status, confirmed_by, confirmed_at, created_by)
  values (th.project_id, next_theme_ref(th.project_id), btrim(p_title), th.ordinal, 'human', th.status,
          case when th.status = 'confirmed' then auth.uid() end, case when th.status = 'confirmed' then now() end, auth.uid())
  returning id into v_id;
  insert into theme_code (theme_id, code_id, confirmed, confirmed_by)
  select v_id, tc.code_id, tc.confirmed, tc.confirmed_by from theme_code tc
  where tc.theme_id = p_theme_id and tc.code_id = any(p_code_ids);
  delete from theme_code where theme_id = p_theme_id and code_id = any(p_code_ids);
  perform log_theme_change(p_theme_id, th.project_id, format('%s: split out %s', th.ref, (select ref from theme where id = v_id)),
                           v_before, theme_snapshot(p_theme_id));
  perform log_theme_change(v_id, th.project_id, format('created %s from %s', (select ref from theme where id = v_id), th.ref),
                           null, theme_snapshot(v_id));
  return v_id;
end;
$$;

create or replace function delete_theme(p_theme_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  th theme%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can delete themes.' using errcode = '42501';
  end if;
  select * into th from theme where id = p_theme_id for update;
  if not found then
    raise exception 'Unknown theme.' using errcode = 'P0002';
  end if;
  if exists (select 1 from product_item_theme where theme_id = p_theme_id) then
    raise exception '% is cited by a memo; edit the memo before deleting it.', th.ref;
  end if;
  perform log_theme_change(p_theme_id, th.project_id, format('deleted %s', th.ref), theme_snapshot(p_theme_id), null);
  delete from theme where id = p_theme_id;
end;
$$;

-- Undo a theme's latest edit: title, description, status and codes.
create or replace function revert_last_theme_edit(p_theme_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  e  edit%rowtype;
  th theme%rowtype;
  b  jsonb;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can revert edits.' using errcode = '42501';
  end if;
  select * into e from edit
  where object_type = 'theme' and object_id = p_theme_id and not reverted and before is not null and after is not null
  order by edited_at desc limit 1 for update;
  if not found then
    raise exception 'There''s no edit to revert on this theme.';
  end if;
  select * into th from theme where id = p_theme_id for update;
  b := e.before;
  update theme set
    title = b ->> 'title', description = b ->> 'description', status = b ->> 'status',
    confirmed_by = case when b ->> 'status' = 'confirmed' then coalesce(th.confirmed_by, auth.uid()) end,
    confirmed_at = case when b ->> 'status' = 'confirmed' then coalesce(th.confirmed_at, now()) end
  where id = p_theme_id;
  delete from theme_code where theme_id = p_theme_id
    and not code_id in (select x::uuid from jsonb_array_elements_text(b -> 'code_ids') x);
  -- Codes merged away since can't come back; the rest are restored.
  insert into theme_code (theme_id, code_id)
  select p_theme_id, x::uuid from jsonb_array_elements_text(b -> 'code_ids') x
  join code c on c.id = x::uuid and c.merged_into_id is null
  where not exists (select 1 from theme_code where theme_id = p_theme_id and code_id = x::uuid);
  update edit set reverted = true where id = e.id;
  perform log_theme_change(p_theme_id, th.project_id, format('reverted: %s', e.text), e.after, theme_snapshot(p_theme_id));
  update edit set reverted = true
  where id = (select id from edit where object_type = 'theme' and object_id = p_theme_id order by edited_at desc limit 1);
  return e.text;
end;
$$;

create or replace function dismiss_theme_rejection(p_rejection_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_edit() then
    raise exception 'Only editors and owners can dismiss proposals.' using errcode = '42501';
  end if;
  update theme_rejection set resolution = 'dismissed', resolved_by = auth.uid(), resolved_at = now()
  where id = p_rejection_id and resolution is null;
end;
$$;

-- A section that has items can't be deleted — unless its template is being
-- deleted (as when a whole project goes), which the parent's absence gives
-- away, just as for transcript lines. The foreign key itself can then
-- cascade; the guard lives here, where deleting one section is decided.
create or replace function refuse_section_delete_with_items()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'note_section' then
    if exists (select 1 from note_template where id = old.template_id)
       and exists (select 1 from note_item where section_id = old.id) then
      raise exception 'Note items sit in "%", so it can''t be removed. Move them first.', old.name;
    end if;
  elsif exists (select 1 from product_template where id = old.template_id)
        and exists (select 1 from product_item where section_id = old.id) then
    raise exception 'Memo paragraphs sit in "%", so it can''t be removed. Move them first.', old.name;
  end if;
  return old;
end;
$$;

alter table note_item drop constraint note_item_section_id_fkey;
alter table note_item
  add constraint note_item_section_id_fkey foreign key (section_id) references note_section (id) on delete cascade;
create trigger note_section_keeps_items
  before delete on note_section
  for each row execute function refuse_section_delete_with_items();

-- ─── memo templates: like note templates ─────────────────────────────────

alter table product_template
  add column copied_from_id uuid references product_template (id) on delete set null,
  add constraint product_template_name_present check (btrim(name) <> '');

alter table product_section
  add column created_by uuid not null default auth.uid() references seat (user_id),
  add constraint product_section_name_present check (btrim(name) <> ''),
  add constraint product_section_requires_known check (
    requires <@ array['themes', 'Pain', 'Step', 'Tool', 'Goal', 'Constraint', 'Question', 'Quote', 'Stakeholder']::text[]
  );
alter table product_section drop constraint product_section_template_id_ordinal_key;
alter table product_section
  add constraint product_section_template_id_ordinal_key unique (template_id, ordinal) deferrable initially deferred;
create trigger product_section_keep_created_by
  before update on product_section
  for each row execute function keep_attribution('created_by');
drop policy if exists product_section_insert on product_section;
create policy product_section_insert on product_section
  for insert to authenticated with check (can_edit() and created_by = auth.uid());

create or replace function copy_product_template(p_template_id uuid, p_project_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  src product_template%rowtype;
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can add templates.' using errcode = '42501';
  end if;
  select * into src from product_template where id = p_template_id;
  if not found then
    raise exception 'Unknown template.' using errcode = 'P0002';
  end if;
  if p_project_id is not null and not exists (select 1 from project where id = p_project_id) then
    raise exception 'Unknown project.' using errcode = 'P0002';
  end if;
  insert into product_template (project_id, name, kind, scope, copied_from_id, created_by)
  values (p_project_id, case when p_project_id is null then src.name || ' (copy)' else src.name end,
          src.kind, src.scope, src.id, auth.uid())
  returning id into v_id;
  insert into product_section (template_id, ordinal, name, requires, note, created_by)
  select v_id, ordinal, name, requires, note, auth.uid() from product_section where template_id = src.id;
  return v_id;
end;
$$;

-- ─── memos ───────────────────────────────────────────────────────────────

create table product_run (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references project (id) on delete cascade,
  template_id    uuid not null references product_template (id) on delete cascade,
  status         run_status not null default 'running',
  model          text not null,
  served_by      text,
  effort         text,
  prompt_version text not null,
  started_by     uuid not null references seat (user_id),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  input_tokens   integer,
  output_tokens  integer,
  cost_usd       numeric(10, 4),
  proposed       integer,
  accepted       integer,
  rejected       integer,
  error          text
);
create index on product_run (project_id, template_id, started_at desc);
create trigger product_run_keep_started_by
  before update on product_run
  for each row execute function keep_attribution('started_by');

-- One memo per template per project; its title is its headline.
alter table product
  add column title text,
  alter column content set default '{}';
alter table product add constraint product_project_template_key unique (project_id, template_id);

-- Citations cascade: themes and codes are only ever deleted through
-- delete_theme() / delete_code(), which refuse while a memo cites them, or
-- by a whole project or transcript going. Sections are guarded by
-- refuse_section_delete_with_items().
create table product_item (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references product (id) on delete cascade,
  section_id uuid not null references product_section (id) on delete cascade,
  ordinal    integer not null,
  text       text not null check (btrim(text) <> ''),
  origin     code_origin not null default 'human',
  run_id     uuid references product_run (id) on delete set null,
  created_by uuid not null default auth.uid() references seat (user_id),
  created_at timestamptz not null default now()
);
create index on product_item (product_id);

create table product_item_theme (
  item_id  uuid not null references product_item (id) on delete cascade,
  theme_id uuid not null references theme (id) on delete cascade,
  primary key (item_id, theme_id)
);
create table product_item_code (
  item_id uuid not null references product_item (id) on delete cascade,
  code_id uuid not null references code (id) on delete cascade,
  primary key (item_id, code_id)
);
create index on product_item_theme (theme_id);
create index on product_item_code (code_id);

create table product_item_rejection (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references product_run (id) on delete cascade,
  product_id    uuid not null references product (id) on delete cascade,
  proposal      jsonb not null,
  reason        text not null,
  resolution    text check (resolution in ('fixed', 'dismissed')),
  fixed_item_id uuid references product_item (id) on delete set null,
  resolved_by   uuid references seat (user_id),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index on product_item_rejection (product_id) where resolution is null;

create trigger product_section_keeps_items
  before delete on product_section
  for each row execute function refuse_section_delete_with_items();

create or replace function check_product_item_section()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from product p join product_section s on s.template_id = p.template_id
    where p.id = new.product_id and s.id = new.section_id
  ) then
    raise exception 'That section isn''t part of this memo''s template.';
  end if;
  return new;
end;
$$;
create trigger product_item_section_checked
  before insert or update of product_id, section_id on product_item
  for each row execute function check_product_item_section();

-- Citations: themes and codes of the memo's own project. For Claude's items,
-- a section that fills from themes may only cite confirmed themes, and codes
-- must be of the section's code types — or members of a theme it cites.
create or replace function check_product_citation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  i          product_item%rowtype;
  v_project  uuid;
  v_requires text[];
  th         theme%rowtype;
  c          code%rowtype;
begin
  select * into i from product_item where id = new.item_id;
  select p.project_id into v_project from product p where p.id = i.product_id;
  select requires into v_requires from product_section where id = i.section_id;

  if tg_table_name = 'product_item_theme' then
    select * into th from theme where id = new.theme_id;
    if th.project_id is distinct from v_project then
      raise exception 'A memo can only cite themes from its own project.';
    end if;
    if i.origin = 'claude' and th.status <> 'confirmed' then
      raise exception '% isn''t confirmed; the memo is written from confirmed themes only.', th.ref;
    end if;
    if i.origin = 'claude' and cardinality(v_requires) > 0 and not 'themes' = any(v_requires) then
      raise exception 'This section doesn''t fill from themes.';
    end if;
  else
    select * into c from code where id = new.code_id;
    if not exists (select 1 from transcript t where t.id = c.transcript_id and t.project_id = v_project) then
      raise exception 'A memo can only cite codes from its own project.';
    end if;
    if c.merged_into_id is not null then
      raise exception '% was merged into another code; cite that one instead.', c.ref;
    end if;
    if i.origin = 'claude' and cardinality(v_requires) > 0 and not c.type::text = any(v_requires)
       and not exists (
         select 1 from product_item_theme pit join theme_code tc on tc.theme_id = pit.theme_id
         where pit.item_id = new.item_id and tc.code_id = new.code_id
       ) then
      raise exception '% (%) isn''t a type this section fills from, nor part of a theme it cites.', c.ref, c.type;
    end if;
  end if;
  return new;
end;
$$;
create trigger product_item_theme_checked before insert on product_item_theme
  for each row execute function check_product_citation();
create trigger product_item_code_checked before insert on product_item_code
  for each row execute function check_product_citation();

-- Every memo paragraph cites at least one theme or code, checked at commit.
create or replace function require_product_citation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_item uuid;
begin
  if tg_table_name = 'product_item' then
    v_item := new.id;
  else
    v_item := old.item_id;
  end if;
  if exists (select 1 from product_item where id = v_item)
     and not exists (select 1 from product_item_theme where item_id = v_item)
     and not exists (select 1 from product_item_code where item_id = v_item) then
    raise exception 'Every memo paragraph must cite at least one theme or code.';
  end if;
  return null;
end;
$$;
create constraint trigger product_item_needs_citation after insert on product_item
  deferrable initially deferred for each row execute function require_product_citation();
create constraint trigger product_item_theme_keeps_citation after delete on product_item_theme
  deferrable initially deferred for each row execute function require_product_citation();
create constraint trigger product_item_code_keeps_citation after delete on product_item_code
  deferrable initially deferred for each row execute function require_product_citation();

create or replace function product_item_snapshot(p_item_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'section_id', i.section_id, 'ordinal', i.ordinal, 'text', i.text,
    'theme_ids', coalesce((select jsonb_agg(x.theme_id order by x.theme_id) from product_item_theme x where x.item_id = i.id), '[]'),
    'code_ids', coalesce((select jsonb_agg(x.code_id order by x.code_id) from product_item_code x where x.item_id = i.id), '[]')
  )
  from product_item i where i.id = p_item_id;
$$;

create or replace function log_product_change(p_object uuid, p_product_id uuid, p_text text, p_before jsonb, p_after jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into edit (object_type, object_id, text, before, after, edited_by)
  values ('product_item', p_object, p_text, p_before, p_after, auth.uid());
  insert into activity (project_id, actor, verb, object)
  select p.project_id, auth.uid(), 'edited the memo', p_text from product p where p.id = p_product_id;
end;
$$;

-- Replace an item's citations with exactly these themes and codes.
create or replace function set_product_citations(p_item_id uuid, p_theme_ids uuid[], p_code_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(cardinality(p_theme_ids), 0) + coalesce(cardinality(p_code_ids), 0) = 0 then
    raise exception 'Every memo paragraph must cite at least one theme or code.';
  end if;
  delete from product_item_code where item_id = p_item_id and not code_id = any(coalesce(p_code_ids, '{}'));
  delete from product_item_theme where item_id = p_item_id and not theme_id = any(coalesce(p_theme_ids, '{}'));
  -- Themes first: a code is allowed partly by being in a cited theme.
  insert into product_item_theme (item_id, theme_id)
  select p_item_id, t from unnest(coalesce(p_theme_ids, '{}')) t
  where not exists (select 1 from product_item_theme where item_id = p_item_id and theme_id = t);
  insert into product_item_code (item_id, code_id)
  select p_item_id, c from unnest(coalesce(p_code_ids, '{}')) c
  where not exists (select 1 from product_item_code where item_id = p_item_id and code_id = c);
end;
$$;

create or replace function start_product_run(p_project_id uuid, p_template_id uuid, p_model text, p_effort text, p_prompt_version text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can write memos.' using errcode = '42501';
  end if;
  if not exists (select 1 from product_template where id = p_template_id and project_id = p_project_id) then
    raise exception 'That template isn''t one of this project''s templates.';
  end if;
  update product_run set status = 'failed', finished_at = now(), error = 'No result reported; presumed interrupted.'
  where project_id = p_project_id and template_id = p_template_id and status = 'running'
    and started_at < now() - interval '15 minutes';
  if exists (select 1 from product_run where project_id = p_project_id and template_id = p_template_id and status = 'running') then
    raise exception 'This memo is already being written.';
  end if;
  insert into product_run (project_id, template_id, model, effort, prompt_version, started_by)
  values (p_project_id, p_template_id, p_model, p_effort, p_prompt_version, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Saves a written memo: its headline, then each paragraph on its own. People's
-- paragraphs on an existing memo are kept; Claude's are added after them.
create or replace function save_product_run(
  p_run_id uuid, p_title text, p_items jsonb, p_rejections jsonb default '[]', p_usage jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r          product_run%rowtype;
  v_product  uuid;
  it         jsonb;
  v_item     uuid;
  v_accepted integer := 0;
  v_rejected integer := 0;
begin
  select * into r from product_run where id = p_run_id for update;
  if not found then
    raise exception 'Unknown memo run.' using errcode = 'P0002';
  end if;
  if r.started_by is distinct from auth.uid() then
    raise exception 'Only the person who started a run can save it.' using errcode = '42501';
  end if;
  if r.status <> 'running' then
    raise exception 'This run has already finished.';
  end if;

  insert into product (project_id, template_id, title, rendered_by)
  values (r.project_id, r.template_id, nullif(btrim(p_title), ''), r.started_by)
  on conflict (project_id, template_id) do update
    set title = coalesce(nullif(btrim(excluded.title), ''), product.title), rendered_at = now()
  returning id into v_product;

  for it in select * from jsonb_array_elements(p_items) loop
    begin
      insert into product_item (product_id, section_id, ordinal, text, origin, run_id, created_by)
      values (v_product, (it ->> 'section_id')::uuid,
              coalesce((select max(ordinal) + 1 from product_item where product_id = v_product and section_id = (it ->> 'section_id')::uuid), 1),
              btrim(it ->> 'text'), 'claude', p_run_id, r.started_by)
      returning id into v_item;
      perform set_product_citations(v_item,
        array(select x::uuid from jsonb_array_elements_text(coalesce(it -> 'theme_ids', '[]')) x),
        array(select x::uuid from jsonb_array_elements_text(coalesce(it -> 'code_ids', '[]')) x));
      v_accepted := v_accepted + 1;
    exception when others then
      insert into product_item_rejection (run_id, product_id, proposal, reason) values (p_run_id, v_product, it, sqlerrm);
      v_rejected := v_rejected + 1;
    end;
  end loop;

  insert into product_item_rejection (run_id, product_id, proposal, reason)
  select p_run_id, v_product, x -> 'proposal', x ->> 'reason' from jsonb_array_elements(p_rejections) x;
  v_rejected := v_rejected + jsonb_array_length(p_rejections);

  update product_run set
    status = 'done', finished_at = now(),
    served_by = p_usage ->> 'served_by',
    input_tokens = (p_usage ->> 'input_tokens')::integer,
    output_tokens = (p_usage ->> 'output_tokens')::integer,
    cost_usd = (p_usage ->> 'cost_usd')::numeric,
    proposed = v_accepted + v_rejected, accepted = v_accepted, rejected = v_rejected
  where id = p_run_id;
  insert into activity (project_id, actor, verb, object)
  values (r.project_id, r.started_by, 'wrote the memo', format('%s paragraphs, %s for review', v_accepted, v_rejected));
  return jsonb_build_object('product_id', v_product, 'accepted', v_accepted, 'rejected', v_rejected);
end;
$$;

create or replace function fail_product_run(p_run_id uuid, p_error text, p_usage jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  update product_run set
    status = 'failed', finished_at = now(), error = left(p_error, 2000),
    served_by = p_usage ->> 'served_by',
    input_tokens = (p_usage ->> 'input_tokens')::integer,
    output_tokens = (p_usage ->> 'output_tokens')::integer,
    cost_usd = (p_usage ->> 'cost_usd')::numeric
  where id = p_run_id and started_by = auth.uid() and status = 'running';
end;
$$;

create or replace function discard_claude_product_items(p_product_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can discard memo paragraphs.' using errcode = '42501';
  end if;
  delete from product_item where product_id = p_product_id and origin = 'claude';
  get diagnostics v_n = row_count;
  delete from product_item_rejection where product_id = p_product_id and resolution is null;
  return v_n;
end;
$$;

create or replace function create_product_item(
  p_product_id uuid, p_section_id uuid, p_text text, p_theme_ids uuid[], p_code_ids uuid[], p_rejection_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit memos.' using errcode = '42501';
  end if;
  insert into product_item (product_id, section_id, ordinal, text, origin, created_by)
  values (p_product_id, p_section_id,
          coalesce((select max(ordinal) + 1 from product_item where product_id = p_product_id and section_id = p_section_id), 1),
          btrim(p_text), 'human', auth.uid())
  returning id into v_id;
  perform set_product_citations(v_id, p_theme_ids, p_code_ids);
  if p_rejection_id is not null then
    update product_item_rejection set resolution = 'fixed', fixed_item_id = v_id, resolved_by = auth.uid(), resolved_at = now()
    where id = p_rejection_id and product_id = p_product_id and resolution is null;
  end if;
  perform log_product_change(v_id, p_product_id, 'added a paragraph', null, product_item_snapshot(v_id));
  return v_id;
end;
$$;

create or replace function update_product_item(p_item_id uuid, p_changes jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  i        product_item%rowtype;
  v_before jsonb;
  v_after  jsonb;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit memos.' using errcode = '42501';
  end if;
  select * into i from product_item where id = p_item_id for update;
  if not found then
    raise exception 'Unknown paragraph.' using errcode = 'P0002';
  end if;
  v_before := product_item_snapshot(p_item_id);
  if p_changes ? 'text' then
    update product_item set text = btrim(p_changes ->> 'text') where id = p_item_id;
  end if;
  if p_changes ? 'section_id' and (p_changes ->> 'section_id')::uuid is distinct from i.section_id then
    update product_item set section_id = (p_changes ->> 'section_id')::uuid,
      ordinal = coalesce((select max(ordinal) + 1 from product_item where product_id = i.product_id and section_id = (p_changes ->> 'section_id')::uuid), 1)
    where id = p_item_id;
  end if;
  if p_changes ? 'theme_ids' or p_changes ? 'code_ids' then
    perform set_product_citations(p_item_id,
      case when p_changes ? 'theme_ids' then array(select x::uuid from jsonb_array_elements_text(p_changes -> 'theme_ids') x)
           else array(select theme_id from product_item_theme where item_id = p_item_id) end,
      case when p_changes ? 'code_ids' then array(select x::uuid from jsonb_array_elements_text(p_changes -> 'code_ids') x)
           else array(select code_id from product_item_code where item_id = p_item_id) end);
  end if;
  v_after := product_item_snapshot(p_item_id);
  if v_after = v_before then
    return 0;
  end if;
  perform log_product_change(p_item_id, i.product_id, 'edited a paragraph', v_before, v_after);
  return 1;
end;
$$;

create or replace function move_product_item(p_item_id uuid, p_delta integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  i product_item%rowtype;
  o product_item%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit memos.' using errcode = '42501';
  end if;
  select * into i from product_item where id = p_item_id for update;
  if not found then
    raise exception 'Unknown paragraph.' using errcode = 'P0002';
  end if;
  select * into o from product_item
  where product_id = i.product_id and section_id = i.section_id
    and case when p_delta < 0 then ordinal < i.ordinal else ordinal > i.ordinal end
  order by case when p_delta < 0 then -ordinal else ordinal end limit 1;
  if found then
    update product_item set ordinal = o.ordinal where id = i.id;
    update product_item set ordinal = i.ordinal where id = o.id;
  end if;
end;
$$;

create or replace function delete_product_item(p_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  i product_item%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit memos.' using errcode = '42501';
  end if;
  select * into i from product_item where id = p_item_id for update;
  if not found then
    raise exception 'Unknown paragraph.' using errcode = 'P0002';
  end if;
  perform log_product_change(p_item_id, i.product_id, 'removed a paragraph', product_item_snapshot(p_item_id), null);
  delete from product_item where id = p_item_id;
end;
$$;

create or replace function revert_last_product_item_edit(p_item_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  e edit%rowtype;
  i product_item%rowtype;
  b jsonb;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can revert edits.' using errcode = '42501';
  end if;
  select * into e from edit
  where object_type = 'product_item' and object_id = p_item_id and not reverted and before is not null and after is not null
  order by edited_at desc limit 1 for update;
  if not found then
    raise exception 'There''s no edit to revert on this paragraph.';
  end if;
  select * into i from product_item where id = p_item_id for update;
  b := e.before;
  update product_item set text = b ->> 'text', section_id = (b ->> 'section_id')::uuid, ordinal = (b ->> 'ordinal')::integer
  where id = p_item_id;
  perform set_product_citations(p_item_id,
    array(select x::uuid from jsonb_array_elements_text(b -> 'theme_ids') x),
    array(select x::uuid from jsonb_array_elements_text(b -> 'code_ids') x));
  update edit set reverted = true where id = e.id;
  perform log_product_change(p_item_id, i.product_id, format('reverted: %s', e.text), e.after, b);
  update edit set reverted = true
  where id = (select id from edit where object_type = 'product_item' and object_id = p_item_id order by edited_at desc limit 1);
  return e.text;
end;
$$;

create or replace function set_product_title(p_product_id uuid, p_title text)
returns void language plpgsql security definer set search_path = public as $$
declare
  p product%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit memos.' using errcode = '42501';
  end if;
  select * into p from product where id = p_product_id for update;
  if not found then
    raise exception 'Unknown memo.' using errcode = 'P0002';
  end if;
  if nullif(btrim(p_title), '') is distinct from p.title then
    update product set title = nullif(btrim(p_title), '') where id = p_product_id;
    insert into edit (object_type, object_id, text, before, after, edited_by)
    values ('product', p_product_id, 'changed the headline', jsonb_build_object('title', p.title),
            jsonb_build_object('title', nullif(btrim(p_title), '')), auth.uid());
  end if;
end;
$$;

create or replace function dismiss_product_rejection(p_rejection_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_edit() then
    raise exception 'Only editors and owners can dismiss proposals.' using errcode = '42501';
  end if;
  update product_item_rejection set resolution = 'dismissed', resolved_by = auth.uid(), resolved_at = now()
  where id = p_rejection_id and resolution is null;
end;
$$;

-- Codes a memo cites can't be deleted either (codes already refuse deletion
-- while a note cites them).
create or replace function delete_code(p_code_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c code%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can delete codes.' using errcode = '42501';
  end if;
  select * into c from code where id = p_code_id for update;
  if not found then
    raise exception 'Unknown code.' using errcode = 'P0002';
  end if;
  if exists (select 1 from note_item_code where code_id = p_code_id) then
    raise exception '% is cited by an interview note; merge it into another code instead of deleting it.', c.ref;
  end if;
  if exists (select 1 from product_item_code where code_id = p_code_id) then
    raise exception '% is cited by the findings memo; merge it into another code instead of deleting it.', c.ref;
  end if;
  update code set merged_into_id = null where merged_into_id = p_code_id;
  perform log_code_change(c, format('deleted %s', c.ref), code_snapshot(c), null);
  delete from code where id = p_code_id;
end;
$$;

-- ─── grants and access ───────────────────────────────────────────────────

revoke execute on function
  start_theme_run, save_theme_run, fail_theme_run, discard_proposed_themes, create_theme, update_theme,
  confirm_theme, merge_themes, split_theme, delete_theme, revert_last_theme_edit, dismiss_theme_rejection,
  copy_product_template, start_product_run, save_product_run, fail_product_run, discard_claude_product_items,
  create_product_item, update_product_item, move_product_item, delete_product_item, revert_last_product_item_edit,
  set_product_title, dismiss_product_rejection,
  set_theme_codes, set_product_citations, log_theme_change, log_product_change
from public, anon;
grant execute on function
  start_theme_run, save_theme_run, fail_theme_run, discard_proposed_themes, create_theme, update_theme,
  confirm_theme, merge_themes, split_theme, delete_theme, revert_last_theme_edit, dismiss_theme_rejection,
  copy_product_template, start_product_run, save_product_run, fail_product_run, discard_claude_product_items,
  create_product_item, update_product_item, move_product_item, delete_product_item, revert_last_product_item_edit,
  set_product_title, dismiss_product_rejection
to authenticated;

-- Themes and memos are written only through the functions above. A whole
-- memo may still be deleted directly by an editor.
drop policy if exists theme_insert on theme;
drop policy if exists theme_update on theme;
drop policy if exists theme_delete on theme;
drop policy if exists theme_code_insert on theme_code;
drop policy if exists theme_code_update on theme_code;
drop policy if exists theme_code_delete on theme_code;
drop policy if exists product_insert on product;
drop policy if exists product_update on product;

do $$
declare t text;
begin
  foreach t in array array['theme_run', 'theme_rejection', 'product_run', 'product_item', 'product_item_theme',
                           'product_item_code', 'product_item_rejection'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (has_seat())', t || '_read', t);
  end loop;
end;
$$;

commit;
