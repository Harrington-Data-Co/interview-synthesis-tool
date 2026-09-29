-- Phase 3: interview notes.
--
-- Run once in the Supabase SQL editor on a database that has
-- 20260929a_coding.sql applied. A fresh database doesn't need this:
-- schema.sql already includes everything below.
--
-- Adds:
--   - Templates as a library plus project copies: a library template has no
--     project; copy_note_template() copies one (sections and all) into a
--     project, which edits its copy freely.
--   - Citation rules, in the database: every item cites at least one code of
--     its own interview; merged codes can't be newly cited; Claude's items
--     may only cite codes of their section's types, people's may cite any.
--   - Evidence can't be deleted from under a note: removing a section that
--     has items is refused (it used to cascade).
--   - note_run and note_item_rejection, as for coding.
--   - The note's writes: start/save/fail_note_run, discard_claude_note_items,
--     and the human layer (create/update/move/delete/revert items, dismiss
--     proposals), each logged with before and after values.
--   - note_coverage(): which of the interview's codes the note uses.

begin;

-- ─── templates: library and project copies ───────────────────────────────

alter table note_template
  add column copied_from_id uuid references note_template (id) on delete set null,
  add constraint note_template_name_present check (btrim(name) <> '');

-- Sections are empty until this release, so the new author needs no backfill.
alter table note_section
  add column created_by uuid not null default auth.uid() references seat (user_id),
  add constraint note_section_name_present check (btrim(name) <> '');

-- Reordering swaps two ordinals; check uniqueness at commit, not mid-swap.
alter table note_section drop constraint note_section_template_id_ordinal_key;
alter table note_section
  add constraint note_section_template_id_ordinal_key unique (template_id, ordinal) deferrable initially deferred;

create trigger note_section_keep_created_by
  before update on note_section
  for each row execute function keep_attribution('created_by');
drop policy if exists note_section_insert on note_section;
create policy note_section_insert on note_section
  for insert to authenticated with check (can_edit() and created_by = auth.uid());

