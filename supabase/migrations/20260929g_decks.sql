-- Phase 6: slide decks.
--
-- Run once in the Supabase SQL editor on a database that has
-- 20260929f_swimlanes.sql applied. A fresh database doesn't need this:
-- schema.sql already includes everything below.
--
-- Adds decks, written like the memo: a product of a deck template (kind
-- 'deck'), in the template's sections, from confirmed themes, sharing
-- product_run and product_item_rejection. deck_slide holds a headline, up to
-- six bullets, an optional quote (from a code the slide cites) and speaker
-- notes; each slide cites at least one theme or code (checked at commit).
-- A logged, revertible human layer. Themes and codes a deck cites can't be
-- deleted, merged away or discarded, and deck sections with slides can't be
-- removed.

begin;

-- ─── decks ───────────────────────────────────────────────────────────────
-- A deck is a product of a deck template, like the memo is of a report
-- template: one per template per project, written in the template's
-- sections, from confirmed themes. It shares product_run and
-- product_item_rejection with the memo. A slide is an assertion headline,
-- up to six bullets, optionally one participant's quote (from a code the
-- slide cites) and speaker notes; it cites at least one theme or code.

create table deck_slide (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references product (id) on delete cascade,
  section_id    uuid not null references product_section (id) on delete cascade,
  ordinal       integer not null,
  layout        text not null default 'finding' check (layout in ('finding', 'quote', 'statement')),
  title         text not null check (btrim(title) <> ''),
  bullets       text[] not null default '{}' check (cardinality(bullets) <= 6),
  quote_code_id uuid references code (id) on delete set null,
  notes         text,
  origin        code_origin not null default 'human',
  run_id        uuid references product_run (id) on delete set null,
  created_by    uuid not null default auth.uid() references seat (user_id),
  created_at    timestamptz not null default now()
);
create index on deck_slide (product_id);
create trigger deck_slide_keep_created_by
  before update on deck_slide
  for each row execute function keep_attribution('created_by');

create table deck_slide_theme (
  slide_id uuid not null references deck_slide (id) on delete cascade,
  theme_id uuid not null references theme (id) on delete cascade,
  primary key (slide_id, theme_id)
);
create table deck_slide_code (
  slide_id uuid not null references deck_slide (id) on delete cascade,
  code_id  uuid not null references code (id) on delete cascade,
  primary key (slide_id, code_id)
);
create index on deck_slide_theme (theme_id);
create index on deck_slide_code (code_id);

-- The same rules as the memo's: citations from the deck's own project, no
-- merged codes; Claude's slides cite confirmed themes only, themes only in
-- sections that fill from themes, and codes of the section's types or
-- within a theme the slide cites.
create or replace function check_deck_citation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s          deck_slide%rowtype;
  v_project  uuid;
  v_requires text[];
  th         theme%rowtype;
  c          code%rowtype;
begin
  select * into s from deck_slide where id = new.slide_id;
  select p.project_id into v_project from product p where p.id = s.product_id;
  select requires into v_requires from product_section where id = s.section_id;

  if tg_table_name = 'deck_slide_theme' then
    select * into th from theme where id = new.theme_id;
    if th.project_id is distinct from v_project then
      raise exception 'A deck can only cite themes from its own project.';
    end if;
    if s.origin = 'claude' and th.status <> 'confirmed' then
      raise exception '% isn''t confirmed; the deck is written from confirmed themes only.', th.ref;
    end if;
    if s.origin = 'claude' and cardinality(v_requires) > 0 and not 'themes' = any(v_requires) then
      raise exception 'This section doesn''t fill from themes.';
    end if;
  else
    select * into c from code where id = new.code_id;
    if not exists (select 1 from transcript t where t.id = c.transcript_id and t.project_id = v_project) then
      raise exception 'A deck can only cite codes from its own project.';
    end if;
    if c.merged_into_id is not null then
      raise exception '% was merged into another code; cite that one instead.', c.ref;
    end if;
    if s.origin = 'claude' and cardinality(v_requires) > 0 and not c.type::text = any(v_requires)
       and not exists (
         select 1 from deck_slide_theme dst join theme_code tc on tc.theme_id = dst.theme_id
         where dst.slide_id = new.slide_id and tc.code_id = new.code_id
       ) then
      raise exception '% (%) isn''t a type this section fills from, nor part of a theme the slide cites.', c.ref, c.type;
    end if;
  end if;
  return new;
