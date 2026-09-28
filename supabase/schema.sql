-- Interview Synthesis — schema
--
-- Derived from the Claude Design prototype's discovery-data.js. The provenance
-- chain that prototype *draws* — a claim in a client deliverable tracing back to
-- one line of one transcript — is enforced here by foreign keys.
--
-- Two invariants live in the database rather than the application:
--   1. transcript_line is append-only. Nothing may rewrite the record of what
--      someone said. This is what backs the tool's "transcripts are immutable"
--      refusal, and the reason storing a sha256 is worth anything.
--   2. Every mutable row carries the user that made it. The workspace is single
--      tenant today; this is the seam that makes multi-tenant a migration
--      rather than a rewrite.
--
-- Apply with: psql "$DATABASE_URL" -f supabase/schema.sql
-- or paste into the Supabase SQL editor.

begin;

-- ─── enums ───────────────────────────────────────────────────────────────

create type seat_role       as enum ('owner', 'editor', 'viewer');
create type transcript_src   as enum ('meet', 'zoom', 'otter', 'teams', 'granola', 'upload', 'wispr');
create type speaker_role     as enum ('interviewer', 'participant', 'other');
create type transcript_state as enum ('new', 'queued', 'coded');
create type code_type        as enum ('Pain', 'Step', 'Tool', 'Goal', 'Constraint', 'Question', 'Quote', 'Stakeholder');
create type product_kind     as enum ('deck', 'report', 'arch', 'flow', 'backlog');
create type project_state    as enum ('Coding', 'Synthesis', 'Artifacts', 'Delivered');

-- ─── people ──────────────────────────────────────────────────────────────

-- One row per person with access. Mirrors auth.users, adds the role the app
-- reasons about. The prototype's SEATS.
create table seat (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  initials   text not null,
  email      text not null unique,
  role       seat_role not null default 'viewer',
  title      text,
  created_at timestamptz not null default now()
);

-- ─── clients and projects ────────────────────────────────────────────────

create table client (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid not null references seat (user_id),
  created_at timestamptz not null default now()
);

create table project (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references client (id) on delete cascade,
  name       text not null,
  state      project_state not null default 'Coding',
  created_by uuid not null references seat (user_id),
  created_at timestamptz not null default now()
);
create index on project (client_id);

-- ─── stage 00: sources ───────────────────────────────────────────────────

create table transcript (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid references project (id) on delete set null,
  title            text not null,
  participant      text,
  participant_role text,
  source           transcript_src not null default 'upload',
  storage_path     text,
  original_name    text,
  -- Checksum of the uploaded file exactly as received. Recomputing this and
  -- finding a mismatch means the record is no longer the record.
  sha256           text not null,
  duration_mins    integer,
  recorded_on      date,
  status           transcript_state not null default 'new',
  ingested_at      timestamptz not null default now(),
  ingested_by      uuid not null references seat (user_id)
);
create index on transcript (project_id);
create index on transcript (status);
create unique index transcript_sha256_key on transcript (sha256);

-- ─── stage 01: the transcript itself ─────────────────────────────────────

-- Append-only. See the trigger below.
create table transcript_line (
  id            bigserial primary key,
  transcript_id uuid not null references transcript (id) on delete cascade,
  n             integer not null,
  speaker       text not null,
  text          text not null,
  ts_start      interval,
  ts_end        interval,
  unique (transcript_id, n)
);
create index on transcript_line (transcript_id);

-- Deleting a whole transcript is a legitimate act and cascades here; editing
-- or deleting one line of a kept transcript is not. Row triggers fire on
-- cascaded deletes too, so the two are told apart by the parent: during a
-- cascade the transcript row is already gone. security definer so that check
-- never depends on what the caller's row-level security lets them see.
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

create trigger transcript_line_no_update
  before update on transcript_line
  for each row execute function refuse_transcript_line_mutation();

create trigger transcript_line_no_delete
  before delete on transcript_line
  for each row execute function refuse_transcript_line_mutation();

-- Who each speaker in a transcript is. The lines keep the name exactly as the
-- export wrote it ("Jen :)", "Jennifer Koester"); this is where it gets a role,
-- so later stages know which turns are the participant's.
create table transcript_speaker (
  transcript_id uuid not null references transcript (id) on delete cascade,
  name          text not null,
  role          speaker_role not null default 'other',
  set_by        uuid not null references seat (user_id),
  set_at        timestamptz not null default now(),
  primary key (transcript_id, name)
);