-- Copy a template, sections and all, into a project — or, with no project,
-- into the library (duplicating a library template).
create or replace function copy_note_template(p_template_id uuid, p_project_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  src note_template%rowtype;
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can add templates.' using errcode = '42501';
  end if;
  select * into src from note_template where id = p_template_id;
  if not found then
    raise exception 'Unknown template.' using errcode = 'P0002';
  end if;
  if p_project_id is not null and not exists (select 1 from project where id = p_project_id) then
    raise exception 'Unknown project.' using errcode = 'P0002';
  end if;

  insert into note_template (project_id, name, scope, copied_from_id, created_by)
  values (p_project_id, case when p_project_id is null then src.name || ' (copy)' else src.name end,
          src.scope, src.id, auth.uid())
  returning id into v_id;
  insert into note_section (template_id, ordinal, name, requires, note, created_by)
  select v_id, ordinal, name, requires, note, auth.uid() from note_section where template_id = src.id;
  return v_id;
end;
$$;

-- ─── runs and proposals ──────────────────────────────────────────────────

create table note_run (
  id             uuid primary key default gen_random_uuid(),
  transcript_id  uuid not null references transcript (id) on delete cascade,
  template_id    uuid not null references note_template (id) on delete cascade,
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
create index on note_run (transcript_id, template_id, started_at desc);
create trigger note_run_keep_started_by
  before update on note_run
  for each row execute function keep_attribution('started_by');

-- ─── items: origin, author, and where they live ──────────────────────────

alter table note_item
  add column origin     code_origin not null default 'human',
  add column run_id     uuid references note_run (id) on delete set null,
  add column created_by uuid not null default auth.uid() references seat (user_id),
  add column created_at timestamptz not null default now(),
  add constraint note_item_text_present check (btrim(text) <> '');

-- A section with items can't be deleted out from under them.
alter table note_item drop constraint note_item_section_id_fkey;
alter table note_item
  add constraint note_item_section_id_fkey foreign key (section_id) references note_section (id) on delete restrict;

create table note_item_rejection (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references note_run (id) on delete cascade,
  note_id       uuid not null references note (id) on delete cascade,
  proposal      jsonb not null,
  reason        text not null,
  resolution    text check (resolution in ('fixed', 'dismissed')),
  fixed_item_id uuid references note_item (id) on delete set null,
  resolved_by   uuid references seat (user_id),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index on note_item_rejection (note_id) where resolution is null;

-- An item's section must belong to its note's template.
create or replace function check_note_item_section()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from note n join note_section s on s.template_id = n.template_id
    where n.id = new.note_id and s.id = new.section_id
  ) then
    raise exception 'That section isn''t part of this note''s template.';
  end if;
  return new;
end;
$$;

create trigger note_item_section_checked
  before insert or update of note_id, section_id on note_item
  for each row execute function check_note_item_section();

-- ─── citation rules ──────────────────────────────────────────────────────

create or replace function check_citation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c    code%rowtype;
  i    note_item%rowtype;
  v_tr uuid;
  v_requires code_type[];
begin
  select * into c from code where id = new.code_id;
  select * into i from note_item where id = new.note_item_id;
  select n.transcript_id into v_tr from note n where n.id = i.note_id;
  if c.transcript_id is distinct from v_tr then
    raise exception 'An item can only cite codes from its own interview.';
  end if;
  if c.merged_into_id is not null then
    raise exception '% was merged into another code; cite that one instead.', c.ref;
  end if;
  if i.origin = 'claude' then
    select requires into v_requires from note_section where id = i.section_id;
    if cardinality(v_requires) > 0 and not c.type = any(v_requires) then
      raise exception 'Claude''s items in this section may only cite % codes; % is a %.',
        array_to_string(v_requires, ', '), c.ref, c.type;
    end if;
  end if;
  return new;
end;
$$;

create trigger note_item_code_checked
  before insert on note_item_code
  for each row execute function check_citation();

-- Every item cites at least one code — checked at commit, so an item and its
-- citations can be written in either order within one transaction.
create or replace function require_citation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_item uuid;
begin
  -- Fields must be read per table: a note_item row has no note_item_id.
  if tg_table_name = 'note_item' then
    v_item := new.id;
  else
    v_item := old.note_item_id;
  end if;
  if exists (select 1 from note_item where id = v_item)
     and not exists (select 1 from note_item_code where note_item_id = v_item) then
    raise exception 'Every note item must cite at least one code.';
  end if;
  return null;
end;
$$;

create constraint trigger note_item_needs_citation
  after insert on note_item deferrable initially deferred
  for each row execute function require_citation();
create constraint trigger note_item_keeps_citation
  after delete on note_item_code deferrable initially deferred
  for each row execute function require_citation();

-- ─── coverage ────────────────────────────────────────────────────────────
-- Every active code of the note's interview, and whether the note uses it —
-- directly, or through a code that was merged into it after being cited.

create or replace function note_coverage(p_note_id uuid)
returns table (code_id uuid, ref text, type code_type, label text, used boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.ref, c.type, c.label,
         exists (
           select 1
           from note_item i
           join note_item_code ic on ic.note_item_id = i.id
           join code cited on cited.id = ic.code_id
           where i.note_id = p_note_id and (cited.id = c.id or cited.merged_into_id = c.id)
         )
  from code c
  where c.transcript_id = (select transcript_id from note where id = p_note_id)
    and c.merged_into_id is null
    and has_seat()
  order by c.line_start, c.ref;
$$;

-- ─── the note's writes ───────────────────────────────────────────────────

create or replace function note_item_snapshot(p_item_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'section_id', i.section_id, 'ordinal', i.ordinal, 'text', i.text,
    'code_ids', coalesce((select jsonb_agg(ic.code_id order by ic.code_id) from note_item_code ic where ic.note_item_id = i.id), '[]')
  )
  from note_item i where i.id = p_item_id;
$$;

create or replace function log_note_change(p_item_id uuid, p_note_id uuid, p_text text, p_before jsonb, p_after jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into edit (object_type, object_id, text, before, after, edited_by)
  values ('note_item', p_item_id, p_text, p_before, p_after, auth.uid());
  insert into activity (project_id, actor, verb, object)
  select t.project_id, auth.uid(), 'edited notes', format('%s · %s', t.title, p_text)
  from note n join transcript t on t.id = n.transcript_id where n.id = p_note_id;
end;
$$;

-- Opens a note run. The template must be one of the interview's project's.
create or replace function start_note_run(
  p_transcript_id  uuid,
  p_template_id    uuid,
  p_model          text,
  p_effort         text,
  p_prompt_version text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can generate notes.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from transcript t join note_template nt on nt.project_id = t.project_id
    where t.id = p_transcript_id and nt.id = p_template_id
  ) then
    raise exception 'That template isn''t one of this interview''s project''s templates.';
  end if;
  update note_run set status = 'failed', finished_at = now(), error = 'No result reported; presumed interrupted.'
  where transcript_id = p_transcript_id and template_id = p_template_id
    and status = 'running' and started_at < now() - interval '15 minutes';
  if exists (select 1 from note_run where transcript_id = p_transcript_id and template_id = p_template_id and status = 'running') then
    raise exception 'This note is already being generated.';
  end if;
  insert into note_run (transcript_id, template_id, model, effort, prompt_version, started_by)
  values (p_transcript_id, p_template_id, p_model, p_effort, p_prompt_version, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Saves a generated note. Items are written one at a time: one the rules
-- refuse becomes a rejection instead of sinking the run. People's items on an
-- existing note are kept; Claude's items are added after them.
create or replace function save_note_run(
  p_run_id     uuid,
  p_items      jsonb,
  p_rejections jsonb default '[]',
  p_usage      jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r          note_run%rowtype;
  v_note     uuid;
  it         jsonb;
  v_item     uuid;
  v_accepted integer := 0;
  v_rejected integer := 0;
  v_title    text;
  v_project  uuid;
begin
  select * into r from note_run where id = p_run_id for update;
  if not found then
    raise exception 'Unknown note run.' using errcode = 'P0002';
  end if;
  if r.started_by is distinct from auth.uid() then
    raise exception 'Only the person who started a run can save it.' using errcode = '42501';
  end if;
  if r.status <> 'running' then
    raise exception 'This run has already finished.';
  end if;

  insert into note (transcript_id, template_id, generated_by)
  values (r.transcript_id, r.template_id, r.started_by)
  on conflict (transcript_id, template_id) do update set generated_at = now()
  returning id into v_note;

  for it in select * from jsonb_array_elements(p_items) loop
    begin
      if jsonb_array_length(coalesce(it -> 'code_ids', '[]')) = 0 then
        raise exception 'Cites no codes.';
      end if;
      insert into note_item (note_id, section_id, ordinal, text, origin, run_id, created_by)
      values (
        v_note,
        (it ->> 'section_id')::uuid,
        coalesce((select max(ordinal) + 1 from note_item where note_id = v_note and section_id = (it ->> 'section_id')::uuid), 1),
        it ->> 'text',
        'claude',
        p_run_id,
        r.started_by
      )
      returning id into v_item;
      insert into note_item_code (note_item_id, code_id)
      select distinct v_item, x::uuid from jsonb_array_elements_text(it -> 'code_ids') x;
      v_accepted := v_accepted + 1;
    exception when others then
      insert into note_item_rejection (run_id, note_id, proposal, reason)
      values (p_run_id, v_note, it, sqlerrm);
      v_rejected := v_rejected + 1;
    end;
  end loop;

  insert into note_item_rejection (run_id, note_id, proposal, reason)
  select p_run_id, v_note, x -> 'proposal', x ->> 'reason' from jsonb_array_elements(p_rejections) x;
  v_rejected := v_rejected + jsonb_array_length(p_rejections);

  update note_run set
    status = 'done', finished_at = now(),
    served_by = p_usage ->> 'served_by',
    input_tokens = (p_usage ->> 'input_tokens')::integer,
    output_tokens = (p_usage ->> 'output_tokens')::integer,
    cost_usd = (p_usage ->> 'cost_usd')::numeric,
    proposed = v_accepted + v_rejected, accepted = v_accepted, rejected = v_rejected
  where id = p_run_id;

  select t.title, t.project_id into v_title, v_project from transcript t where t.id = r.transcript_id;
  insert into activity (project_id, actor, verb, object)
  values (v_project, r.started_by, 'generated a note', format('%s · %s items, %s for review', v_title, v_accepted, v_rejected));

  return jsonb_build_object('note_id', v_note, 'accepted', v_accepted, 'rejected', v_rejected);
end;
$$;

create or replace function fail_note_run(p_run_id uuid, p_error text, p_usage jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  update note_run set
    status = 'failed', finished_at = now(), error = left(p_error, 2000),
    served_by = p_usage ->> 'served_by',
    input_tokens = (p_usage ->> 'input_tokens')::integer,
    output_tokens = (p_usage ->> 'output_tokens')::integer,
    cost_usd = (p_usage ->> 'cost_usd')::numeric
  where id = p_run_id and started_by = auth.uid() and status = 'running';
end;
$$;

-- Clears Claude's items (and open proposals) so a note can be regenerated.
create or replace function discard_claude_note_items(p_note_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can discard note items.' using errcode = '42501';
  end if;
  delete from note_item where note_id = p_note_id and origin = 'claude';
  get diagnostics v_n = row_count;
  delete from note_item_rejection where note_id = p_note_id and resolution is null;
  return v_n;
end;
$$;

-- A person's item: any section of the note's template, any of the
-- interview's active codes. Passing a proposal marks it fixed by this item.
create or replace function create_note_item(
  p_note_id      uuid,
  p_section_id   uuid,
  p_text         text,
  p_code_ids     uuid[],
  p_rejection_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit notes.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_code_ids), 0) = 0 then
    raise exception 'Every note item must cite at least one code.';
  end if;
  insert into note_item (note_id, section_id, ordinal, text, origin, created_by)
  values (p_note_id, p_section_id,
          coalesce((select max(ordinal) + 1 from note_item where note_id = p_note_id and section_id = p_section_id), 1),
          btrim(p_text), 'human', auth.uid())
  returning id into v_id;
  insert into note_item_code (note_item_id, code_id) select distinct v_id, unnest(p_code_ids);

  if p_rejection_id is not null then
    update note_item_rejection
    set resolution = 'fixed', fixed_item_id = v_id, resolved_by = auth.uid(), resolved_at = now()
    where id = p_rejection_id and note_id = p_note_id and resolution is null;
  end if;

  perform log_note_change(v_id, p_note_id, 'added an item', null, note_item_snapshot(v_id));
  return v_id;
end;
$$;

-- Change an item's text, section and/or citations. Present keys apply.
create or replace function update_note_item(p_item_id uuid, p_changes jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  i        note_item%rowtype;
  v_before jsonb;
  v_after  jsonb;
  v_codes  uuid[];
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit notes.' using errcode = '42501';
  end if;
  select * into i from note_item where id = p_item_id for update;
  if not found then
    raise exception 'Unknown note item.' using errcode = 'P0002';
  end if;
  v_before := note_item_snapshot(p_item_id);

  if p_changes ? 'text' and btrim(p_changes ->> 'text') is distinct from i.text then
    update note_item set text = btrim(p_changes ->> 'text') where id = p_item_id;
  end if;
  if p_changes ? 'section_id' and (p_changes ->> 'section_id')::uuid is distinct from i.section_id then
    update note_item set
      section_id = (p_changes ->> 'section_id')::uuid,
      ordinal = coalesce((select max(ordinal) + 1 from note_item where note_id = i.note_id and section_id = (p_changes ->> 'section_id')::uuid), 1)
    where id = p_item_id;
  end if;
  if p_changes ? 'code_ids' then
    select coalesce(array_agg(distinct x::uuid), '{}') into v_codes from jsonb_array_elements_text(p_changes -> 'code_ids') x;
    if cardinality(v_codes) = 0 then
      raise exception 'Every note item must cite at least one code.';
    end if;
    -- Keep citations that stay (a merged code already cited remains valid);
    -- add only the new ones, which the citation rules check.
    delete from note_item_code where note_item_id = p_item_id and not code_id = any(v_codes);
    insert into note_item_code (note_item_id, code_id)
    select p_item_id, c from unnest(v_codes) c
    where not exists (select 1 from note_item_code where note_item_id = p_item_id and code_id = c);
  end if;

  v_after := note_item_snapshot(p_item_id);
  if v_after = v_before then
    return 0;
  end if;
  perform log_note_change(p_item_id, i.note_id, 'edited an item', v_before, v_after);
  return 1;
end;
$$;

-- Move an item up (-1) or down (+1) within its section. Order isn't evidence,
-- so moves aren't logged.
create or replace function move_note_item(p_item_id uuid, p_delta integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  i note_item%rowtype;
  other note_item%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit notes.' using errcode = '42501';
  end if;
  select * into i from note_item where id = p_item_id for update;
  if not found then
    raise exception 'Unknown note item.' using errcode = 'P0002';
  end if;
  select * into other from note_item
  where note_id = i.note_id and section_id = i.section_id
    and case when p_delta < 0 then ordinal < i.ordinal else ordinal > i.ordinal end
  order by case when p_delta < 0 then -ordinal else ordinal end
  limit 1;
  if found then
    update note_item set ordinal = other.ordinal where id = i.id;
    update note_item set ordinal = i.ordinal where id = other.id;
  end if;
end;
$$;

create or replace function delete_note_item(p_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  i note_item%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit notes.' using errcode = '42501';
  end if;
  select * into i from note_item where id = p_item_id for update;
  if not found then
    raise exception 'Unknown note item.' using errcode = 'P0002';
  end if;
  perform log_note_change(p_item_id, i.note_id, 'removed an item', note_item_snapshot(p_item_id), null);
  delete from note_item where id = p_item_id;
end;
$$;

-- Undo an item's latest edit, restoring its text, section and citations.
create or replace function revert_last_note_item_edit(p_item_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  e edit%rowtype;
  i note_item%rowtype;
  b jsonb;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can revert edits.' using errcode = '42501';
  end if;
  select * into e from edit
  where object_type = 'note_item' and object_id = p_item_id and not reverted
    and before is not null and after is not null
  order by edited_at desc limit 1
  for update;
  if not found then
    raise exception 'There''s no edit to revert on this item.';
  end if;
  select * into i from note_item where id = p_item_id for update;
  b := e.before;

  update note_item set text = b ->> 'text', section_id = (b ->> 'section_id')::uuid, ordinal = (b ->> 'ordinal')::integer
  where id = p_item_id;
  delete from note_item_code where note_item_id = p_item_id
    and not code_id in (select x::uuid from jsonb_array_elements_text(b -> 'code_ids') x);
  insert into note_item_code (note_item_id, code_id)
  select p_item_id, x::uuid from jsonb_array_elements_text(b -> 'code_ids') x
  where not exists (select 1 from note_item_code where note_item_id = p_item_id and code_id = x::uuid);
  update edit set reverted = true where id = e.id;

  perform log_note_change(p_item_id, i.note_id, format('reverted: %s', e.text), e.after, b);
  update edit set reverted = true
  where id = (select id from edit where object_type = 'note_item' and object_id = p_item_id order by edited_at desc limit 1);
  return e.text;
end;
$$;

create or replace function dismiss_note_rejection(p_rejection_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_edit() then
    raise exception 'Only editors and owners can dismiss proposals.' using errcode = '42501';
  end if;
  update note_item_rejection set resolution = 'dismissed', resolved_by = auth.uid(), resolved_at = now()
  where id = p_rejection_id and resolution is null;
end;
$$;

revoke execute on function copy_note_template, start_note_run, save_note_run, fail_note_run,
  discard_claude_note_items, create_note_item, update_note_item, move_note_item, delete_note_item,
  revert_last_note_item_edit, dismiss_note_rejection, note_coverage, log_note_change from public, anon;
grant execute on function copy_note_template, start_note_run, save_note_run, fail_note_run,
  discard_claude_note_items, create_note_item, update_note_item, move_note_item, delete_note_item,
  revert_last_note_item_edit, dismiss_note_rejection, note_coverage to authenticated;

-- ─── access ──────────────────────────────────────────────────────────────
-- Notes, items and citations are written only through the functions above.
-- A whole note may still be deleted directly by an editor.

drop policy if exists note_insert on note;
drop policy if exists note_update on note;
drop policy if exists note_item_insert on note_item;
drop policy if exists note_item_update on note_item;
drop policy if exists note_item_delete on note_item;
drop policy if exists note_item_code_insert on note_item_code;
drop policy if exists note_item_code_update on note_item_code;
drop policy if exists note_item_code_delete on note_item_code;

alter table note_run enable row level security;
create policy note_run_read on note_run for select to authenticated using (has_seat());
alter table note_item_rejection enable row level security;
create policy note_item_rejection_read on note_item_rejection for select to authenticated using (has_seat());

commit;