end;
$$;
create trigger deck_slide_theme_checked before insert on deck_slide_theme
  for each row execute function check_deck_citation();
create trigger deck_slide_code_checked before insert on deck_slide_code
  for each row execute function check_deck_citation();

-- At commit: every slide cites at least one theme or code, and its quote,
-- if any, comes from a code it cites.
create or replace function require_deck_citation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_slide uuid;
  s       deck_slide%rowtype;
begin
  if tg_table_name = 'deck_slide' then
    v_slide := new.id;
  else
    v_slide := old.slide_id;
  end if;
  select * into s from deck_slide where id = v_slide;
  if not found then
    return null;
  end if;
  if not exists (select 1 from deck_slide_theme where slide_id = v_slide)
     and not exists (select 1 from deck_slide_code where slide_id = v_slide) then
    raise exception 'Every slide must cite at least one theme or code.';
  end if;
  if s.quote_code_id is not null and not exists (select 1 from deck_slide_code where slide_id = v_slide and code_id = s.quote_code_id) then
    raise exception 'A slide''s quote must come from a code it cites.';
  end if;
  return null;
end;
$$;
create constraint trigger deck_slide_needs_citation after insert or update of quote_code_id on deck_slide
  deferrable initially deferred for each row execute function require_deck_citation();
create constraint trigger deck_slide_theme_keeps_citation after delete on deck_slide_theme
  deferrable initially deferred for each row execute function require_deck_citation();
create constraint trigger deck_slide_code_keeps_citation after delete on deck_slide_code
  deferrable initially deferred for each row execute function require_deck_citation();

create or replace function deck_slide_snapshot(p_slide_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'section_id', s.section_id, 'ordinal', s.ordinal, 'layout', s.layout, 'title', s.title,
    'bullets', to_jsonb(s.bullets), 'quote_code_id', s.quote_code_id, 'notes', s.notes,
    'theme_ids', coalesce((select jsonb_agg(x.theme_id order by x.theme_id) from deck_slide_theme x where x.slide_id = s.id), '[]'),
    'code_ids', coalesce((select jsonb_agg(x.code_id order by x.code_id) from deck_slide_code x where x.slide_id = s.id), '[]')
  )
  from deck_slide s where s.id = p_slide_id;
$$;