-- ─── grouping: label axes ────────────────────────────────────────────────
-- Labels are defined per project: a logistics study groups by department and
-- level, a hospital study by unit and shift. The prototype's FACETS.

create table label_axis (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id) on delete cascade,
  key        text not null,
  name       text not null,
  ordinal    integer not null default 0,
  unique (project_id, key)
);

create table label_option (
  id      uuid primary key default gen_random_uuid(),
  axis_id uuid not null references label_axis (id) on delete cascade,
  value   text not null,
  ordinal integer not null default 0,
  unique (axis_id, value)
);

create table transcript_label (
  transcript_id uuid not null references transcript (id) on delete cascade,
  axis_id       uuid not null references label_axis (id) on delete cascade,
  option_id     uuid not null references label_option (id) on delete cascade,
  set_by        uuid not null references seat (user_id),
  set_at        timestamptz not null default now(),
  primary key (transcript_id, axis_id)
);

-- ─── stage 02: codes ─────────────────────────────────────────────────────

create table code (
  id             uuid primary key default gen_random_uuid(),
  transcript_id  uuid not null references transcript (id) on delete cascade,
  -- An inclusive range of line numbers. A single-line code has start = end.
  -- Both ends key on (transcript_id, n), so a range cannot straddle two
  -- transcripts or point at a line that does not exist.
  line_start     integer not null,
  line_end       integer not null,
  ref            text not null,            -- human-facing id, e.g. 'PAIN-03'
  type           code_type not null,
  label          text not null,
  -- Must be a literal substring of the range's lines joined with single
  -- spaces, and must touch both the first and last line so the range stays
  -- as tight as the quote. Enforced at write time by the application (see
  -- lib/claude/coding.ts) because the check needs the line text; this column
  -- existing at all is what makes the claim checkable.
  verbatim       text not null,
  note           text,
  -- Set when this code is folded into another; the row stays so that anything
  -- already citing it still resolves.
  merged_into_id uuid references code (id) on delete set null,
  created_by     uuid not null references seat (user_id),
  created_at     timestamptz not null default now(),
  unique (transcript_id, ref),
  check (line_start <= line_end),
  foreign key (transcript_id, line_start)
    references transcript_line (transcript_id, n) on delete cascade,
  foreign key (transcript_id, line_end)
    references transcript_line (transcript_id, n) on delete cascade
);
create index on code (transcript_id, line_start, line_end);
create index on code (type);

-- ─── stage 03: note templates and interview notes ────────────────────────

create table note_template (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid references project (id) on delete cascade,  -- null = workspace default
  name       text not null,
  scope      text,
  created_by uuid not null references seat (user_id),
  created_at timestamptz not null default now()
);

create table note_section (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references note_template (id) on delete cascade,
  ordinal     integer not null,
  name        text not null,
  requires    code_type[] not null default '{}',
  note        text,
  unique (template_id, ordinal)
);

create table note (
  id            uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references transcript (id) on delete cascade,
  template_id   uuid not null references note_template (id),
  generated_at  timestamptz not null default now(),
  generated_by  uuid not null references seat (user_id),
  unique (transcript_id, template_id)
);

create table note_item (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references note (id) on delete cascade,
  section_id uuid not null references note_section (id) on delete cascade,
  ordinal    integer not null,
  text       text not null
);
create index on note_item (note_id);

-- The refs[] array in the prototype. A note item with no codes is an assertion
-- with no evidence, which is the thing this tool exists to prevent.
create table note_item_code (
  note_item_id uuid not null references note_item (id) on delete cascade,
  code_id      uuid not null references code (id) on delete cascade,
  primary key (note_item_id, code_id)
);

-- ─── stage 04: themes and products ───────────────────────────────────────

create table theme (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id) on delete cascade,
  ref        text not null,               -- 'TH-1'
  title      text not null,
  ordinal    integer not null default 0,
  created_by uuid not null references seat (user_id),
  created_at timestamptz not null default now(),
  unique (project_id, ref)
);

-- Membership gives the "27 codes · 11 interviews" weight for free: count the
-- rows, count the distinct transcripts behind them.
create table theme_code (
  theme_id     uuid not null references theme (id) on delete cascade,
  code_id      uuid not null references code (id) on delete cascade,
  -- Whether a human has confirmed the machine's proposed cluster.
  confirmed    boolean not null default false,
  confirmed_by uuid references seat (user_id),
  primary key (theme_id, code_id)
);

create table product_template (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid references project (id) on delete cascade,
  name       text not null,
  kind       product_kind not null,
  scope      text,
  created_by uuid not null references seat (user_id),
  created_at timestamptz not null default now()
);

