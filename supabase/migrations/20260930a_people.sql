-- People: who a speaker is, across interviews.
--
-- Until now a speaker existed only inside one transcript, keyed by the name
-- the export wrote ("Jen :)"). This adds a workspace-wide person behind each
-- speaker, so the tool can remember someone's organization and title from
-- one interview to the next, treat two export names in one call (phone, then
-- laptop) as one person, and say who spoke a quote.
--
--   - person: name, plus current organization and title (what the next
--     upload pre-fills). Current values follow the person's most recent
--     interview whenever a speaker of theirs changes, and can be edited.
--   - transcript_speaker.person_id (null: never identified, e.g. "Unknown")
--     and transcript_speaker.title: their job at the time of that call. The
--     speaker's organization stays per call too, so a person changing jobs
--     doesn't rewrite old interviews.
--   - transcript_speaker.display_name now follows the linked person's name
--     (kept in step by triggers), so everything that shows a speaker's name
--     shows the person's.
--   - Backfill: one person per distinct speaker name (case-insensitive),
--     skipping generic names ("Unknown", "Speaker 2"); each transcript's
--     participant role is copied onto its participant speaker as their title.
--   - Writes go through definer functions only: create_person,
--     update_person, merge_people, delete_person, and ingest_transcript /
--     update_source_record, which now take person_id / new_person / title
--     per speaker.
--   - code_speakers(project): who spoke each code's first line, for quote
--     attribution by the speaker's title.
--   - Client access: who may see a person goes through can_see_person(),
--     today has_seat(). When clients get access, it becomes "speaks in a
--     transcript of a project the viewer can see" and nothing else moves.
--
-- transcript.participant and participant_role stay for now; a later
-- migration drops them once nothing reads them.

-- ─── people ──────────────────────────────────────────────────────────────

create table person (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (btrim(name) <> ''),
  -- Current: from their most recent interview, or as last edited.
  organization_id uuid references organization (id) on delete set null,
  title           text check (title is null or btrim(title) <> ''),
  created_by      uuid not null references seat (user_id),
  created_at      timestamptz not null default now()
);
create index on person (lower(name));
create index on person (organization_id);

alter table transcript_speaker
  add column person_id uuid references person (id) on delete restrict,
  add column title     text check (title is null or btrim(title) <> '');
create index on transcript_speaker (person_id);

