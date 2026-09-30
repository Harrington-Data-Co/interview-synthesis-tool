-- Phase 6: swimlanes (process maps).
--
-- Run once in the Supabase SQL editor on a database that has
-- 20260929e_google_connector.sql applied. A fresh database doesn't need
-- this: schema.sql already includes everything below.
--
-- Adds process maps: a project's processes as participants described them.
-- flow (a map), flow_lane (who: a role, team or system), flow_step (what,
-- in which lane, at which position; task, wait or decision), each step
-- citing at least one code (checked at commit). flow_run / flow_rejection
-- as for the other Claude passes; a redraft replaces only maps nobody has
-- edited. The human layer (maps, lanes, steps; revert) logs before and
-- after values. delete_code() also refuses a code a process map cites.

begin;

-- ─── swimlanes: process maps ─────────────────────────────────────────────
-- A process as participants described it: who (lanes) does what (steps), in
-- what order (position). Every step cites the codes it rests on, so the map
-- is as traceable as the memo. Claude drafts maps from the codes; people
-- edit them, and a map a person has touched survives a redraft.

create table flow_run (
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
create index on flow_run (project_id, started_at desc);
create trigger flow_run_keep_started_by
  before update on flow_run
  for each row execute function keep_attribution('started_by');

create table flow (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id) on delete cascade,
  ref        text not null,                 -- 'PF-1'
  title      text not null check (btrim(title) <> ''),
  scope      text,                          -- where it starts and ends
  ordinal    integer not null default 0,
  origin     code_origin not null default 'human',
  run_id     uuid references flow_run (id) on delete set null,
  -- Set on any person's edit to the map, its lanes or its steps. A redraft
  -- replaces only maps nobody has touched.
  touched    boolean not null default false,
  created_by uuid not null default auth.uid() references seat (user_id),
  created_at timestamptz not null default now(),
  unique (project_id, ref)
);
create index on flow (project_id);
create trigger flow_keep_created_by
  before update on flow
  for each row execute function keep_attribution('created_by');

-- The actors: a role, a team or a system.
create table flow_lane (
  id      uuid primary key default gen_random_uuid(),
  flow_id uuid not null references flow (id) on delete cascade,
  ordinal integer not null,
  name    text not null check (btrim(name) <> ''),
  constraint flow_lane_order unique (flow_id, ordinal) deferrable initially deferred
);

-- A step sits in one lane at one position. Positions order the process left
-- to right; steps in different lanes may share one (work in parallel), and
-- gaps between positions mean nothing.
create table flow_step (
  id         uuid primary key default gen_random_uuid(),
  flow_id    uuid not null references flow (id) on delete cascade,
  lane_id    uuid not null references flow_lane (id) on delete cascade,
  position   integer not null check (position >= 1),
  label      text not null check (btrim(label) <> ''),
  kind       text not null default 'task' check (kind in ('task', 'wait', 'decision')),
  note       text,
  origin     code_origin not null default 'human',
  run_id     uuid references flow_run (id) on delete set null,
  created_by uuid not null default auth.uid() references seat (user_id),
  created_at timestamptz not null default now(),
  constraint flow_step_slot unique (lane_id, position) deferrable initially deferred
);
create index on flow_step (flow_id);
create trigger flow_step_keep_created_by
  before update on flow_step
  for each row execute function keep_attribution('created_by');

create table flow_step_code (
  step_id uuid not null references flow_step (id) on delete cascade,
  code_id uuid not null references code (id) on delete cascade,
  primary key (step_id, code_id)
);
create index on flow_step_code (code_id);

create table flow_rejection (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references flow_run (id) on delete cascade,
  project_id   uuid not null references project (id) on delete cascade,
  proposal     jsonb not null,
  reason       text not null,
  resolution   text check (resolution in ('fixed', 'dismissed')),
  resolved_by  uuid references seat (user_id),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index on flow_rejection (project_id) where resolution is null;

-- A step's lane is one of its own map's lanes.
create or replace function check_flow_step_lane()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from flow_lane where id = new.lane_id and flow_id = new.flow_id) then
    raise exception 'A step''s lane must belong to its own process map.';
  end if;
  return new;