create table product_section (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references product_template (id) on delete cascade,
  ordinal     integer not null,
  name        text not null,
  requires    text[] not null default '{}',
  note        text,
  unique (template_id, ordinal)
);

create table product (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project (id) on delete cascade,
  template_id uuid not null references product_template (id),
  content     jsonb not null,
  rendered_at timestamptz not null default now(),
  rendered_by uuid not null references seat (user_id)
);
create index on product (project_id);

-- ─── the working layer: edits, locks, activity ───────────────────────────
-- Everything above the transcript is a working document. These three tables are
-- what make that true and legible.

create table edit (
  id          uuid primary key default gen_random_uuid(),
  object_type text not null,              -- 'code' | 'note_item' | 'theme'
  object_id   uuid not null,
  text        text,                       -- null when reverted
  reverted    boolean not null default false,
  edited_by   uuid not null references seat (user_id),
  edited_at   timestamptz not null default now()
);
create index on edit (object_type, object_id, edited_at desc);

-- Soft locks: one writer per object keeps the history linear.
create table lock (
  object_type text not null,
  object_id   uuid not null,
  held_by     uuid not null references seat (user_id),
  acquired_at timestamptz not null default now(),
  primary key (object_type, object_id)
);

create table activity (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid references project (id) on delete cascade,
  actor      uuid references seat (user_id),   -- null = the system
  verb       text not null,
  object     text not null,
  where_at   text,
  at         timestamptz not null default now()
);
create index on activity (project_id, at desc);

-- ─── row level security ──────────────────────────────────────────────────
-- Single workspace: everyone with a seat reads everything; only editors and
-- owners write; only owners hand out seats. When this goes multi-tenant, the
-- read policies grow a project membership check and nothing else has to move.
--
-- A Supabase account is not a seat. The @harringtondata.com check lives in the
-- sign-in form, but anyone holding the public anon key can create an account
-- straight against the Auth API, so every policy keys on the seat row, never
-- on merely being signed in.
--
-- security definer: these read seat, and seat's own policies call them. Run
-- as the caller they would re-enter those policies and recurse.

create or replace function current_seat_role()
returns seat_role language sql stable security definer set search_path = public as $$
  select role from seat where user_id = auth.uid();
$$;

create or replace function has_seat()
returns boolean language sql stable security definer set search_path = public as $$
  select current_seat_role() is not null;
$$;

create or replace function can_edit()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_seat_role() in ('owner', 'editor'), false);
$$;

create or replace function is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_seat_role() = 'owner', false);
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'seat', 'client', 'project', 'transcript', 'transcript_line', 'transcript_speaker',
    'label_axis', 'label_option', 'transcript_label', 'code',
    'note_template', 'note_section', 'note', 'note_item', 'note_item_code',
    'theme', 'theme_code', 'product_template', 'product_section', 'product',
    'edit', 'lock', 'activity'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (has_seat())',
      t || '_read', t);

    if t = 'seat' then
      -- An editor who could write seats could make themselves an owner.
      execute format(
        'create policy %I on %I for insert to authenticated with check (is_owner())',
        t || '_insert', t);
      execute format(
        'create policy %I on %I for update to authenticated using (is_owner())',
        t || '_update', t);
      execute format(
        'create policy %I on %I for delete to authenticated using (is_owner())',
        t || '_delete', t);
    elsif t = 'transcript' then
      -- Created only by ingest_transcript(), below; editable and deletable
      -- (assigning a project, fixing a title, dropping a bad upload) after.
      execute format(
        'create policy %I on %I for update to authenticated using (can_edit())',
        t || '_update', t);
      execute format(
        'create policy %I on %I for delete to authenticated using (can_edit())',
        t || '_delete', t);
    elsif t = 'transcript_line' then
      -- Written once, by ingest_transcript(), and never again.
      null;
    else
      execute format(
        'create policy %I on %I for insert to authenticated with check (can_edit())',
        t || '_insert', t);
      execute format(
        'create policy %I on %I for update to authenticated using (can_edit())',
        t || '_update', t);
      execute format(
        'create policy %I on %I for delete to authenticated using (can_edit())',
        t || '_delete', t);
    end if;
  end loop;
end;
$$;

-- ─── ingest: the only way a transcript gets in ───────────────────────────
-- One call writes the transcript, every line, and its speakers, or nothing.
-- A half-written transcript could only be undone by deleting it whole, since
-- lines can't be removed one at a time. Running as definer, it checks the
-- caller's role itself and records them as the ingester.

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