-- Who may see a person. Today: anyone with a seat, like everything else.
-- With client access: a person is visible to someone who can see a project
-- they speak in. Policies and functions ask this, never has_seat() directly.
create or replace function can_see_person(p_person_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select has_seat();
$$;

alter table person enable row level security;
create policy person_read on person for select to authenticated using (can_see_person(id));
-- No insert, update or delete policies: the functions below are the only way in.
grant select on person to authenticated;

create trigger person_keep_created_by
  before update on person for each row execute function keep_attribution('created_by');

-- Names no one should be merged by: exports' placeholders.
create or replace function is_generic_speaker(p_name text)
returns boolean language sql immutable as $$
  select btrim(p_name) ~* '^(unknown( speaker)?|speaker ?[0-9]*|participant ?[0-9]*|interviewer ?[0-9]*|guest ?[0-9]*|user ?[0-9]*|[0-9]+|\?+)$';
$$;

-- ─── keeping speakers and people in step ─────────────────────────────────

-- A linked speaker shows its person's name.
create or replace function speaker_follows_person()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.person_id is not null then
    new.display_name := nullif((select name from person where id = new.person_id), new.name);
  end if;
  return new;
end;
$$;

create trigger speaker_follows_person
  before insert or update of person_id, display_name on transcript_speaker
  for each row execute function speaker_follows_person();

create or replace function person_renamed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update transcript_speaker set display_name = nullif(new.name, name) where person_id = new.id;
  return null;
end;
$$;

create trigger person_renamed
  after update of name on person
  for each row execute function person_renamed();

-- A person's current organization and title: from their most recent
-- interview that has one (by date recorded, then uploaded), else unchanged.
create or replace function refresh_person_current(p_person_id uuid)
returns void language sql security definer set search_path = public as $$
  update person p set
    organization_id = coalesce((
      select s.organization_id from transcript_speaker s join transcript t on t.id = s.transcript_id
      where s.person_id = p.id and s.organization_id is not null
      order by t.recorded_on desc nulls last, t.ingested_at desc limit 1), p.organization_id),
    title = coalesce((
      select s.title from transcript_speaker s join transcript t on t.id = s.transcript_id
      where s.person_id = p.id and s.title is not null
      order by t.recorded_on desc nulls last, t.ingested_at desc limit 1), p.title)
  where p.id = p_person_id;
$$;

create or replace function speaker_refreshes_person()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.person_id is not null then
    perform refresh_person_current(new.person_id);
  end if;
  if tg_op = 'UPDATE' and old.person_id is not null and old.person_id is distinct from new.person_id then
    perform refresh_person_current(old.person_id);
  end if;
  return null;
end;
$$;

create trigger speaker_refreshes_person
  after insert or update of person_id, organization_id, title on transcript_speaker
  for each row execute function speaker_refreshes_person();

-- The person a speaker entry names: an existing person_id, or a new person
-- by name (created with the entry's organization and title). Two entries in
-- one call naming the same new person ("Dana" on the phone, then on a
-- laptop) get the same one. Neither key: null.
create or replace function person_for_speaker(s jsonb, p_uid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid := nullif(s ->> 'person_id', '')::uuid;
  v_name text := nullif(btrim(s ->> 'new_person'), '');
begin
  if v_id is not null then
    if not exists (select 1 from person where id = v_id) then
      raise exception 'Unknown person.';
    end if;
    return v_id;
  end if;
  if v_name is null then
    return null;
  end if;
  -- now() is the transaction's start, so this finds people made in this call.
  select id into v_id from person
  where lower(name) = lower(v_name) and created_by = p_uid and created_at = now();
  if v_id is null then
    insert into person (name, organization_id, title, created_by)
    values (v_name, nullif(s ->> 'organization_id', '')::uuid, nullif(btrim(s ->> 'title'), ''), p_uid)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function person_for_speaker from public, anon, authenticated;

-- ─── backfill ────────────────────────────────────────────────────────────

-- Each transcript's participant role becomes its participant's title, when
-- it's clear who the participant is: the one participant (however many
-- export names they had), or the participant speaker whose name matches.
update transcript_speaker s set title = btrim(t.participant_role)
from transcript t
where s.transcript_id = t.id
  and s.role = 'participant'
  and s.title is null
  and nullif(btrim(t.participant_role), '') is not null
  and (
    (select count(distinct lower(btrim(coalesce(x.display_name, x.name))))
     from transcript_speaker x where x.transcript_id = t.id and x.role = 'participant') = 1
    or lower(btrim(coalesce(s.display_name, s.name))) = lower(btrim(t.participant))
  );

-- One person per distinct name as shown, spelt as in their latest interview
-- (preferring a spelling with capitals: "Ryan Harrington", not "ryan harrington").
insert into person (name, created_by)
select distinct on (lower(btrim(coalesce(s.display_name, s.name))))
  btrim(coalesce(s.display_name, s.name)), s.set_by
from transcript_speaker s join transcript t on t.id = s.transcript_id
where not is_generic_speaker(coalesce(s.display_name, s.name))
order by lower(btrim(coalesce(s.display_name, s.name))),
         coalesce(s.display_name, s.name) ~ '[[:upper:]]' desc,
         t.recorded_on desc nulls last, t.ingested_at desc;

-- Linking fires the triggers above: display names follow, and each person's
-- current organization and title come from their latest interview.
update transcript_speaker s set person_id = p.id
from person p
where lower(btrim(coalesce(s.display_name, s.name))) = lower(p.name)
  and not is_generic_speaker(coalesce(s.display_name, s.name));

-- ─── ingest and source-record edits, now with people ─────────────────────

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
  s       jsonb;
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

  -- What the uploader chose for each speaker (who they are, their part in
  -- the call, organization and title), then defaults for any they didn't.
  -- A display name equal to the name as written is stored as null; with a
  -- person, the display name follows the person's name.
  for s in
    select value from jsonb_array_elements(p_speakers)
    where value ->> 'name' in (select speaker from transcript_line where transcript_id = v_id)
  loop
    insert into transcript_speaker (transcript_id, name, role, display_name, organization_id, title, person_id, set_by)
    values (
      v_id,
      s ->> 'name',
      coalesce(nullif(s ->> 'role', '')::speaker_role, 'other'),
      nullif(nullif(btrim(s ->> 'display_name'), ''), s ->> 'name'),
      nullif(s ->> 'organization_id', '')::uuid,
      nullif(btrim(s ->> 'title'), ''),
      person_for_speaker(s, v_uid),
      v_uid
    )
    on conflict do nothing;
  end loop;

  insert into transcript_speaker (transcript_id, name, set_by)
  select distinct v_id, speaker, v_uid from transcript_line where transcript_id = v_id
  on conflict do nothing;

  insert into activity (project_id, actor, verb, object)
  values (p_project_id, v_uid, 'ingested', p_title);

  return v_id;
end;
$$;

revoke execute on function ingest_transcript from public, anon;
grant execute on function ingest_transcript to authenticated;


-- ─── editing a source record ─────────────────────────────────────────────
-- Everything about a transcript except its lines can change: title,
-- participant, participant role, recorded date, project, and each speaker's
-- person, display name, part in the call (role), organization and title. One call, all or nothing, and every
-- change becomes an edit row carrying who made it and what it was before.
--
-- p_record: any of {title, participant, participant_role, recorded_on,
--   project_id}; a key that is present is applied (null clears it), a key that
--   is absent is left alone.
-- p_speakers: [{name, person_id? | new_person?, display_name?, role?,
--   organization_id?, title?}], same rule. person_id null unlinks.

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
  v_person  uuid;
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

    if s ? 'person_id' or s ? 'new_person' then
      v_person := person_for_speaker(s, v_uid);
      if v_person is distinct from sp.person_id then
        update transcript_speaker set person_id = v_person, set_by = v_uid, set_at = now()
        where transcript_id = p_transcript_id and name = sp.name;
        insert into edit (object_type, object_id, text, edited_by)
        values ('transcript_speaker', p_transcript_id,
                format('%s person: %s → %s', quote_literal(sp.name),
                       coalesce((select quote_literal(name) from person where id = sp.person_id), 'none'),
                       coalesce((select quote_literal(name) from person where id = v_person), 'none')),
                v_uid);
        v_changes := v_changes + 1;
      end if;
    end if;

    if s ? 'title' then
      v_dn := nullif(btrim(s ->> 'title'), '');
      if v_dn is distinct from sp.title then
        update transcript_speaker set title = v_dn, set_by = v_uid, set_at = now()
        where transcript_id = p_transcript_id and name = sp.name;
        insert into edit (object_type, object_id, text, edited_by)
        values ('transcript_speaker', p_transcript_id,
                format('%s title: %s → %s', quote_literal(sp.name),
                       coalesce(quote_literal(sp.title), 'empty'), coalesce(quote_literal(v_dn), 'empty')),
                v_uid);
        v_changes := v_changes + 1;
      end if;
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

-- ─── people: create, edit, merge, delete ─────────────────────────────────

create or replace function create_person(p_name text, p_organization_id uuid default null, p_title text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can add people.' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'A person needs a name.';
  end if;
  insert into person (name, organization_id, title, created_by)
  values (btrim(p_name), p_organization_id, nullif(btrim(p_title), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- p_changes: any of {name, organization_id, title}; present keys apply.
create or replace function update_person(p_person_id uuid, p_changes jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_old     person%rowtype;
  v_changes integer := 0;
  v_text    text;
  v_org     uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit people.' using errcode = '42501';
  end if;
  select * into v_old from person where id = p_person_id for update;
  if not found then
    raise exception 'Unknown person.' using errcode = 'P0002';
  end if;

  if p_changes ? 'name' then
    v_text := nullif(btrim(p_changes ->> 'name'), '');
    if v_text is null then
      raise exception 'A person needs a name.';
    end if;
    if v_text is distinct from v_old.name then
      update person set name = v_text where id = p_person_id;
      insert into edit (object_type, object_id, text, edited_by)
      values ('person', p_person_id, format('name: %s → %s', quote_literal(v_old.name), quote_literal(v_text)), v_uid);
      v_changes := v_changes + 1;
    end if;
  end if;

  if p_changes ? 'title' then
    v_text := nullif(btrim(p_changes ->> 'title'), '');
    if v_text is distinct from v_old.title then
      update person set title = v_text where id = p_person_id;
      insert into edit (object_type, object_id, text, edited_by)
      values ('person', p_person_id,
              format('title: %s → %s', coalesce(quote_literal(v_old.title), 'empty'), coalesce(quote_literal(v_text), 'empty')), v_uid);
      v_changes := v_changes + 1;
    end if;
  end if;

  if p_changes ? 'organization_id' then
    v_org := nullif(p_changes ->> 'organization_id', '')::uuid;
    if v_org is distinct from v_old.organization_id then
      update person set organization_id = v_org where id = p_person_id;
      insert into edit (object_type, object_id, text, edited_by)
      values ('person', p_person_id,
              format('organization: %s → %s',
                     coalesce((select quote_literal(name) from organization where id = v_old.organization_id), 'none'),
                     coalesce((select quote_literal(name) from organization where id = v_org), 'none')), v_uid);
      v_changes := v_changes + 1;
    end if;
  end if;

  return v_changes;
end;
$$;

-- Fold duplicates into one person: their speakers move over, and the kept
-- person takes any organization or title it lacks. Returns speakers moved.
create or replace function merge_people(p_keep_id uuid, p_merge_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_keep  person%rowtype;
  v_other person%rowtype;
  v_moved integer := 0;
  v_n     integer;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can merge people.' using errcode = '42501';
  end if;
  select * into v_keep from person where id = p_keep_id for update;
  if not found then
    raise exception 'Unknown person.' using errcode = 'P0002';
  end if;
  if p_keep_id = any (p_merge_ids) then
    raise exception 'A person can''t be merged into themselves.';
  end if;

  for v_other in select * from person where id = any (p_merge_ids) for update loop
    update transcript_speaker set person_id = p_keep_id, set_by = v_uid, set_at = now()
    where person_id = v_other.id;
    get diagnostics v_n = row_count;
    v_moved := v_moved + v_n;
    update person set
      organization_id = coalesce(organization_id, v_other.organization_id),
      title = coalesce(title, v_other.title)
    where id = p_keep_id;
    insert into edit (object_type, object_id, text, edited_by)
    values ('person', p_keep_id,
            format('merged in %s (%s speaker entr%s)', quote_literal(v_other.name), v_n, case when v_n = 1 then 'y' else 'ies' end), v_uid);
    delete from person where id = v_other.id;
  end loop;

  if (select count(*) from person where id = any (p_merge_ids)) > 0 then
    raise exception 'Some of those people couldn''t be merged.';
  end if;
  perform refresh_person_current(p_keep_id);
  return v_moved;
end;
$$;

-- Only someone who speaks in no interview; otherwise merge them instead.
create or replace function delete_person(p_person_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can delete people.' using errcode = '42501';
  end if;
  select count(distinct transcript_id) into v_n from transcript_speaker where person_id = p_person_id;
  if v_n > 0 then
    raise exception 'They speak in % interview%. Unlink them there, or merge them into someone else.', v_n, case when v_n = 1 then '' else 's' end;
  end if;
  delete from person where id = p_person_id;
end;
$$;

revoke execute on function create_person, update_person, merge_people, delete_person from public, anon;
grant execute on function create_person, update_person, merge_people, delete_person to authenticated;

-- Who spoke each code (the speaker of its first line), for attributing
-- quotes by title. Runs as the caller, so it sees what they may see.
create or replace function code_speakers(p_project_id uuid)
returns table (code_id uuid, speaker text, person_id uuid, title text, role speaker_role)
language sql stable set search_path = public as $$
  select c.id, l.speaker, s.person_id, s.title, s.role
  from code c
  join transcript t on t.id = c.transcript_id and t.project_id = p_project_id
  join transcript_line l on l.transcript_id = c.transcript_id and l.n = c.line_start
  join transcript_speaker s on s.transcript_id = c.transcript_id and s.name = l.speaker
  where c.merged_into_id is null;
$$;
revoke execute on function code_speakers from public, anon;
grant execute on function code_speakers to authenticated;