end;
$$;
create trigger flow_step_lane_checked before insert or update of lane_id, flow_id on flow_step
  for each row execute function check_flow_step_lane();

-- A step cites codes of its own project, never one merged into another.
create or replace function check_flow_citation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c code%rowtype;
begin
  select * into c from code where id = new.code_id;
  if not exists (
    select 1 from flow_step s join flow f on f.id = s.flow_id join transcript t on t.project_id = f.project_id
    where s.id = new.step_id and t.id = c.transcript_id
  ) then
    raise exception 'A process step can only cite codes from its own project.';
  end if;
  if c.merged_into_id is not null then
    raise exception '% was merged into another code; cite that one instead.', c.ref;
  end if;
  return new;
end;
$$;
create trigger flow_step_code_checked before insert on flow_step_code
  for each row execute function check_flow_citation();

-- Every step cites at least one code, checked at commit.
create or replace function require_flow_citation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_step uuid;
begin
  if tg_table_name = 'flow_step' then
    v_step := new.id;
  else
    v_step := old.step_id;
  end if;
  if exists (select 1 from flow_step where id = v_step)
     and not exists (select 1 from flow_step_code where step_id = v_step) then
    raise exception 'Every process step must cite at least one code.';
  end if;
  return null;
end;
$$;
create constraint trigger flow_step_needs_citation after insert on flow_step
  deferrable initially deferred for each row execute function require_flow_citation();
create constraint trigger flow_step_code_keeps_citation after delete on flow_step_code
  deferrable initially deferred for each row execute function require_flow_citation();

