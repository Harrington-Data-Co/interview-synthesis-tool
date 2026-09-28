-- Phase 1: ingest.
--
-- Run once in the Supabase SQL editor on a database built from schema.sql as
-- of commit 9acb090 (Phase 0 + the seat-only read policies). A fresh database
-- doesn't need this: schema.sql already includes everything below.
--
-- Adds:
--   - 'wispr' as a transcript source
--   - transcript_speaker: who each speaker in a transcript is
--   - ingest_transcript(): the only way a transcript and its lines get written
--   - the private 'transcripts' storage bucket for the original files
--   - a fix: deleting a whole transcript was blocked by the append-only
--     trigger, because row triggers fire on cascaded deletes too

-- Adding an enum value can't share a transaction with anything that uses it;
-- nothing below does, but keep it first and outside the block regardless.
alter type transcript_src add value if not exists 'wispr';

begin;

-- ─── append-only, but a whole transcript can still be deleted ────────────
-- During a cascade the parent transcript row is already gone; deleting one
-- line of a kept transcript still raises.

create or replace function refuse_transcript_line_mutation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE'
     and not exists (select 1 from transcript where id = old.transcript_id) then
    return old;
  end if;
  raise exception
    'transcript_line is append-only: a transcript is the record of what someone '
    'said and cannot be rewritten. Correct it in the code layer instead, where '
    'the change is attributed and the original stays verifiable.';
end;
$$;

-- ─── speakers ────────────────────────────────────────────────────────────

create type speaker_role as enum ('interviewer', 'participant', 'other');

create table transcript_speaker (
  transcript_id uuid not null references transcript (id) on delete cascade,
  name          text not null,
  role          speaker_role not null default 'other',
  set_by        uuid not null references seat (user_id),
  set_at        timestamptz not null default now(),
  primary key (transcript_id, name)
);

alter table transcript_speaker enable row level security;
create policy transcript_speaker_read on transcript_speaker
  for select to authenticated using (has_seat());
create policy transcript_speaker_insert on transcript_speaker
  for insert to authenticated with check (can_edit());
create policy transcript_speaker_update on transcript_speaker
  for update to authenticated using (can_edit());
create policy transcript_speaker_delete on transcript_speaker
  for delete to authenticated using (can_edit());

-- ─── ingest is the only way in ───────────────────────────────────────────

drop policy transcript_insert on transcript;
drop policy transcript_line_insert on transcript_line;

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

  -- Roles the uploader chose, then 'other' for any speaker they didn't.
  insert into transcript_speaker (transcript_id, name, role, set_by)
  select v_id, s ->> 'name', coalesce((s ->> 'role')::speaker_role, 'other'), v_uid
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

revoke execute on function ingest_transcript from public, anon;
grant execute on function ingest_transcript to authenticated;

-- ─── storage: the original files ─────────────────────────────────────────
-- Private. Objects are keyed by sha256, so the same file always lands at the
-- same path. No update or delete policy: an uploaded original is as
-- immutable as the lines parsed from it.

insert into storage.buckets (id, name, public, file_size_limit)
values ('transcripts', 'transcripts', false, 10485760)
on conflict (id) do nothing;

create policy transcripts_read on storage.objects
  for select to authenticated
  using (bucket_id = 'transcripts' and public.has_seat());
create policy transcripts_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'transcripts' and public.can_edit());

commit;