create or replace function log_deck_change(p_slide_id uuid, p_product_id uuid, p_text text, p_before jsonb, p_after jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into edit (object_type, object_id, text, before, after, edited_by)
  values ('deck_slide', p_slide_id, p_text, p_before, p_after, auth.uid());
  insert into activity (project_id, actor, verb, object)
  select p.project_id, auth.uid(), 'edited the deck', p_text from product p where p.id = p_product_id;
end;
$$;

-- Replace a slide's citations with exactly these themes and codes.
create or replace function set_deck_citations(p_slide_id uuid, p_theme_ids uuid[], p_code_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(cardinality(p_theme_ids), 0) + coalesce(cardinality(p_code_ids), 0) = 0 then
    raise exception 'Every slide must cite at least one theme or code.';
  end if;
  delete from deck_slide_code where slide_id = p_slide_id and not code_id = any(coalesce(p_code_ids, '{}'));
  delete from deck_slide_theme where slide_id = p_slide_id and not theme_id = any(coalesce(p_theme_ids, '{}'));
  -- Themes first: a code is allowed partly by being in a cited theme.
  insert into deck_slide_theme (slide_id, theme_id)
  select p_slide_id, t from unnest(coalesce(p_theme_ids, '{}')) t
  where not exists (select 1 from deck_slide_theme where slide_id = p_slide_id and theme_id = t);
  insert into deck_slide_code (slide_id, code_id)
  select p_slide_id, c from unnest(coalesce(p_code_ids, '{}')) c
  where not exists (select 1 from deck_slide_code where slide_id = p_slide_id and code_id = c);
end;
$$;

-- Saves a written deck: its title, then each slide on its own, so a slide the
-- database refuses goes to review without losing the rest. Claude's earlier
-- slides and open proposals are replaced; slides people wrote or edited stay.
--   p_slides: [{section_id, layout, title, bullets: […], quote_code_id,
--   notes, theme_ids: […], code_ids: […]}]
create or replace function save_deck_run(
  p_run_id uuid, p_title text, p_slides jsonb, p_rejections jsonb default '[]', p_usage jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r          product_run%rowtype;
  v_product  uuid;
  sl         jsonb;
  v_slide    uuid;
  v_accepted integer := 0;
  v_rejected integer := 0;
begin
  select * into r from product_run where id = p_run_id for update;
  if not found then
    raise exception 'Unknown deck run.' using errcode = 'P0002';
  end if;
  if r.started_by is distinct from auth.uid() then
    raise exception 'Only the person who started a run can save it.' using errcode = '42501';
  end if;
  if r.status <> 'running' then
    raise exception 'This run has already finished.';
  end if;
  if not exists (select 1 from product_template where id = r.template_id and kind = 'deck') then
    raise exception 'That template isn''t a deck template.';
  end if;

  insert into product (project_id, template_id, title, rendered_by)
  values (r.project_id, r.template_id, nullif(btrim(p_title), ''), r.started_by)
  on conflict (project_id, template_id) do update
    set title = coalesce(nullif(btrim(excluded.title), ''), product.title), rendered_at = now()
  returning id into v_product;

  delete from deck_slide where product_id = v_product and origin = 'claude';
  delete from product_item_rejection where product_id = v_product and resolution is null;

  for sl in select * from jsonb_array_elements(p_slides) loop
    begin
      insert into deck_slide (product_id, section_id, ordinal, layout, title, bullets, quote_code_id, notes, origin, run_id, created_by)
      values (v_product, (sl ->> 'section_id')::uuid,
              coalesce((select max(ordinal) + 1 from deck_slide where product_id = v_product and section_id = (sl ->> 'section_id')::uuid), 1),
              coalesce(sl ->> 'layout', 'finding'), btrim(sl ->> 'title'),
              array(select btrim(x) from jsonb_array_elements_text(coalesce(sl -> 'bullets', '[]')) x where btrim(x) <> ''),
              nullif(sl ->> 'quote_code_id', '')::uuid, nullif(btrim(sl ->> 'notes'), ''), 'claude', p_run_id, r.started_by)
      returning id into v_slide;
      perform set_deck_citations(v_slide,
        array(select x::uuid from jsonb_array_elements_text(coalesce(sl -> 'theme_ids', '[]')) x),
        array(select x::uuid from jsonb_array_elements_text(coalesce(sl -> 'code_ids', '[]')) x));
      -- The quote check is deferred; run it now so a bad quote fails here.
      set constraints deck_slide_needs_citation immediate;
      set constraints deck_slide_needs_citation deferred;
      v_accepted := v_accepted + 1;
    exception when others then
      insert into product_item_rejection (run_id, product_id, proposal, reason) values (p_run_id, v_product, sl, sqlerrm);
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
  values (r.project_id, r.started_by, 'wrote the deck', format('%s slides, %s for review', v_accepted, v_rejected));
  return jsonb_build_object('product_id', v_product, 'accepted', v_accepted, 'rejected', v_rejected);
end;
$$;

-- ─── the human layer ─────────────────────────────────────────────────────

create or replace function create_deck_slide(
  p_product_id uuid, p_section_id uuid, p_layout text, p_title text, p_bullets text[], p_quote_code_id uuid,
  p_notes text, p_theme_ids uuid[], p_code_ids uuid[], p_rejection_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit decks.' using errcode = '42501';
  end if;
  insert into deck_slide (product_id, section_id, ordinal, layout, title, bullets, quote_code_id, notes, origin, created_by)
  values (p_product_id, p_section_id,
          coalesce((select max(ordinal) + 1 from deck_slide where product_id = p_product_id and section_id = p_section_id), 1),
          coalesce(p_layout, 'finding'), btrim(p_title),
          array(select btrim(x) from unnest(coalesce(p_bullets, '{}')) x where btrim(x) <> ''),
          p_quote_code_id, nullif(btrim(p_notes), ''), 'human', auth.uid())
  returning id into v_id;
  perform set_deck_citations(v_id, p_theme_ids, p_code_ids);
  if p_rejection_id is not null then
    update product_item_rejection set resolution = 'fixed', resolved_by = auth.uid(), resolved_at = now()
    where id = p_rejection_id and product_id = p_product_id and resolution is null;
  end if;
  perform log_deck_change(v_id, p_product_id, 'added a slide', null, deck_slide_snapshot(v_id));
  return v_id;
end;
$$;

-- Keys left out are unchanged. A person's edit makes the slide theirs, so a
-- rewrite keeps it.
create or replace function update_deck_slide(p_slide_id uuid, p_changes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  s        deck_slide%rowtype;
  v_before jsonb;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit decks.' using errcode = '42501';
  end if;
  select * into s from deck_slide where id = p_slide_id for update;
  if not found then
    raise exception 'Unknown slide.' using errcode = 'P0002';
  end if;
  v_before := deck_slide_snapshot(p_slide_id);
  update deck_slide set
    section_id    = case when p_changes ? 'section_id' then (p_changes ->> 'section_id')::uuid else section_id end,
    layout        = case when p_changes ? 'layout' then p_changes ->> 'layout' else layout end,
    title         = case when p_changes ? 'title' then btrim(p_changes ->> 'title') else title end,
    bullets       = case when p_changes ? 'bullets'
                      then array(select btrim(x) from jsonb_array_elements_text(p_changes -> 'bullets') x where btrim(x) <> '')
                      else bullets end,
    quote_code_id = case when p_changes ? 'quote_code_id' then nullif(p_changes ->> 'quote_code_id', '')::uuid else quote_code_id end,
    notes         = case when p_changes ? 'notes' then nullif(btrim(p_changes ->> 'notes'), '') else notes end,
    origin        = 'human'
  where id = p_slide_id;
  if p_changes ? 'theme_ids' or p_changes ? 'code_ids' then
    perform set_deck_citations(p_slide_id,
      case when p_changes ? 'theme_ids' then array(select x::uuid from jsonb_array_elements_text(p_changes -> 'theme_ids') x)
           else array(select theme_id from deck_slide_theme where slide_id = p_slide_id) end,
      case when p_changes ? 'code_ids' then array(select x::uuid from jsonb_array_elements_text(p_changes -> 'code_ids') x)
           else array(select code_id from deck_slide_code where slide_id = p_slide_id) end);
  end if;
  perform log_deck_change(p_slide_id, s.product_id, format('edited slide "%s"', s.title), v_before, deck_slide_snapshot(p_slide_id));
end;
$$;

-- Swap a slide with its neighbour in the same section.
create or replace function move_deck_slide(p_slide_id uuid, p_delta integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  s deck_slide%rowtype;
  o deck_slide%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit decks.' using errcode = '42501';
  end if;
  select * into s from deck_slide where id = p_slide_id for update;
  if not found then
    raise exception 'Unknown slide.' using errcode = 'P0002';
  end if;
  select * into o from deck_slide where product_id = s.product_id and section_id = s.section_id
    and case when p_delta < 0 then ordinal < s.ordinal else ordinal > s.ordinal end
    order by case when p_delta < 0 then -ordinal else ordinal end limit 1 for update;
  if not found then
    return;
  end if;
  update deck_slide set ordinal = o.ordinal where id = s.id;
  update deck_slide set ordinal = s.ordinal where id = o.id;
end;
$$;

create or replace function delete_deck_slide(p_slide_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s deck_slide%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit decks.' using errcode = '42501';
  end if;
  select * into s from deck_slide where id = p_slide_id for update;
  if not found then
    raise exception 'Unknown slide.' using errcode = 'P0002';
  end if;
  perform log_deck_change(p_slide_id, s.product_id, format('deleted slide "%s"', s.title), deck_slide_snapshot(p_slide_id), null);
  delete from deck_slide where id = p_slide_id;
end;
$$;

create or replace function revert_last_deck_slide_edit(p_slide_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  e edit%rowtype;
  s deck_slide%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can revert edits.' using errcode = '42501';
  end if;
  select * into s from deck_slide where id = p_slide_id for update;
  if not found then
    raise exception 'Unknown slide.' using errcode = 'P0002';
  end if;
  select * into e from edit
  where object_type = 'deck_slide' and object_id = p_slide_id and not reverted and before is not null and after is not null
  order by edited_at desc limit 1 for update;
  if not found then
    raise exception 'Nothing to revert.';
  end if;
  update deck_slide set
    section_id = (e.before ->> 'section_id')::uuid, layout = e.before ->> 'layout', title = e.before ->> 'title',
    bullets = array(select x from jsonb_array_elements_text(e.before -> 'bullets') x),
    quote_code_id = nullif(e.before ->> 'quote_code_id', '')::uuid, notes = e.before ->> 'notes'
  where id = p_slide_id;
  perform set_deck_citations(p_slide_id,
    array(select x::uuid from jsonb_array_elements_text(e.before -> 'theme_ids') x),
    array(select x::uuid from jsonb_array_elements_text(e.before -> 'code_ids') x));
  update edit set reverted = true where id = e.id;
  insert into activity (project_id, actor, verb, object)
  select p.project_id, auth.uid(), 'reverted an edit', s.title from product p where p.id = s.product_id;
end;
$$;

-- ─── what a deck cites stays put ─────────────────────────────────────────
-- Themes and codes a deck cites can't be deleted or merged away, and a deck
-- section with slides can't be removed; the memo's guards, extended.

create or replace function refuse_section_delete_with_items()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'note_section' then
    if exists (select 1 from note_template where id = old.template_id)
       and exists (select 1 from note_item where section_id = old.id) then
      raise exception 'Note items sit in "%", so it can''t be removed. Move them first.', old.name;
    end if;
  elsif exists (select 1 from product_template where id = old.template_id) then
    if exists (select 1 from product_item where section_id = old.id) then
      raise exception 'Memo paragraphs sit in "%", so it can''t be removed. Move them first.', old.name;
    end if;
    if exists (select 1 from deck_slide where section_id = old.id) then
      raise exception 'Slides sit in "%", so it can''t be removed. Move them first.', old.name;
    end if;
  end if;
  return old;
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
  if exists (select 1 from deck_slide_theme where theme_id = p_theme_id) then
    raise exception '% is cited by a deck; edit the deck before deleting it.', th.ref;
  end if;
  perform log_theme_change(p_theme_id, th.project_id, format('deleted %s', th.ref), theme_snapshot(p_theme_id), null);
  delete from theme where id = p_theme_id;
end;
$$;

-- Merging away or discarding a theme a deck cites is refused too: a trigger,
-- so merge_themes() and discard_proposed_themes() needn't be rewritten.
create or replace function refuse_cited_theme_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from deck_slide_theme where theme_id = old.id)
     and exists (select 1 from project where id = old.project_id) then
    raise exception '% is cited by a deck; edit the deck first.', old.ref;
  end if;
  return old;
end;
$$;
create trigger theme_keeps_deck_citations
  before delete on theme
  for each row execute function refuse_cited_theme_delete();

-- Re-proposing themes keeps any a deck cites, as it keeps those a memo cites.
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
    and not exists (select 1 from product_item_theme pit where pit.theme_id = th.id)
    and not exists (select 1 from deck_slide_theme dst where dst.theme_id = th.id);
  get diagnostics v_n = row_count;
  delete from theme_rejection where project_id = p_project_id and resolution is null;
  return v_n;
end;
$$;

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
  if exists (select 1 from flow_step_code where code_id = p_code_id) then
    raise exception '% is cited by a process map; merge it into another code instead of deleting it.', c.ref;
  end if;
  if exists (select 1 from deck_slide_code where code_id = p_code_id) then
    raise exception '% is cited by a deck; merge it into another code instead of deleting it.', c.ref;
  end if;
  update code set merged_into_id = null where merged_into_id = p_code_id;
  perform log_code_change(c, format('deleted %s', c.ref), code_snapshot(c), null);
  delete from code where id = p_code_id;
end;
$$;

-- ─── access ──────────────────────────────────────────────────────────────

revoke execute on function
  save_deck_run, create_deck_slide, update_deck_slide, move_deck_slide, delete_deck_slide, revert_last_deck_slide_edit,
  set_deck_citations, log_deck_change, deck_slide_snapshot
from public, anon;
grant execute on function
  save_deck_run, create_deck_slide, update_deck_slide, move_deck_slide, delete_deck_slide, revert_last_deck_slide_edit
to authenticated;

do $$
declare t text;
begin
  foreach t in array array['deck_slide', 'deck_slide_theme', 'deck_slide_code'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (has_seat())', t || '_read', t);
  end loop;
end;
$$;

commit;