create or replace function next_flow_ref(p_project_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select 'PF-' || (coalesce(max(nullif(regexp_replace(ref, '\D', '', 'g'), '')::integer), 0) + 1)
  from flow where project_id = p_project_id;
$$;

create or replace function flow_step_snapshot(p_step_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'lane_id', s.lane_id, 'position', s.position, 'label', s.label, 'kind', s.kind, 'note', s.note,
    'code_ids', coalesce((select jsonb_agg(x.code_id order by x.code_id) from flow_step_code x where x.step_id = s.id), '[]')
  )
  from flow_step s where s.id = p_step_id;
$$;

-- Log a person's change to a map, and mark the map as touched.
create or replace function log_flow_change(p_flow_id uuid, p_object_type text, p_object uuid, p_text text, p_before jsonb, p_after jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update flow set touched = true where id = p_flow_id;
  insert into edit (object_type, object_id, text, before, after, edited_by)
  values (p_object_type, p_object, p_text, p_before, p_after, auth.uid());
  insert into activity (project_id, actor, verb, object)
  select f.project_id, auth.uid(), 'edited a process map', f.ref || ' · ' || p_text from flow f where f.id = p_flow_id;
end;
$$;

create or replace function set_flow_step_codes(p_step_id uuid, p_code_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(cardinality(p_code_ids), 0) = 0 then
    raise exception 'Every process step must cite at least one code.';
  end if;
  delete from flow_step_code where step_id = p_step_id and not code_id = any(p_code_ids);
  insert into flow_step_code (step_id, code_id)
  select p_step_id, c from unnest(p_code_ids) c
  where not exists (select 1 from flow_step_code where step_id = p_step_id and code_id = c);
end;
$$;

-- ─── Claude's drafts ─────────────────────────────────────────────────────

create or replace function start_flow_run(p_project_id uuid, p_model text, p_effort text, p_prompt_version text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can draw process maps.' using errcode = '42501';
  end if;
  if not exists (select 1 from project where id = p_project_id) then
    raise exception 'Unknown project.' using errcode = 'P0002';
  end if;
  update flow_run set status = 'failed', finished_at = now(), error = 'No result reported; presumed interrupted.'
  where project_id = p_project_id and status = 'running' and started_at < now() - interval '15 minutes';
  if exists (select 1 from flow_run where project_id = p_project_id and status = 'running') then
    raise exception 'Process maps are already being drawn for this project.';
  end if;
  insert into flow_run (project_id, model, effort, prompt_version, started_by)
  values (p_project_id, p_model, p_effort, p_prompt_version, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Saves a draft: every map nobody has touched is replaced; each new map gets
-- its lanes, then its steps one by one, so a step the database refuses goes
-- to review without losing the rest. A map left with no steps isn't kept.
--   p_flows: [{title, scope, lanes: [name, …], steps: [{lane: index into
--   lanes, position, label, kind, note, code_ids: […]}]}]
create or replace function save_flow_run(p_run_id uuid, p_flows jsonb, p_rejections jsonb default '[]', p_usage jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r          flow_run%rowtype;
  fl         jsonb;
  st         jsonb;
  v_flow     uuid;
  v_step     uuid;
  v_lanes    uuid[];
  v_lane     uuid;
  v_name     text;
  v_i        integer;
  v_maps     integer := 0;
  v_accepted integer := 0;
  v_rejected integer := 0;
  v_ordinal  integer;
begin
  select * into r from flow_run where id = p_run_id for update;
  if not found then
    raise exception 'Unknown process-map run.' using errcode = 'P0002';
  end if;
  if r.started_by is distinct from auth.uid() then
    raise exception 'Only the person who started a run can save it.' using errcode = '42501';
  end if;
  if r.status <> 'running' then
    raise exception 'This run has already finished.';
  end if;

  delete from flow where project_id = r.project_id and origin = 'claude' and not touched;
  select coalesce(max(ordinal), 0) into v_ordinal from flow where project_id = r.project_id;

  for fl in select * from jsonb_array_elements(p_flows) loop
    v_ordinal := v_ordinal + 1;
    insert into flow (project_id, ref, title, scope, ordinal, origin, run_id, created_by)
    values (r.project_id, next_flow_ref(r.project_id), btrim(fl ->> 'title'), nullif(btrim(fl ->> 'scope'), ''),
            v_ordinal, 'claude', p_run_id, r.started_by)
    returning id into v_flow;
    v_lanes := '{}';
    v_i := 0;
    for v_name in select btrim(x) from jsonb_array_elements_text(fl -> 'lanes') x loop
      v_i := v_i + 1;
      insert into flow_lane (flow_id, ordinal, name) values (v_flow, v_i, v_name) returning id into v_lane;
      v_lanes := v_lanes || v_lane;
    end loop;

    for st in select * from jsonb_array_elements(fl -> 'steps') loop
      begin
        insert into flow_step (flow_id, lane_id, position, label, kind, note, origin, run_id, created_by)
        values (v_flow, v_lanes[(st ->> 'lane')::integer + 1], (st ->> 'position')::integer, btrim(st ->> 'label'),
                coalesce(st ->> 'kind', 'task'), nullif(btrim(st ->> 'note'), ''), 'claude', p_run_id, r.started_by)
        returning id into v_step;
        perform set_flow_step_codes(v_step, array(select x::uuid from jsonb_array_elements_text(coalesce(st -> 'code_ids', '[]')) x));
        set constraints flow_step_slot immediate;
        set constraints flow_step_slot deferred;
        v_accepted := v_accepted + 1;
      exception when others then
        insert into flow_rejection (run_id, project_id, proposal, reason)
        values (p_run_id, r.project_id, st || jsonb_build_object('flow', fl ->> 'title'), sqlerrm);
        v_rejected := v_rejected + 1;
      end;
    end loop;

    if not exists (select 1 from flow_step where flow_id = v_flow) then
      delete from flow where id = v_flow;
    else
      -- Lanes nobody stands in aren't drawn.
      delete from flow_lane l where l.flow_id = v_flow and not exists (select 1 from flow_step s where s.lane_id = l.id);
      v_maps := v_maps + 1;
    end if;
  end loop;

  insert into flow_rejection (run_id, project_id, proposal, reason)
  select p_run_id, r.project_id, x -> 'proposal', x ->> 'reason' from jsonb_array_elements(p_rejections) x;
  v_rejected := v_rejected + jsonb_array_length(p_rejections);

  update flow_run set
    status = 'done', finished_at = now(),
    served_by = p_usage ->> 'served_by',
    input_tokens = (p_usage ->> 'input_tokens')::integer,
    output_tokens = (p_usage ->> 'output_tokens')::integer,
    cost_usd = (p_usage ->> 'cost_usd')::numeric,
    proposed = v_accepted + v_rejected, accepted = v_accepted, rejected = v_rejected
  where id = p_run_id;
  insert into activity (project_id, actor, verb, object)
  values (r.project_id, r.started_by, 'drew process maps', format('%s maps, %s steps, %s for review', v_maps, v_accepted, v_rejected));
  return jsonb_build_object('maps', v_maps, 'accepted', v_accepted, 'rejected', v_rejected);
end;
$$;

create or replace function fail_flow_run(p_run_id uuid, p_error text, p_usage jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  update flow_run set
    status = 'failed', finished_at = now(), error = left(p_error, 2000),
    served_by = p_usage ->> 'served_by',
    input_tokens = (p_usage ->> 'input_tokens')::integer,
    output_tokens = (p_usage ->> 'output_tokens')::integer,
    cost_usd = (p_usage ->> 'cost_usd')::numeric
  where id = p_run_id and started_by = auth.uid() and status = 'running';
end;
$$;

create or replace function dismiss_flow_rejection(p_rejection_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_edit() then
    raise exception 'Only editors and owners can dismiss proposals.' using errcode = '42501';
  end if;
  update flow_rejection set resolution = 'dismissed', resolved_by = auth.uid(), resolved_at = now()
  where id = p_rejection_id and resolution is null;
end;
$$;

-- ─── the human layer ─────────────────────────────────────────────────────

create or replace function create_flow(p_project_id uuid, p_title text, p_scope text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can add process maps.' using errcode = '42501';
  end if;
  insert into flow (project_id, ref, title, scope, ordinal, origin, touched)
  values (p_project_id, next_flow_ref(p_project_id), btrim(p_title), nullif(btrim(p_scope), ''),
          coalesce((select max(ordinal) + 1 from flow where project_id = p_project_id), 1), 'human', true)
  returning id into v_id;
  insert into activity (project_id, actor, verb, object)
  select p_project_id, auth.uid(), 'added a process map', f.ref || ' · ' || f.title from flow f where f.id = v_id;
  return v_id;
end;
$$;

-- Title and scope. Keys left out are unchanged.
create or replace function update_flow(p_flow_id uuid, p_changes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  f flow%rowtype;
  v_before jsonb;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit process maps.' using errcode = '42501';
  end if;
  select * into f from flow where id = p_flow_id for update;
  if not found then
    raise exception 'Unknown process map.' using errcode = 'P0002';
  end if;
  v_before := jsonb_build_object('title', f.title, 'scope', f.scope);
  update flow set
    title = case when p_changes ? 'title' then btrim(p_changes ->> 'title') else title end,
    scope = case when p_changes ? 'scope' then nullif(btrim(p_changes ->> 'scope'), '') else scope end
  where id = p_flow_id;
  perform log_flow_change(p_flow_id, 'flow', p_flow_id, format('edited %s', f.ref), v_before,
    (select jsonb_build_object('title', title, 'scope', scope) from flow where id = p_flow_id));
end;
$$;

create or replace function delete_flow(p_flow_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  f flow%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can delete process maps.' using errcode = '42501';
  end if;
  select * into f from flow where id = p_flow_id;
  if not found then
    raise exception 'Unknown process map.' using errcode = 'P0002';
  end if;
  insert into activity (project_id, actor, verb, object) values (f.project_id, auth.uid(), 'deleted a process map', f.ref || ' · ' || f.title);
  delete from flow where id = p_flow_id;
end;
$$;

-- A new lane goes last.
create or replace function create_flow_lane(p_flow_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit process maps.' using errcode = '42501';
  end if;
  insert into flow_lane (flow_id, ordinal, name)
  values (p_flow_id, coalesce((select max(ordinal) + 1 from flow_lane where flow_id = p_flow_id), 1), btrim(p_name))
  returning id into v_id;
  perform log_flow_change(p_flow_id, 'flow_lane', v_id, format('added lane %s', btrim(p_name)), null, jsonb_build_object('name', btrim(p_name)));
  return v_id;
end;
$$;

create or replace function rename_flow_lane(p_lane_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l flow_lane%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit process maps.' using errcode = '42501';
  end if;
  select * into l from flow_lane where id = p_lane_id for update;
  if not found then
    raise exception 'Unknown lane.' using errcode = 'P0002';
  end if;
  update flow_lane set name = btrim(p_name) where id = p_lane_id;
  perform log_flow_change(l.flow_id, 'flow_lane', p_lane_id, format('renamed lane %s to %s', l.name, btrim(p_name)),
    jsonb_build_object('name', l.name), jsonb_build_object('name', btrim(p_name)));
end;
$$;

-- Swap a lane with its neighbour above (-1) or below (+1).
create or replace function move_flow_lane(p_lane_id uuid, p_delta integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  l flow_lane%rowtype;
  o flow_lane%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit process maps.' using errcode = '42501';
  end if;
  select * into l from flow_lane where id = p_lane_id for update;
  if not found then
    raise exception 'Unknown lane.' using errcode = 'P0002';
  end if;
  select * into o from flow_lane where flow_id = l.flow_id
    and case when p_delta < 0 then ordinal < l.ordinal else ordinal > l.ordinal end
    order by case when p_delta < 0 then -ordinal else ordinal end limit 1 for update;
  if not found then
    return;
  end if;
  update flow_lane set ordinal = o.ordinal where id = l.id;
  update flow_lane set ordinal = l.ordinal where id = o.id;
  perform log_flow_change(l.flow_id, 'flow_lane', l.id, format('moved lane %s', l.name),
    jsonb_build_object('ordinal', l.ordinal), jsonb_build_object('ordinal', o.ordinal));
end;
$$;

-- A lane with steps in it can't go: move or delete its steps first.
create or replace function delete_flow_lane(p_lane_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l flow_lane%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit process maps.' using errcode = '42501';
  end if;
  select * into l from flow_lane where id = p_lane_id for update;
  if not found then
    raise exception 'Unknown lane.' using errcode = 'P0002';
  end if;
  if exists (select 1 from flow_step where lane_id = p_lane_id) then
    raise exception '% still has steps; move or delete them first.', l.name;
  end if;
  delete from flow_lane where id = p_lane_id;
  perform log_flow_change(l.flow_id, 'flow_lane', p_lane_id, format('deleted lane %s', l.name), jsonb_build_object('name', l.name), null);
end;
$$;

-- A new step. With p_insert, it opens a new position: every step at or after
-- p_position moves one to the right. Without, it takes the free slot at
-- p_position in its lane.
create or replace function create_flow_step(
  p_flow_id uuid, p_lane_id uuid, p_position integer, p_label text, p_kind text, p_note text, p_code_ids uuid[], p_insert boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit process maps.' using errcode = '42501';
  end if;
  if p_insert then
    update flow_step set position = position + 1 where flow_id = p_flow_id and position >= p_position;
  end if;
  insert into flow_step (flow_id, lane_id, position, label, kind, note, origin)
  values (p_flow_id, p_lane_id, p_position, btrim(p_label), coalesce(p_kind, 'task'), nullif(btrim(p_note), ''), 'human')
  returning id into v_id;
  perform set_flow_step_codes(v_id, p_code_ids);
  perform log_flow_change(p_flow_id, 'flow_step', v_id, format('added step %s', btrim(p_label)), null, flow_step_snapshot(v_id));
  return v_id;
end;
$$;

-- Label, kind, note, lane, position and codes. Keys left out are unchanged.
create or replace function update_flow_step(p_step_id uuid, p_changes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  s flow_step%rowtype;
  v_before jsonb;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit process maps.' using errcode = '42501';
  end if;
  select * into s from flow_step where id = p_step_id for update;
  if not found then
    raise exception 'Unknown step.' using errcode = 'P0002';
  end if;
  v_before := flow_step_snapshot(p_step_id);
  update flow_step set
    label    = case when p_changes ? 'label' then btrim(p_changes ->> 'label') else label end,
    kind     = case when p_changes ? 'kind' then p_changes ->> 'kind' else kind end,
    note     = case when p_changes ? 'note' then nullif(btrim(p_changes ->> 'note'), '') else note end,
    lane_id  = case when p_changes ? 'lane_id' then (p_changes ->> 'lane_id')::uuid else lane_id end,
    position = case when p_changes ? 'position' then (p_changes ->> 'position')::integer else position end
  where id = p_step_id;
  if p_changes ? 'code_ids' then
    perform set_flow_step_codes(p_step_id, array(select x::uuid from jsonb_array_elements_text(p_changes -> 'code_ids') x));
  end if;
  set constraints flow_step_slot immediate;
  perform log_flow_change(s.flow_id, 'flow_step', p_step_id, format('edited step %s', s.label), v_before, flow_step_snapshot(p_step_id));
end;
$$;

create or replace function delete_flow_step(p_step_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s flow_step%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit process maps.' using errcode = '42501';
  end if;
  select * into s from flow_step where id = p_step_id for update;
  if not found then
    raise exception 'Unknown step.' using errcode = 'P0002';
  end if;
  perform log_flow_change(s.flow_id, 'flow_step', p_step_id, format('deleted step %s', s.label), flow_step_snapshot(p_step_id), null);
  delete from flow_step where id = p_step_id;
end;
$$;

-- Undo the last edit to a step still on the map.
create or replace function revert_last_flow_step_edit(p_step_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  e edit%rowtype;
  s flow_step%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can revert edits.' using errcode = '42501';
  end if;
  select * into s from flow_step where id = p_step_id for update;
  if not found then
    raise exception 'Unknown step.' using errcode = 'P0002';
  end if;
  select * into e from edit
  where object_type = 'flow_step' and object_id = p_step_id and not reverted and before is not null and after is not null
  order by edited_at desc limit 1 for update;
  if not found then
    raise exception 'Nothing to revert.';
  end if;
  update flow_step set
    lane_id = (e.before ->> 'lane_id')::uuid, position = (e.before ->> 'position')::integer,
    label = e.before ->> 'label', kind = e.before ->> 'kind', note = e.before ->> 'note'
  where id = p_step_id;
  perform set_flow_step_codes(p_step_id, array(select x::uuid from jsonb_array_elements_text(e.before -> 'code_ids') x));
  set constraints flow_step_slot immediate;
  update edit set reverted = true where id = e.id;
  update flow set touched = true where id = s.flow_id;
  insert into activity (project_id, actor, verb, object)
  select f.project_id, auth.uid(), 'reverted an edit', f.ref || ' · ' || s.label from flow f where f.id = s.flow_id;
end;
$$;

-- Codes a process map cites can't be deleted either.
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
  update code set merged_into_id = null where merged_into_id = p_code_id;
  perform log_code_change(c, format('deleted %s', c.ref), code_snapshot(c), null);
  delete from code where id = p_code_id;
end;
$$;

-- ─── access ──────────────────────────────────────────────────────────────

revoke execute on function
  start_flow_run, save_flow_run, fail_flow_run, dismiss_flow_rejection,
  create_flow, update_flow, delete_flow, create_flow_lane, rename_flow_lane, move_flow_lane, delete_flow_lane,
  create_flow_step, update_flow_step, delete_flow_step, revert_last_flow_step_edit,
  set_flow_step_codes, log_flow_change, flow_step_snapshot, next_flow_ref
from public, anon;
grant execute on function
  start_flow_run, save_flow_run, fail_flow_run, dismiss_flow_rejection,
  create_flow, update_flow, delete_flow, create_flow_lane, rename_flow_lane, move_flow_lane, delete_flow_lane,
  create_flow_step, update_flow_step, delete_flow_step, revert_last_flow_step_edit
to authenticated;

do $$
declare t text;
begin
  foreach t in array array['flow_run', 'flow', 'flow_lane', 'flow_step', 'flow_step_code', 'flow_rejection'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (has_seat())', t || '_read', t);
  end loop;
end;
$$;

commit;
