-- Phase 6: current-state architecture maps.
--
-- Run once in the Supabase SQL editor on a database that has
-- 20260929g_decks.sql applied. A fresh database doesn't need this:
-- schema.sql already includes everything below.
--
-- Adds architecture maps: the systems as participants described them.
-- arch_map (a map), arch_node (a system, spreadsheet, document, inbox,
-- manual step or outside party; official or a workaround), arch_flow (what
-- moves between two systems, by hand or automatically), arch_gap (numbered
-- gaps). Every system, flow and gap cites at least one code (checked at
-- commit). arch_run / arch_rejection as for the other passes; a redraft
-- replaces only maps nobody has edited. Edits are logged with before and
-- after values. delete_code() also refuses codes a map cites.

begin;

-- ─── current-state architecture ──────────────────────────────────────────
-- The systems as participants described them, not as documented: what they
-- use (systems, spreadsheets, documents, inboxes, manual steps), how data
-- moves between them (automatically or by hand), and the gaps. Workarounds
-- people invented are marked unofficial. Every system, flow and gap cites
-- the codes it rests on. Maps work like process maps: Claude drafts them,
-- people edit them, and a redraft replaces only maps nobody has touched.

create table arch_run (
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
create index on arch_run (project_id, started_at desc);
create trigger arch_run_keep_started_by
  before update on arch_run
  for each row execute function keep_attribution('started_by');

create table arch_map (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id) on delete cascade,
  ref        text not null,                 -- 'SA-1'
  title      text not null check (btrim(title) <> ''),
  scope      text,
  ordinal    integer not null default 0,
  origin     code_origin not null default 'human',
  run_id     uuid references arch_run (id) on delete set null,
  touched    boolean not null default false,
  created_by uuid not null default auth.uid() references seat (user_id),
  created_at timestamptz not null default now(),
  unique (project_id, ref)
);
create index on arch_map (project_id);
create trigger arch_map_keep_created_by
  before update on arch_map
  for each row execute function keep_attribution('created_by');

create table arch_node (
  id       uuid primary key default gen_random_uuid(),
  map_id   uuid not null references arch_map (id) on delete cascade,
  ordinal  integer not null,
  name     text not null check (btrim(name) <> ''),
  kind     text not null default 'system'
           check (kind in ('system', 'spreadsheet', 'document', 'communication', 'manual', 'external')),
  -- false: a workaround people built or adopted, not part of the systems
  -- anyone planned.
  official boolean not null default true,
  note     text,
  constraint arch_node_name unique (map_id, name)
);
create index on arch_node (map_id);

create table arch_flow (
  id        uuid primary key default gen_random_uuid(),
  map_id    uuid not null references arch_map (id) on delete cascade,
  from_node uuid not null references arch_node (id) on delete cascade,
  to_node   uuid not null references arch_node (id) on delete cascade,
  label     text not null check (btrim(label) <> ''),   -- what moves
  -- true: a person moves it (re-keys, copies, emails, exports); false: the
  -- systems move it themselves.
  manual    boolean not null default true,
  note      text,
  check (from_node <> to_node)
);
create index on arch_flow (map_id);

create table arch_gap (
  id      uuid primary key default gen_random_uuid(),
  map_id  uuid not null references arch_map (id) on delete cascade,
  ordinal integer not null,
  title   text not null check (btrim(title) <> ''),
  note    text
);
create index on arch_gap (map_id);

create table arch_node_code (
  node_id uuid not null references arch_node (id) on delete cascade,
  code_id uuid not null references code (id) on delete cascade,
  primary key (node_id, code_id)
);
create table arch_flow_code (
  flow_id uuid not null references arch_flow (id) on delete cascade,
  code_id uuid not null references code (id) on delete cascade,
  primary key (flow_id, code_id)
);
create table arch_gap_code (
  gap_id  uuid not null references arch_gap (id) on delete cascade,
  code_id uuid not null references code (id) on delete cascade,
  primary key (gap_id, code_id)
);
create index on arch_node_code (code_id);
create index on arch_flow_code (code_id);
create index on arch_gap_code (code_id);

