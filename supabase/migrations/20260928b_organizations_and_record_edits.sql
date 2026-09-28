-- Organizations, speaker display names, and editable source records.
--
-- Run once in the Supabase SQL editor on a database that has
-- 20260928_phase1_ingest.sql applied. A fresh database doesn't need this:
-- schema.sql already includes everything below.
--
-- Adds:
--   - organization: who a speaker represents, nested (DOE › OEL). Distinct
--     from client, the paying customer a project is for.
--   - transcript_speaker.display_name and .organization_id. The lines keep the
--     name as the export wrote it; the display name is what the app shows.
--   - ingest_transcript() accepts both at upload.
--   - update_source_record(): the one way to edit a transcript's metadata and
--     speakers, logging every change to edit + activity.

begin;

-- ─── organizations ───────────────────────────────────────────────────────

create table organization (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid references organization (id) on delete restrict,
  name       text not null check (btrim(name) <> ''),
  created_by uuid not null references seat (user_id),
  created_at timestamptz not null default now(),
  check (parent_id is distinct from id)
);
-- Sibling names are unique, case-insensitively; the same name may recur under
-- different parents ("Finance" in two departments).
create unique index organization_sibling_name
  on organization (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'), lower(name));
create index on organization (parent_id);

create or replace function refuse_organization_cycle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null and exists (
    with recursive up (id, parent_id, depth) as (
      select id, parent_id, 1 from organization where id = new.parent_id
      union all
      select o.id, o.parent_id, up.depth + 1
      from organization o join up on o.id = up.parent_id
      where up.depth < 50
    )
    select 1 from up where id = new.id
  ) then
    raise exception 'An organization can''t sit under itself or one of its own sub-organizations.';
  end if;
  return new;
end;
$$;

create trigger organization_no_cycle
  before insert or update of parent_id on organization
  for each row execute function refuse_organization_cycle();

alter table organization enable row level security;
create policy organization_read on organization
  for select to authenticated using (has_seat());
create policy organization_insert on organization
  for insert to authenticated with check (can_edit());
create policy organization_update on organization
  for update to authenticated using (can_edit());
create policy organization_delete on organization
  for delete to authenticated using (can_edit());

-- ─── speakers: display name and organization ─────────────────────────────

alter table transcript_speaker
  add column display_name    text check (display_name is null or btrim(display_name) <> ''),
  add column organization_id uuid references organization (id) on delete set null;
create index on transcript_speaker (organization_id);
create index on transcript_speaker (lower(coalesce(display_name, name)));

-- ─── ingest: now takes display names and organizations ───────────────────

create or replace function ingest_transcript(
  p_title            text,
  p_sha256           text,
  p_storage_path     text,
  p_original_name    text,
  p_source           transcript_src,
  p_lines            jsonb,
  p_speakers         jsonb default '[]',
  p_participant      text default null,
  p_participant_role text default null,
  p_duration_mins    integer default null,
  p_recorded_on      date default null,
  p_project_id       uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_count integer;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can ingest transcripts.' using errcode = '42501';
  end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'sha256 must be 64 lowercase hex characters.';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A transcript needs at least one line.';
  end if;

  -- Lines are permanent, so their numbering must be exactly 1..N before any
  -- of them is written. A gap now would be a gap forever.
  select count(*) into v_count
  from jsonb_array_elements(p_lines) with ordinality as l(line, i)
  where (l.line ->> 'n')::integer <> l.i
     or coalesce(btrim(l.line ->> 'speaker'), '') = ''
     or coalesce(btrim(l.line ->> 'text'), '') = '';
  if v_count > 0 then
    raise exception 'Lines must be numbered 1..N in order, each with a speaker and text.';
  end if;

  insert into transcript (
    project_id, title, participant, participant_role, source, storage_path,
    original_name, sha256, duration_mins, recorded_on, status, ingested_by
  ) values (
    p_project_id, p_title, p_participant, p_participant_role, p_source, p_storage_path,
    p_original_name, p_sha256, p_duration_mins, p_recorded_on,
    case when p_project_id is null then 'new' else 'queued' end::transcript_state,
    v_uid
  )
  returning id into v_id;

  insert into transcript_line (transcript_id, n, speaker, text, ts_start, ts_end)
  select
    v_id,
    (l ->> 'n')::integer,
    l ->> 'speaker',
    l ->> 'text',
    case when jsonb_typeof(l -> 'ts_start') = 'number'
         then make_interval(secs => (l ->> 'ts_start')::float8) end,
    case when jsonb_typeof(l -> 'ts_end') = 'number'
         then make_interval(secs => (l ->> 'ts_end')::float8) end
  from jsonb_array_elements(p_lines) as l;

  -- What the uploader chose for each speaker, then defaults for any they
  -- didn't. A display name equal to the name as written is stored as null.
  insert into transcript_speaker (transcript_id, name, role, display_name, organization_id, set_by)
  select
    v_id,
    s ->> 'name',
    coalesce((s ->> 'role')::speaker_role, 'other'),
    nullif(nullif(btrim(s ->> 'display_name'), ''), s ->> 'name'),
    nullif(s ->> 'organization_id', '')::uuid,
    v_uid
  from jsonb_array_elements(p_speakers) as s
  where s ->> 'name' in (select speaker from transcript_line where transcript_id = v_id)
  on conflict do nothing;

  insert into transcript_speaker (transcript_id, name, set_by)
  select distinct v_id, speaker, v_uid from transcript_line where transcript_id = v_id
  on conflict do nothing;

  insert into activity (project_id, actor, verb, object)
  values (p_project_id, v_uid, 'ingested', p_title);

  return v_id;
end;
$$;

-- ─── editing a source record ─────────────────────────────────────────────
-- Everything about a transcript except its lines can change: title,
-- participant, participant role, recorded date, project, and each speaker's
-- display name, role and organization. One call, all or nothing, and every
-- change becomes an edit row carrying who made it and what it was before.
--
-- p_record: any of {title, participant, participant_role, recorded_on,
--   project_id}; a key that is present is applied (null clears it), a key that
--   is absent is left alone.
-- p_speakers: [{name, display_name?, role?, organization_id?}], same rule.

create or replace function update_source_record(
  p_transcript_id uuid,
  p_record        jsonb default '{}',
  p_speakers      jsonb default '[]'
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_old     transcript%rowtype;
  v_changes integer := 0;
  v_key     text;
  v_new     text;
  v_prev    text;
  v_project uuid;
  s         jsonb;
  sp        transcript_speaker%rowtype;
  v_dn      text;
  v_role    speaker_role;
  v_org     uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit a source record.' using errcode = '42501';
  end if;

  select * into v_old from transcript where id = p_transcript_id for update;
  if not found then
    raise exception 'Unknown transcript.' using errcode = 'P0002';
  end if;

  -- Plain text fields.
  foreach v_key in array array['title', 'participant', 'participant_role'] loop
    continue when not p_record ? v_key;
    v_new := nullif(btrim(p_record ->> v_key), '');
    if v_key = 'title' and v_new is null then
      raise exception 'A transcript needs a title.';
    end if;
    v_prev := to_jsonb(v_old) ->> v_key;
    if v_new is distinct from v_prev then
      execute format('update transcript set %I = $1 where id = $2', v_key) using v_new, p_transcript_id;
      insert into edit (object_type, object_id, text, edited_by)
      values ('transcript', p_transcript_id,
              format('%s: %s → %s', v_key, coalesce(quote_literal(v_prev), 'empty'), coalesce(quote_literal(v_new), 'empty')),
              v_uid);
      v_changes := v_changes + 1;
    end if;
  end loop;

  if p_record ? 'recorded_on' then
    v_new := nullif(btrim(p_record ->> 'recorded_on'), '');
    if v_new::date is distinct from v_old.recorded_on then
      update transcript set recorded_on = v_new::date where id = p_transcript_id;
      insert into edit (object_type, object_id, text, edited_by)
      values ('transcript', p_transcript_id,
              format('recorded_on: %s → %s', coalesce(v_old.recorded_on::text, 'empty'), coalesce(v_new, 'empty')),
              v_uid);
      v_changes := v_changes + 1;
    end if;
  end if;

  -- Project, which also sets status: assigned means queued, unassigned means
  -- new, and a coded transcript stays coded.
  if p_record ? 'project_id' then
    v_project := nullif(p_record ->> 'project_id', '')::uuid;
    if v_project is distinct from v_old.project_id then
      update transcript
      set project_id = v_project,
          status = case
            when v_old.status = 'coded' then 'coded'
            when v_project is null then 'new'
            else 'queued'
          end::transcript_state
      where id = p_transcript_id;
      insert into edit (object_type, object_id, text, edited_by)
      values ('transcript', p_transcript_id,
              format('project: %s → %s',
                     coalesce((select quote_literal(name) from project where id = v_old.project_id), 'unassigned'),
                     coalesce((select quote_literal(name) from project where id = v_project), 'unassigned')),
              v_uid);
      v_changes := v_changes + 1;
    end if;
  end if;

  -- Speakers. The name as written is the key and never changes.
  for s in select * from jsonb_array_elements(p_speakers) loop
    select * into sp from transcript_speaker
    where transcript_id = p_transcript_id and name = s ->> 'name'
    for update;
    if not found then
      raise exception 'Unknown speaker: %', s ->> 'name';
    end if;

    if s ? 'display_name' then
      v_dn := nullif(nullif(btrim(s ->> 'display_name'), ''), sp.name);
      if v_dn is distinct from sp.display_name then
        update transcript_speaker set display_name = v_dn, set_by = v_uid, set_at = now()
        where transcript_id = p_transcript_id and name = sp.name;
        insert into edit (object_type, object_id, text, edited_by)
        values ('transcript_speaker', p_transcript_id,
                format('%s display name: %s → %s', quote_literal(sp.name),
                       coalesce(quote_literal(sp.display_name), 'as written'), coalesce(quote_literal(v_dn), 'as written')),
                v_uid);
        v_changes := v_changes + 1;
      end if;
    end if;

    if s ? 'role' then
      v_role := coalesce(nullif(s ->> 'role', ''), 'other')::speaker_role;
      if v_role is distinct from sp.role then
        update transcript_speaker set role = v_role, set_by = v_uid, set_at = now()
        where transcript_id = p_transcript_id and name = sp.name;
        insert into edit (object_type, object_id, text, edited_by)
        values ('transcript_speaker', p_transcript_id,
                format('%s role: %s → %s', quote_literal(sp.name), sp.role, v_role), v_uid);
        v_changes := v_changes + 1;
      end if;
    end if;

    if s ? 'organization_id' then
      v_org := nullif(s ->> 'organization_id', '')::uuid;
      if v_org is distinct from sp.organization_id then
        update transcript_speaker set organization_id = v_org, set_by = v_uid, set_at = now()
        where transcript_id = p_transcript_id and name = sp.name;
        insert into edit (object_type, object_id, text, edited_by)
        values ('transcript_speaker', p_transcript_id,
                format('%s organization: %s → %s', quote_literal(sp.name),
                       coalesce((select quote_literal(name) from organization where id = sp.organization_id), 'none'),
                       coalesce((select quote_literal(name) from organization where id = v_org), 'none')),
                v_uid);
        v_changes := v_changes + 1;
      end if;
    end if;
  end loop;

  if v_changes > 0 then
    insert into activity (project_id, actor, verb, object)
    values (coalesce(v_project, v_old.project_id), v_uid, 'edited source record',
            (select title from transcript where id = p_transcript_id));
  end if;

  return v_changes;
end;
$$;

revoke execute on function update_source_record from public, anon;
grant execute on function update_source_record to authenticated;

commit;