create table arch_rejection (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references arch_run (id) on delete cascade,
  project_id  uuid not null references project (id) on delete cascade,
  proposal    jsonb not null,
  reason      text not null,
  resolution  text check (resolution in ('fixed', 'dismissed')),
  resolved_by uuid references seat (user_id),
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index on arch_rejection (project_id) where resolution is null;

-- A flow joins two systems of its own map.
create or replace function check_arch_flow_nodes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.from_node = new.to_node then
    raise exception 'A flow must join two different systems.';
  end if;
  if not exists (select 1 from arch_node where id = new.from_node and map_id = new.map_id)
     or not exists (select 1 from arch_node where id = new.to_node and map_id = new.map_id) then
    raise exception 'A flow must join two systems of its own map.';
  end if;
  return new;
end;
$$;
create trigger arch_flow_nodes_checked before insert or update of from_node, to_node, map_id on arch_flow
  for each row execute function check_arch_flow_nodes();

-- Citations: codes of the map's own project, never one merged away.
create or replace function check_arch_citation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c       code%rowtype;
  v_map   uuid;
begin
  select * into c from code where id = new.code_id;
  if tg_table_name = 'arch_node_code' then
    select map_id into v_map from arch_node where id = new.node_id;
  elsif tg_table_name = 'arch_flow_code' then
    select map_id into v_map from arch_flow where id = new.flow_id;
  else
    select map_id into v_map from arch_gap where id = new.gap_id;
  end if;
  if not exists (
    select 1 from arch_map m join transcript t on t.project_id = m.project_id
    where m.id = v_map and t.id = c.transcript_id
  ) then
    raise exception 'An architecture map can only cite codes from its own project.';
  end if;
  if c.merged_into_id is not null then
    raise exception '% was merged into another code; cite that one instead.', c.ref;
  end if;
  return new;
end;
$$;
create trigger arch_node_code_checked before insert on arch_node_code for each row execute function check_arch_citation();
create trigger arch_flow_code_checked before insert on arch_flow_code for each row execute function check_arch_citation();
create trigger arch_gap_code_checked before insert on arch_gap_code for each row execute function check_arch_citation();

-- At commit: every system, flow and gap cites at least one code.
create or replace function require_arch_citation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  -- One branch per table: a record only has its own table's fields.
  if tg_table_name = 'arch_node' then
    v_id := new.id;
  elsif tg_table_name = 'arch_node_code' then
    v_id := old.node_id;
  elsif tg_table_name = 'arch_flow' then
    v_id := new.id;
  elsif tg_table_name = 'arch_flow_code' then
    v_id := old.flow_id;
  elsif tg_table_name = 'arch_gap' then
    v_id := new.id;
  else
    v_id := old.gap_id;
  end if;
  if tg_table_name in ('arch_node', 'arch_node_code') then
    if exists (select 1 from arch_node where id = v_id) and not exists (select 1 from arch_node_code where node_id = v_id) then
      raise exception 'Every system must cite at least one code.';
    end if;
  elsif tg_table_name in ('arch_flow', 'arch_flow_code') then
    if exists (select 1 from arch_flow where id = v_id) and not exists (select 1 from arch_flow_code where flow_id = v_id) then
      raise exception 'Every flow must cite at least one code.';
    end if;
  elsif exists (select 1 from arch_gap where id = v_id) and not exists (select 1 from arch_gap_code where gap_id = v_id) then
    raise exception 'Every gap must cite at least one code.';
  end if;
  return null;
end;
$$;
create constraint trigger arch_node_needs_citation after insert on arch_node
  deferrable initially deferred for each row execute function require_arch_citation();
create constraint trigger arch_node_code_keeps_citation after delete on arch_node_code
  deferrable initially deferred for each row execute function require_arch_citation();
create constraint trigger arch_flow_needs_citation after insert on arch_flow
  deferrable initially deferred for each row execute function require_arch_citation();
create constraint trigger arch_flow_code_keeps_citation after delete on arch_flow_code
  deferrable initially deferred for each row execute function require_arch_citation();
create constraint trigger arch_gap_needs_citation after insert on arch_gap
  deferrable initially deferred for each row execute function require_arch_citation();
create constraint trigger arch_gap_code_keeps_citation after delete on arch_gap_code
  deferrable initially deferred for each row execute function require_arch_citation();

create or replace function next_arch_ref(p_project_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select 'SA-' || (coalesce(max(nullif(regexp_replace(ref, '\D', '', 'g'), '')::integer), 0) + 1)
  from arch_map where project_id = p_project_id;
$$;

-- Replace one item's citations with exactly these codes.
create or replace function set_arch_codes(p_kind text, p_id uuid, p_code_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(cardinality(p_code_ids), 0) = 0 then
    raise exception 'Every % must cite at least one code.', case p_kind when 'node' then 'system' else p_kind end;
  end if;
  if p_kind = 'node' then
    delete from arch_node_code where node_id = p_id and not code_id = any(p_code_ids);
    insert into arch_node_code (node_id, code_id)
    select p_id, c from unnest(p_code_ids) c where not exists (select 1 from arch_node_code where node_id = p_id and code_id = c);
  elsif p_kind = 'flow' then
    delete from arch_flow_code where flow_id = p_id and not code_id = any(p_code_ids);
    insert into arch_flow_code (flow_id, code_id)
    select p_id, c from unnest(p_code_ids) c where not exists (select 1 from arch_flow_code where flow_id = p_id and code_id = c);
  else
    delete from arch_gap_code where gap_id = p_id and not code_id = any(p_code_ids);
    insert into arch_gap_code (gap_id, code_id)
    select p_id, c from unnest(p_code_ids) c where not exists (select 1 from arch_gap_code where gap_id = p_id and code_id = c);
  end if;
end;
$$;

create or replace function arch_snapshot(p_kind text, p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'node' then (select jsonb_build_object('name', n.name, 'kind', n.kind, 'official', n.official, 'note', n.note,
                        'code_ids', coalesce((select jsonb_agg(x.code_id order by x.code_id) from arch_node_code x where x.node_id = n.id), '[]'))
                      from arch_node n where n.id = p_id)
    when 'flow' then (select jsonb_build_object('from_node', f.from_node, 'to_node', f.to_node, 'label', f.label, 'manual', f.manual, 'note', f.note,
                        'code_ids', coalesce((select jsonb_agg(x.code_id order by x.code_id) from arch_flow_code x where x.flow_id = f.id), '[]'))
                      from arch_flow f where f.id = p_id)
    else (select jsonb_build_object('title', g.title, 'note', g.note,
            'code_ids', coalesce((select jsonb_agg(x.code_id order by x.code_id) from arch_gap_code x where x.gap_id = g.id), '[]'))
          from arch_gap g where g.id = p_id)
  end;
$$;

create or replace function log_arch_change(p_map_id uuid, p_kind text, p_object uuid, p_text text, p_before jsonb, p_after jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update arch_map set touched = true where id = p_map_id;
  insert into edit (object_type, object_id, text, before, after, edited_by)
  values ('arch_' || p_kind, p_object, p_text, p_before, p_after, auth.uid());
  insert into activity (project_id, actor, verb, object)
  select m.project_id, auth.uid(), 'edited an architecture map', m.ref || ' · ' || p_text from arch_map m where m.id = p_map_id;
end;
$$;

-- ─── Claude's drafts ─────────────────────────────────────────────────────

create or replace function start_arch_run(p_project_id uuid, p_model text, p_effort text, p_prompt_version text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can draw architecture maps.' using errcode = '42501';
  end if;
  if not exists (select 1 from project where id = p_project_id) then
    raise exception 'Unknown project.' using errcode = 'P0002';
  end if;
  update arch_run set status = 'failed', finished_at = now(), error = 'No result reported; presumed interrupted.'
  where project_id = p_project_id and status = 'running' and started_at < now() - interval '15 minutes';
  if exists (select 1 from arch_run where project_id = p_project_id and status = 'running') then
    raise exception 'An architecture map is already being drawn for this project.';
  end if;
  insert into arch_run (project_id, model, effort, prompt_version, started_by)
  values (p_project_id, p_model, p_effort, p_prompt_version, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Saves a draft: maps nobody has touched are replaced; each new map gets its
-- systems, then its flows and gaps one by one, so an item the database
-- refuses goes to review without losing the rest. A flow whose system was
-- refused is refused too. A map with no systems isn't kept.
--   p_maps: [{title, scope, nodes: [{name, kind, official, note, code_ids}],
--   flows: [{from, to (indexes into nodes), label, manual, note, code_ids}],
--   gaps: [{title, note, code_ids}]}]
create or replace function save_arch_run(p_run_id uuid, p_maps jsonb, p_rejections jsonb default '[]', p_usage jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r          arch_run%rowtype;
  mp         jsonb;
  it         jsonb;
  v_map      uuid;
  v_id       uuid;
  v_nodes    uuid[];
  v_ordinal  integer;
  v_i        integer;
  v_maps     integer := 0;
  v_accepted integer := 0;
  v_rejected integer := 0;
begin
  select * into r from arch_run where id = p_run_id for update;
  if not found then
    raise exception 'Unknown architecture run.' using errcode = 'P0002';
  end if;
  if r.started_by is distinct from auth.uid() then
    raise exception 'Only the person who started a run can save it.' using errcode = '42501';
  end if;
  if r.status <> 'running' then
    raise exception 'This run has already finished.';
  end if;

  delete from arch_map where project_id = r.project_id and origin = 'claude' and not touched;
  select coalesce(max(ordinal), 0) into v_ordinal from arch_map where project_id = r.project_id;

  for mp in select * from jsonb_array_elements(p_maps) loop
    v_ordinal := v_ordinal + 1;
    insert into arch_map (project_id, ref, title, scope, ordinal, origin, run_id, created_by)
    values (r.project_id, next_arch_ref(r.project_id), btrim(mp ->> 'title'), nullif(btrim(mp ->> 'scope'), ''),
            v_ordinal, 'claude', p_run_id, r.started_by)
    returning id into v_map;

    v_nodes := '{}';
    v_i := 0;
    for it in select * from jsonb_array_elements(mp -> 'nodes') loop
      v_i := v_i + 1;
      begin
        insert into arch_node (map_id, ordinal, name, kind, official, note)
        values (v_map, v_i, btrim(it ->> 'name'), coalesce(it ->> 'kind', 'system'), coalesce((it ->> 'official')::boolean, true),
                nullif(btrim(it ->> 'note'), ''))
        returning id into v_id;
        perform set_arch_codes('node', v_id, array(select x::uuid from jsonb_array_elements_text(coalesce(it -> 'code_ids', '[]')) x));
        v_accepted := v_accepted + 1;
      exception when others then
        v_id := null;
        insert into arch_rejection (run_id, project_id, proposal, reason)
        values (p_run_id, r.project_id, it || jsonb_build_object('item', 'system', 'map', mp ->> 'title'), sqlerrm);
        v_rejected := v_rejected + 1;
      end;
      v_nodes := v_nodes || v_id;
    end loop;

    for it in select * from jsonb_array_elements(coalesce(mp -> 'flows', '[]')) loop
      begin
        if v_nodes[(it ->> 'from')::integer + 1] is null or v_nodes[(it ->> 'to')::integer + 1] is null then
          raise exception 'One end of the flow isn''t on the map (its system was refused or doesn''t exist).';
        end if;
        insert into arch_flow (map_id, from_node, to_node, label, manual, note)
        values (v_map, v_nodes[(it ->> 'from')::integer + 1], v_nodes[(it ->> 'to')::integer + 1], btrim(it ->> 'label'),
                coalesce((it ->> 'manual')::boolean, true), nullif(btrim(it ->> 'note'), ''))
        returning id into v_id;
        perform set_arch_codes('flow', v_id, array(select x::uuid from jsonb_array_elements_text(coalesce(it -> 'code_ids', '[]')) x));
        v_accepted := v_accepted + 1;
      exception when others then
        insert into arch_rejection (run_id, project_id, proposal, reason)
        values (p_run_id, r.project_id, it || jsonb_build_object('item', 'flow', 'map', mp ->> 'title'), sqlerrm);
        v_rejected := v_rejected + 1;
      end;
    end loop;

    v_i := 0;
    for it in select * from jsonb_array_elements(coalesce(mp -> 'gaps', '[]')) loop
      v_i := v_i + 1;
      begin
        insert into arch_gap (map_id, ordinal, title, note)
        values (v_map, v_i, btrim(it ->> 'title'), nullif(btrim(it ->> 'note'), ''))
        returning id into v_id;
        perform set_arch_codes('gap', v_id, array(select x::uuid from jsonb_array_elements_text(coalesce(it -> 'code_ids', '[]')) x));
        v_accepted := v_accepted + 1;
      exception when others then
        insert into arch_rejection (run_id, project_id, proposal, reason)
        values (p_run_id, r.project_id, it || jsonb_build_object('item', 'gap', 'map', mp ->> 'title'), sqlerrm);
        v_rejected := v_rejected + 1;
      end;
    end loop;

    if not exists (select 1 from arch_node where map_id = v_map) then
      delete from arch_map where id = v_map;
    else
      v_maps := v_maps + 1;
    end if;
  end loop;

  insert into arch_rejection (run_id, project_id, proposal, reason)
  select p_run_id, r.project_id, x -> 'proposal', x ->> 'reason' from jsonb_array_elements(p_rejections) x;
  v_rejected := v_rejected + jsonb_array_length(p_rejections);

  update arch_run set
    status = 'done', finished_at = now(),
    served_by = p_usage ->> 'served_by',
    input_tokens = (p_usage ->> 'input_tokens')::integer,
    output_tokens = (p_usage ->> 'output_tokens')::integer,
    cost_usd = (p_usage ->> 'cost_usd')::numeric,
    proposed = v_accepted + v_rejected, accepted = v_accepted, rejected = v_rejected
  where id = p_run_id;
  insert into activity (project_id, actor, verb, object)
  values (r.project_id, r.started_by, 'drew the architecture', format('%s maps, %s items, %s for review', v_maps, v_accepted, v_rejected));
  return jsonb_build_object('maps', v_maps, 'accepted', v_accepted, 'rejected', v_rejected);
end;
$$;

create or replace function fail_arch_run(p_run_id uuid, p_error text, p_usage jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  update arch_run set
    status = 'failed', finished_at = now(), error = left(p_error, 2000),
    served_by = p_usage ->> 'served_by',
    input_tokens = (p_usage ->> 'input_tokens')::integer,
    output_tokens = (p_usage ->> 'output_tokens')::integer,
    cost_usd = (p_usage ->> 'cost_usd')::numeric
  where id = p_run_id and started_by = auth.uid() and status = 'running';
end;
$$;

create or replace function dismiss_arch_rejection(p_rejection_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_edit() then
    raise exception 'Only editors and owners can dismiss proposals.' using errcode = '42501';
  end if;
  update arch_rejection set resolution = 'dismissed', resolved_by = auth.uid(), resolved_at = now()
  where id = p_rejection_id and resolution is null;
end;
$$;

-- ─── the human layer ─────────────────────────────────────────────────────
-- One function per kind of change; each checks the editor, logs before and
-- after, and marks the map touched.

create or replace function create_arch_map(p_project_id uuid, p_title text, p_scope text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can add architecture maps.' using errcode = '42501';
  end if;
  insert into arch_map (project_id, ref, title, scope, ordinal, origin, touched)
  values (p_project_id, next_arch_ref(p_project_id), btrim(p_title), nullif(btrim(p_scope), ''),
          coalesce((select max(ordinal) + 1 from arch_map where project_id = p_project_id), 1), 'human', true)
  returning id into v_id;
  insert into activity (project_id, actor, verb, object)
  select p_project_id, auth.uid(), 'added an architecture map', m.ref || ' · ' || m.title from arch_map m where m.id = v_id;
  return v_id;
end;
$$;

create or replace function update_arch_map(p_map_id uuid, p_changes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  m arch_map%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit architecture maps.' using errcode = '42501';
  end if;
  select * into m from arch_map where id = p_map_id for update;
  if not found then
    raise exception 'Unknown architecture map.' using errcode = 'P0002';
  end if;
  update arch_map set
    title = case when p_changes ? 'title' then btrim(p_changes ->> 'title') else title end,
    scope = case when p_changes ? 'scope' then nullif(btrim(p_changes ->> 'scope'), '') else scope end
  where id = p_map_id;
  perform log_arch_change(p_map_id, 'map', p_map_id, format('edited %s', m.ref),
    jsonb_build_object('title', m.title, 'scope', m.scope),
    (select jsonb_build_object('title', title, 'scope', scope) from arch_map where id = p_map_id));
end;
$$;

create or replace function delete_arch_map(p_map_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m arch_map%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can delete architecture maps.' using errcode = '42501';
  end if;
  select * into m from arch_map where id = p_map_id;
  if not found then
    raise exception 'Unknown architecture map.' using errcode = 'P0002';
  end if;
  insert into activity (project_id, actor, verb, object) values (m.project_id, auth.uid(), 'deleted an architecture map', m.ref || ' · ' || m.title);
  delete from arch_map where id = p_map_id;
end;
$$;

-- Add (p_id null) or change a system, flow or gap. p_fields holds what the
-- kind needs: node {name, kind, official, note}, flow {from_node, to_node,
-- label, manual, note}, gap {title, note}; always code_ids.
create or replace function save_arch_item(p_map_id uuid, p_kind text, p_id uuid, p_fields jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid := p_id;
  v_before jsonb;
  v_label  text;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit architecture maps.' using errcode = '42501';
  end if;
  if p_kind not in ('node', 'flow', 'gap') then
    raise exception 'Unknown kind of item.';
  end if;
  if v_id is not null then
    v_before := arch_snapshot(p_kind, v_id);
    if v_before is null then
      raise exception 'Unknown item.' using errcode = 'P0002';
    end if;
  end if;

  if p_kind = 'node' then
    if v_id is null then
      insert into arch_node (map_id, ordinal, name, kind, official, note)
      values (p_map_id, coalesce((select max(ordinal) + 1 from arch_node where map_id = p_map_id), 1), btrim(p_fields ->> 'name'),
              coalesce(p_fields ->> 'kind', 'system'), coalesce((p_fields ->> 'official')::boolean, true), nullif(btrim(p_fields ->> 'note'), ''))
      returning id into v_id;
    else
      update arch_node set
        name = coalesce(btrim(p_fields ->> 'name'), name), kind = coalesce(p_fields ->> 'kind', kind),
        official = coalesce((p_fields ->> 'official')::boolean, official),
        note = case when p_fields ? 'note' then nullif(btrim(p_fields ->> 'note'), '') else note end
      where id = v_id and map_id = p_map_id;
    end if;
    v_label := coalesce(btrim(p_fields ->> 'name'), v_before ->> 'name');
  elsif p_kind = 'flow' then
    if v_id is null then
      insert into arch_flow (map_id, from_node, to_node, label, manual, note)
      values (p_map_id, (p_fields ->> 'from_node')::uuid, (p_fields ->> 'to_node')::uuid, btrim(p_fields ->> 'label'),
              coalesce((p_fields ->> 'manual')::boolean, true), nullif(btrim(p_fields ->> 'note'), ''))
      returning id into v_id;
    else
      update arch_flow set
        from_node = coalesce((p_fields ->> 'from_node')::uuid, from_node), to_node = coalesce((p_fields ->> 'to_node')::uuid, to_node),
        label = coalesce(btrim(p_fields ->> 'label'), label), manual = coalesce((p_fields ->> 'manual')::boolean, manual),
        note = case when p_fields ? 'note' then nullif(btrim(p_fields ->> 'note'), '') else note end
      where id = v_id and map_id = p_map_id;
    end if;
    v_label := coalesce(btrim(p_fields ->> 'label'), v_before ->> 'label');
  else
    if v_id is null then
      insert into arch_gap (map_id, ordinal, title, note)
      values (p_map_id, coalesce((select max(ordinal) + 1 from arch_gap where map_id = p_map_id), 1), btrim(p_fields ->> 'title'),
              nullif(btrim(p_fields ->> 'note'), ''))
      returning id into v_id;
    else
      update arch_gap set
        title = coalesce(btrim(p_fields ->> 'title'), title),
        note = case when p_fields ? 'note' then nullif(btrim(p_fields ->> 'note'), '') else note end
      where id = v_id and map_id = p_map_id;
    end if;
    v_label := coalesce(btrim(p_fields ->> 'title'), v_before ->> 'title');
  end if;
  if not found then
    raise exception 'That item isn''t part of this map.' using errcode = 'P0002';
  end if;

  if p_fields ? 'code_ids' or p_id is null then
    perform set_arch_codes(p_kind, v_id, array(select x::uuid from jsonb_array_elements_text(coalesce(p_fields -> 'code_ids', '[]')) x));
  end if;
  perform log_arch_change(p_map_id, p_kind, v_id,
    format('%s %s %s', case when p_id is null then 'added' else 'edited' end, case p_kind when 'node' then 'system' else p_kind end, v_label),
    v_before, arch_snapshot(p_kind, v_id));
  return v_id;
end;
$$;

-- Deleting a system takes its flows with it.
create or replace function delete_arch_item(p_map_id uuid, p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit architecture maps.' using errcode = '42501';
  end if;
  v_before := arch_snapshot(p_kind, p_id);
  if v_before is null then
    raise exception 'Unknown item.' using errcode = 'P0002';
  end if;
  if p_kind = 'node' then
    delete from arch_node where id = p_id and map_id = p_map_id;
  elsif p_kind = 'flow' then
    delete from arch_flow where id = p_id and map_id = p_map_id;
  else
    delete from arch_gap where id = p_id and map_id = p_map_id;
  end if;
  if not found then
    raise exception 'That item isn''t part of this map.' using errcode = 'P0002';
  end if;
  perform log_arch_change(p_map_id, p_kind, p_id,
    format('deleted %s %s', case p_kind when 'node' then 'system' else p_kind end, coalesce(v_before ->> 'name', v_before ->> 'label', v_before ->> 'title')),
    v_before, null);
end;
$$;

-- Codes an architecture map cites can't be deleted either.
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
  if exists (select 1 from arch_node_code where code_id = p_code_id)
     or exists (select 1 from arch_flow_code where code_id = p_code_id)
     or exists (select 1 from arch_gap_code where code_id = p_code_id) then
    raise exception '% is cited by an architecture map; merge it into another code instead of deleting it.', c.ref;
  end if;
  update code set merged_into_id = null where merged_into_id = p_code_id;
  perform log_code_change(c, format('deleted %s', c.ref), code_snapshot(c), null);
  delete from code where id = p_code_id;
end;
$$;

-- ─── access ──────────────────────────────────────────────────────────────

revoke execute on function
  start_arch_run, save_arch_run, fail_arch_run, dismiss_arch_rejection,
  create_arch_map, update_arch_map, delete_arch_map, save_arch_item, delete_arch_item,
  set_arch_codes, log_arch_change, arch_snapshot, next_arch_ref
from public, anon;
grant execute on function
  start_arch_run, save_arch_run, fail_arch_run, dismiss_arch_rejection,
  create_arch_map, update_arch_map, delete_arch_map, save_arch_item, delete_arch_item
to authenticated;

do $$
declare t text;
begin
  foreach t in array array['arch_run', 'arch_map', 'arch_node', 'arch_flow', 'arch_gap', 'arch_node_code', 'arch_flow_code', 'arch_gap_code', 'arch_rejection'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (has_seat())', t || '_read', t);
  end loop;
end;
$$;

commit;
