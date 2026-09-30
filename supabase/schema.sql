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
create type code_origin      as enum ('claude', 'human');
create type run_status       as enum ('running', 'done', 'failed');

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

-- Who a speaker represents, nested (Delaware DOE › Office of Early Learning).
-- Not the client: the client is who a project is for; an organization is who
-- a person in a transcript is with, and one call can mix several.
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
  -- What the app shows. Null means the name as written; the lines themselves
  -- always keep the export's own name.
  display_name    text check (display_name is null or btrim(display_name) <> ''),
  organization_id uuid references organization (id) on delete set null,
  set_by        uuid not null references seat (user_id),
  set_at        timestamptz not null default now(),
  primary key (transcript_id, name)
);
create index on transcript_speaker (organization_id);
create index on transcript_speaker (lower(coalesce(display_name, name)));

-- ─── grouping: label axes ────────────────────────────────────────────────
-- Labels are defined per project: a logistics study groups by department and
-- level, a hospital study by unit and shift. The prototype's FACETS.

create table label_axis (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id) on delete cascade,
  key        text not null,
  name       text not null,
  ordinal    integer not null default 0,
  created_by uuid not null default auth.uid() references seat (user_id),
  created_at timestamptz not null default now(),
  unique (project_id, key),
  constraint label_axis_name_present check (btrim(name) <> '')
);

create table label_option (
  id      uuid primary key default gen_random_uuid(),
  axis_id uuid not null references label_axis (id) on delete cascade,
  value   text not null,
  ordinal integer not null default 0,
  created_by uuid not null default auth.uid() references seat (user_id),
  created_at timestamptz not null default now(),
  unique (axis_id, value),
  constraint label_option_value_present check (btrim(value) <> ''),
  -- Target of transcript_label's (axis_id, option_id) key.
  constraint label_option_axis_id_id_key unique (axis_id, id)
);

create table transcript_label (
  transcript_id uuid not null references transcript (id) on delete cascade,
  axis_id       uuid not null references label_axis (id) on delete cascade,
  option_id     uuid not null references label_option (id) on delete cascade,
  set_by        uuid not null references seat (user_id),
  set_at        timestamptz not null default now(),
  primary key (transcript_id, axis_id),
  -- The option must be one of that axis's options.
  constraint transcript_label_option_on_axis
    foreign key (axis_id, option_id) references label_option (axis_id, id) on delete cascade
);

create or replace function refuse_label_from_other_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from transcript t join label_axis a on a.id = new.axis_id
    where t.id = new.transcript_id and t.project_id = a.project_id
  ) then
    raise exception 'That label belongs to a different project than the transcript.';
  end if;
  return new;
end;
$$;

create trigger transcript_label_same_project
  before insert or update on transcript_label
  for each row execute function refuse_label_from_other_project();

-- Labels are per project; a transcript that moves loses the old project's.
create or replace function drop_labels_from_old_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from transcript_label tl
  using label_axis a
  where tl.transcript_id = new.id
    and a.id = tl.axis_id
    and a.project_id is distinct from new.project_id;
  return null;
end;
$$;

create trigger transcript_drop_stale_labels
  after update of project_id on transcript
  for each row execute function drop_labels_from_old_project();


-- ─── stage 02: codes ─────────────────────────────────────────────────────

-- One row per coding pass: what was asked, what answered, what it cost.
create table coding_run (
  id             uuid primary key default gen_random_uuid(),
  transcript_id  uuid not null references transcript (id) on delete cascade,
  status         run_status not null default 'running',
  model          text not null,             -- what was asked for
  served_by      text,                      -- what answered (differs after a fallback)
  effort         text,
  prompt_version text not null,
  started_by     uuid not null references seat (user_id),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  input_tokens   integer,
  output_tokens  integer,
  cost_usd       numeric(10, 4),
  proposed       integer,                   -- codes Claude returned
  accepted       integer,                   -- that passed the check
  rejected       integer,                   -- that didn't, now in code_rejection
  error          text
);
create index on coding_run (transcript_id, started_at desc);

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
  -- as tight as the quote. Enforced by the code_anchor_checked trigger below,
  -- so every path that writes a code is held to it.
  verbatim       text not null,
  note           text,
  -- Set when this code is folded into another; the row stays so that anything
  -- already citing it still resolves.
  merged_into_id uuid references code (id) on delete set null,
  -- Who proposed it: Claude's pass, or a person. Claude's codes may only
  -- quote participants; people may code any speaker.
  origin         code_origin not null default 'human',
  run_id         uuid references coding_run (id) on delete set null,
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
create index on code (run_id);

-- A proposal that failed the check, with why. Resolved by fixing it into a
-- real code, or dismissing it.
create table code_rejection (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references coding_run (id) on delete cascade,
  transcript_id uuid not null references transcript (id) on delete cascade,
  proposal      jsonb not null,
  reason        text not null,
  resolution    text check (resolution in ('fixed', 'dismissed')),
  fixed_code_id uuid references code (id) on delete set null,
  resolved_by   uuid references seat (user_id),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index on code_rejection (transcript_id) where resolution is null;

create or replace function check_code_anchor()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_text  text;
  v_first integer;
  v_last  integer;
  v_q     text := new.verbatim;
  v_from  integer := 1;
  v_pos   integer;
  v_ok    boolean := false;
begin
  if coalesce(btrim(v_q), '') = '' then
    raise exception 'A code needs a quote.';
  end if;

  select string_agg(text, ' ' order by n) into v_text
  from transcript_line
  where transcript_id = new.transcript_id and n between new.line_start and new.line_end;
  select length(text) into v_first from transcript_line where transcript_id = new.transcript_id and n = new.line_start;
  select length(text) into v_last  from transcript_line where transcript_id = new.transcript_id and n = new.line_end;

  -- Any occurrence that starts within the first line and ends within the last
  -- line will do; a quote can appear more than once in a range.
  loop
    v_pos := strpos(substr(v_text, v_from), v_q);
    exit when v_pos = 0;
    v_pos := v_pos + v_from - 1;
    if v_pos <= v_first and v_pos + length(v_q) - 1 > length(v_text) - v_last then
      v_ok := true;
      exit;
    end if;
    v_from := v_pos + 1;
  end loop;

  if not v_ok then
    raise exception 'The quote isn''t word for word in lines %–%, or the range is wider than the quote.',
      new.line_start, new.line_end;
  end if;

  if new.origin = 'claude' and exists (
    select 1
    from transcript_line l
    join transcript_speaker s on s.transcript_id = l.transcript_id and s.name = l.speaker
    where l.transcript_id = new.transcript_id
      and l.n between new.line_start and new.line_end
      and s.role = 'interviewer'
  ) then
    raise exception 'Claude''s codes may only quote participants; lines %–% include an interviewer.',
      new.line_start, new.line_end;
  end if;

  return new;
end;
$$;

create trigger code_anchor_checked
  before insert or update of line_start, line_end, verbatim, origin on code
  for each row execute function check_code_anchor();

-- ─── refs: PAIN-03 ───────────────────────────────────────────────────────

create or replace function next_code_ref(p_transcript_id uuid, p_type code_type)
returns text language sql stable security definer set search_path = public as $$
  select prefix || '-' || lpad((coalesce(max(nullif(regexp_replace(ref, '^.*-', ''), '')::integer), 0) + 1)::text, 2, '0')
  from (
    select case p_type
      when 'Pain' then 'PAIN' when 'Step' then 'STEP' when 'Tool' then 'TOOL'
      when 'Goal' then 'GOAL' when 'Constraint' then 'CONS' when 'Question' then 'QUES'
      when 'Quote' then 'QUOTE' when 'Stakeholder' then 'STAKE'
    end as prefix
  ) p
  left join code c on c.transcript_id = p_transcript_id and c.ref like p.prefix || '-%'
  group by prefix;
$$;

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
  object_type text not null,              -- 'transcript' | 'transcript_speaker' | 'code' | 'note_item' | 'theme'
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
    'seat', 'client', 'project', 'organization', 'transcript', 'transcript_line', 'transcript_speaker',
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

-- ─── attribution ─────────────────────────────────────────────────────────
-- (This block is repeated verbatim in migration 20260928c.)

create or replace function keep_attribution()
returns trigger language plpgsql as $$
begin
  if to_jsonb(new) ->> tg_argv[0] is distinct from to_jsonb(old) ->> tg_argv[0] then
    raise exception '%.% records who made this row and can''t be changed.', tg_table_name, tg_argv[0];
  end if;
  return new;
end;
$$;

-- For each attributed table:
--   creator   — who made the row. Must be the writer on insert; never changes.
--   setter    — who last set it. Must be the writer on insert and on update.
--   confirmer — like setter, but may be null (not yet confirmed).
-- Functions that write on someone's behalf (ingest_transcript,
-- update_source_record) run as definer and set these from auth.uid() themselves.
do $$
declare
  r    record;
  cond text;
begin
  for r in
    select * from (values
      ('client',             'created_by',   'creator'),
      ('project',            'created_by',   'creator'),
      ('organization',       'created_by',   'creator'),
      ('label_axis',         'created_by',   'creator'),
      ('label_option',       'created_by',   'creator'),
      ('code',               'created_by',   'creator'),
      ('note_template',      'created_by',   'creator'),
      ('note',               'generated_by', 'creator'),
      ('theme',              'created_by',   'creator'),
      ('product_template',   'created_by',   'creator'),
      ('product',            'rendered_by',  'creator'),
      ('edit',               'edited_by',    'creator'),
      ('activity',           'actor',        'creator'),
      ('transcript',         'ingested_by',  'creator'),
      ('transcript_speaker', 'set_by',       'setter'),
      ('transcript_label',   'set_by',       'setter'),
      ('lock',               'held_by',      'setter'),
      ('theme_code',         'confirmed_by', 'confirmer')
    ) as v (t, col, kind)
  loop
    cond := case r.kind
      when 'confirmer' then format('(%1$I is null or %1$I = auth.uid())', r.col)
      else format('%I = auth.uid()', r.col)
    end;

    -- transcript has no insert policy at all: only ingest_transcript() adds one.
    if r.t <> 'transcript' then
      execute format('drop policy if exists %I on %I', r.t || '_insert', r.t);
      execute format(
        'create policy %I on %I for insert to authenticated with check (can_edit() and %s)',
        r.t || '_insert', r.t, cond);
    end if;

    if r.kind = 'creator' then
      execute format('drop trigger if exists %I on %I', r.t || '_keep_' || r.col, r.t);
      execute format(
        'create trigger %I before update on %I for each row execute function keep_attribution(%L)',
        r.t || '_keep_' || r.col, r.t, r.col);
    else
      execute format('drop policy if exists %I on %I', r.t || '_update', r.t);
      execute format(
        'create policy %I on %I for update to authenticated using (can_edit()) with check (can_edit() and %s)',
        r.t || '_update', r.t, cond);
    end if;
  end loop;
end;
$$;

-- ─── sign-up: @harringtondata.com only ───────────────────────────────────
-- Supabase Auth calls this before creating any account. Keep the domain in
-- step with ALLOWED_EMAIL_DOMAIN in src/lib/config.ts.

create or replace function public.hook_restrict_signup_domain(event jsonb)
returns jsonb language plpgsql stable as $$
declare
  v_email text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if v_email ~ '^[^@\s]+@harringtondata\.com$' then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Harrington Tools is internal for now. Sign in with your @harringtondata.com account.'
  ));
end;
$$;

grant execute on function public.hook_restrict_signup_domain to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_domain from authenticated, anon, public;

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

revoke execute on function ingest_transcript from public, anon;
grant execute on function ingest_transcript to authenticated;

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

-- ─── the pass's writes ───────────────────────────────────────────────────

-- Opens a run. Refuses while another run on the transcript is still going
-- (unless it has been silent for 15 minutes, i.e. died without reporting).
create or replace function start_coding_run(
  p_transcript_id  uuid,
  p_model          text,
  p_effort         text,
  p_prompt_version text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can run coding.' using errcode = '42501';
  end if;
  if not exists (select 1 from transcript where id = p_transcript_id) then
    raise exception 'Unknown transcript.' using errcode = 'P0002';
  end if;
  update coding_run set status = 'failed', finished_at = now(), error = 'No result reported; presumed interrupted.'
  where transcript_id = p_transcript_id and status = 'running' and started_at < now() - interval '15 minutes';
  if exists (select 1 from coding_run where transcript_id = p_transcript_id and status = 'running') then
    raise exception 'A coding pass is already running on this transcript.';
  end if;

  insert into coding_run (transcript_id, model, effort, prompt_version, started_by)
  values (p_transcript_id, p_model, p_effort, p_prompt_version, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Saves what the pass returned. Each code is inserted on its own: one that
-- the database refuses (the quote check, the anchoring rule) becomes a
-- rejection instead of sinking the run. Rejections the app already found are
-- stored as given. The transcript is marked coded.
create or replace function save_coding_run(
  p_run_id     uuid,
  p_codes      jsonb,
  p_rejections jsonb default '[]',
  p_usage      jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run      coding_run%rowtype;
  c          jsonb;
  v_accepted integer := 0;
  v_rejected integer := 0;
  v_title    text;
  v_project  uuid;
begin
  select * into v_run from coding_run where id = p_run_id for update;
  if not found then
    raise exception 'Unknown coding run.' using errcode = 'P0002';
  end if;
  if v_run.started_by is distinct from auth.uid() then
    raise exception 'Only the person who started a run can save it.' using errcode = '42501';
  end if;
  if v_run.status <> 'running' then
    raise exception 'This run has already finished.';
  end if;

  for c in select * from jsonb_array_elements(p_codes) loop
    begin
      insert into code (transcript_id, line_start, line_end, ref, type, label, verbatim, note, origin, run_id, created_by)
      values (
        v_run.transcript_id,
        (c ->> 'line_start')::integer,
        (c ->> 'line_end')::integer,
        next_code_ref(v_run.transcript_id, (c ->> 'type')::code_type),
        (c ->> 'type')::code_type,
        c ->> 'label',
        c ->> 'verbatim',
        nullif(c ->> 'note', ''),
        'claude',
        p_run_id,
        v_run.started_by
      );
      v_accepted := v_accepted + 1;
    exception when others then
      insert into code_rejection (run_id, transcript_id, proposal, reason)
      values (p_run_id, v_run.transcript_id, c, sqlerrm);
      v_rejected := v_rejected + 1;
    end;
  end loop;

  insert into code_rejection (run_id, transcript_id, proposal, reason)
  select p_run_id, v_run.transcript_id, r -> 'proposal', r ->> 'reason'
  from jsonb_array_elements(p_rejections) r;
  v_rejected := v_rejected + jsonb_array_length(p_rejections);

  update coding_run set
    status = 'done',
    finished_at = now(),
    served_by = p_usage ->> 'served_by',
    input_tokens = (p_usage ->> 'input_tokens')::integer,
    output_tokens = (p_usage ->> 'output_tokens')::integer,
    cost_usd = (p_usage ->> 'cost_usd')::numeric,
    proposed = v_accepted + v_rejected,
    accepted = v_accepted,
    rejected = v_rejected
  where id = p_run_id;

  update transcript set status = 'coded' where id = v_run.transcript_id
  returning title, project_id into v_title, v_project;

  insert into activity (project_id, actor, verb, object)
  values (v_project, v_run.started_by, 'coded', format('%s · %s codes, %s for review', v_title, v_accepted, v_rejected));

  return jsonb_build_object('accepted', v_accepted, 'rejected', v_rejected);
end;
$$;

create or replace function fail_coding_run(p_run_id uuid, p_error text, p_usage jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  update coding_run set
    status = 'failed',
    finished_at = now(),
    error = left(p_error, 2000),
    served_by = p_usage ->> 'served_by',
    input_tokens = (p_usage ->> 'input_tokens')::integer,
    output_tokens = (p_usage ->> 'output_tokens')::integer,
    cost_usd = (p_usage ->> 'cost_usd')::numeric
  where id = p_run_id and started_by = auth.uid() and status = 'running';
end;
$$;

-- Clears Claude's codes (and the rejections still awaiting review) so a
-- transcript can be coded again. People's codes are kept.
create or replace function discard_claude_codes(p_transcript_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n       integer;
  v_title   text;
  v_project uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can discard codes.' using errcode = '42501';
  end if;
  delete from code where transcript_id = p_transcript_id and origin = 'claude';
  get diagnostics v_n = row_count;
  delete from code_rejection where transcript_id = p_transcript_id and resolution is null;
  select title, project_id into v_title, v_project from transcript where id = p_transcript_id;
  insert into activity (project_id, actor, verb, object)
  values (v_project, auth.uid(), 'discarded Claude''s codes', format('%s · %s codes', v_title, v_n));
  return v_n;
end;
$$;

revoke execute on function start_coding_run, save_coding_run, fail_coding_run, discard_claude_codes from public, anon;
grant execute on function start_coding_run, save_coding_run, fail_coding_run, discard_claude_codes to authenticated;

-- ─── the human layer ─────────────────────────────────────────────────────
-- Every change to a code goes through these functions, so each one lands in
-- edit (with the values before and after, which is what makes revert
-- possible) and in activity. Direct writes to code are closed below.

alter table edit
  add column before jsonb,
  add column after  jsonb;

create or replace function code_snapshot(c code)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'ref', c.ref, 'type', c.type, 'label', c.label, 'note', c.note, 'verbatim', c.verbatim,
    'line_start', c.line_start, 'line_end', c.line_end, 'merged_into_id', c.merged_into_id
  );
$$;

create or replace function log_code_change(c code, p_text text, p_before jsonb, p_after jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into edit (object_type, object_id, text, before, after, edited_by)
  values ('code', c.id, p_text, p_before, p_after, auth.uid());
  insert into activity (project_id, actor, verb, object)
  select t.project_id, auth.uid(), 'edited codes', format('%s · %s', t.title, p_text)
  from transcript t where t.id = c.transcript_id;
end;
$$;

-- A person's code. Any speaker may be quoted; the quote check still applies.
-- Passing a rejection marks that proposal as fixed by this code.
create or replace function create_code(
  p_transcript_id uuid,
  p_type          code_type,
  p_label         text,
  p_verbatim      text,
  p_line_start    integer,
  p_line_end      integer,
  p_note          text default null,
  p_rejection_id  uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c code%rowtype;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can code.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_label), '') = '' then
    raise exception 'A code needs a label.';
  end if;

  insert into code (transcript_id, line_start, line_end, ref, type, label, verbatim, note, origin, created_by)
  values (p_transcript_id, p_line_start, p_line_end, next_code_ref(p_transcript_id, p_type), p_type,
          btrim(p_label), regexp_replace(btrim(p_verbatim), '\s+', ' ', 'g'), nullif(btrim(p_note), ''),
          'human', auth.uid())
  returning * into c;

  if p_rejection_id is not null then
    update code_rejection
    set resolution = 'fixed', fixed_code_id = c.id, resolved_by = auth.uid(), resolved_at = now()
    where id = p_rejection_id and transcript_id = p_transcript_id and resolution is null;
  end if;

  perform log_code_change(c, format('created %s', c.ref), null, code_snapshot(c));
  return c.id;
end;
$$;

-- Change any of: type, label, note, verbatim, line_start, line_end. A key
-- that's present is applied; absent keys are left alone. Retyping renumbers
-- the ref under the new type (PAIN-03 → GOAL-02).
create or replace function update_code(p_code_id uuid, p_changes jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  old     code%rowtype;
  c       code%rowtype;
  changed text[] := '{}';
begin
  if not can_edit() then
    raise exception 'Only editors and owners can edit codes.' using errcode = '42501';
  end if;
  select * into old from code where id = p_code_id for update;
  if not found then
    raise exception 'Unknown code.' using errcode = 'P0002';
  end if;
  c := old;

  if p_changes ? 'type' and (p_changes ->> 'type')::code_type is distinct from old.type then
    c.type := (p_changes ->> 'type')::code_type;
    c.ref := next_code_ref(old.transcript_id, c.type);
    changed := array_append(changed, 'type');
  end if;
  if p_changes ? 'label' and btrim(p_changes ->> 'label') is distinct from old.label then
    if coalesce(btrim(p_changes ->> 'label'), '') = '' then
      raise exception 'A code needs a label.';
    end if;
    c.label := btrim(p_changes ->> 'label');
    changed := array_append(changed, 'label');
  end if;
  if p_changes ? 'note' and nullif(btrim(p_changes ->> 'note'), '') is distinct from old.note then
    c.note := nullif(btrim(p_changes ->> 'note'), '');
    changed := array_append(changed, 'note');
  end if;
  if p_changes ? 'verbatim'
     and regexp_replace(btrim(p_changes ->> 'verbatim'), '\s+', ' ', 'g') is distinct from old.verbatim then
    c.verbatim := regexp_replace(btrim(p_changes ->> 'verbatim'), '\s+', ' ', 'g');
    changed := array_append(changed, 'quote');
  end if;
  if p_changes ? 'line_start' and (p_changes ->> 'line_start')::integer is distinct from old.line_start then
    c.line_start := (p_changes ->> 'line_start')::integer;
    changed := array_append(changed, 'lines');
  end if;
  if p_changes ? 'line_end' and (p_changes ->> 'line_end')::integer is distinct from old.line_end then
    c.line_end := (p_changes ->> 'line_end')::integer;
    if not 'lines' = any(changed) then changed := array_append(changed, 'lines'); end if;
  end if;

  if cardinality(changed) = 0 then
    return 0;
  end if;

  update code set ref = c.ref, type = c.type, label = c.label, note = c.note, verbatim = c.verbatim,
                  line_start = c.line_start, line_end = c.line_end
  where id = p_code_id;

  perform log_code_change(c, format('%s: %s', old.ref, array_to_string(changed, ', ')),
                          code_snapshot(old), code_snapshot(c));
  return cardinality(changed);
end;
$$;

-- Fold codes into one. The folded rows stay (anything citing them still
-- resolves) and point at the code they were merged into.
create or replace function merge_codes(p_keep uuid, p_merge uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  k code%rowtype;
  m code%rowtype;
  n integer := 0;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can merge codes.' using errcode = '42501';
  end if;
  select * into k from code where id = p_keep for update;
  if not found or k.merged_into_id is not null then
    raise exception 'The code to merge into must exist and not itself be merged.';
  end if;
  for m in select * from code where id = any(p_merge) and id <> p_keep for update loop
    if m.transcript_id <> k.transcript_id then
      raise exception 'Codes can only be merged within one transcript.';
    end if;
    if m.merged_into_id is not null then
      raise exception '% is already merged.', m.ref;
    end if;
    update code set merged_into_id = k.id where id = m.id;
    -- Anything already merged into m follows it.
    update code set merged_into_id = k.id where merged_into_id = m.id;
    perform log_code_change(m, format('merged %s into %s', m.ref, k.ref),
                            code_snapshot(m), code_snapshot(m) || jsonb_build_object('merged_into_id', k.id));
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Delete a code outright. Refused once a note cites it: merge it instead, so
-- the note's evidence still resolves.
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
  update code set merged_into_id = null where merged_into_id = p_code_id;
  perform log_code_change(c, format('deleted %s', c.ref), code_snapshot(c), null);
  delete from code where id = p_code_id;
end;
$$;

-- Undo the latest edit to a code that can be undone (a change or a merge),
-- restoring its values from before. The undone edit is marked reverted and
-- the revert is itself logged.
create or replace function revert_last_code_edit(p_code_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  e   edit%rowtype;
  c   code%rowtype;
  b   jsonb;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can revert edits.' using errcode = '42501';
  end if;
  select * into e from edit
  where object_type = 'code' and object_id = p_code_id and not reverted
    and before is not null and after is not null
  order by edited_at desc limit 1
  for update;
  if not found then
    raise exception 'There''s no edit to revert on this code.';
  end if;
  b := e.before;

  update code set
    ref = b ->> 'ref',
    type = (b ->> 'type')::code_type,
    label = b ->> 'label',
    note = b ->> 'note',
    verbatim = b ->> 'verbatim',
    line_start = (b ->> 'line_start')::integer,
    line_end = (b ->> 'line_end')::integer,
    merged_into_id = nullif(b ->> 'merged_into_id', '')::uuid
  where id = p_code_id
  returning * into c;
  update edit set reverted = true where id = e.id;

  perform log_code_change(c, format('reverted: %s', e.text), e.after, b);
  -- A revert isn't itself revertible by this function; edit again instead.
  update edit set reverted = true
  where id = (select id from edit where object_type = 'code' and object_id = p_code_id order by edited_at desc limit 1);
  return e.text;
end;
$$;

create or replace function dismiss_rejection(p_rejection_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_edit() then
    raise exception 'Only editors and owners can dismiss proposals.' using errcode = '42501';
  end if;
  update code_rejection set resolution = 'dismissed', resolved_by = auth.uid(), resolved_at = now()
  where id = p_rejection_id and resolution is null;
end;
$$;

revoke execute on function create_code, update_code, merge_codes, delete_code, revert_last_code_edit,
  dismiss_rejection, log_code_change from public, anon;
grant execute on function create_code, update_code, merge_codes, delete_code, revert_last_code_edit,
  dismiss_rejection to authenticated;

-- Codes are written only through the functions above (and the pass's).
drop policy if exists code_insert on code;
drop policy if exists code_update on code;
drop policy if exists code_delete on code;

-- ─── access ──────────────────────────────────────────────────────────────
-- Runs and rejections are written only by the functions above; everyone
-- with a seat can read them.

alter table coding_run enable row level security;
create policy coding_run_read on coding_run for select to authenticated using (has_seat());

alter table code_rejection enable row level security;
create policy code_rejection_read on code_rejection for select to authenticated using (has_seat());

-- coding_run is written only by functions, so it's outside the attribution
-- loop's policies; its author is still fixed once set.
create trigger coding_run_keep_started_by
  before update on coding_run
  for each row execute function keep_attribution('started_by');

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

-- ═══ Phase 3: interview notes ═══════════════════════════════════════════
-- Applied as migration 20260929b on existing databases; kept here verbatim,
-- in the same order, so a fresh install runs exactly what they ran.

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

-- ═══ Phase 4: themes and the findings memo ═════════════════════════════
-- Applied as migration 20260929c on existing databases; kept here verbatim,
-- in the same order, so a fresh install runs exactly what they ran.

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

-- ═══ Phase 5: the chain board and corpus views ═════════════════════════
-- Applied as migration 20260929d on existing databases; kept here verbatim,
-- in the same order, so a fresh install runs exactly what they ran.

-- ─── the code × interview matrix ─────────────────────────────────────────
-- A code belongs to one transcript, so what recurs across interviews is the
-- theme. One row per theme per interview: how many of that interview's active
-- codes the theme holds. Rows with a null theme count the interview's active
-- codes that no counted theme holds. Proposed themes count only when asked
-- for; confirmed ones always do. Saturation, coverage by label and the matrix
-- are all read from this.
create or replace function corpus_matrix(p_project_id uuid, p_include_proposed boolean default false)
returns table (theme_id uuid, transcript_id uuid, codes integer)
language sql stable security definer set search_path = public as $$
  with active as (
    select c.id, c.transcript_id
    from code c
    join transcript t on t.id = c.transcript_id
    where t.project_id = p_project_id and c.merged_into_id is null
  ),
  member as (
    select tc.theme_id, a.transcript_id, a.id as code_id
    from theme_code tc
    join theme th on th.id = tc.theme_id
    join active a on a.id = tc.code_id
    where th.project_id = p_project_id
      and (th.status = 'confirmed' or p_include_proposed)
  )
  select m.theme_id, m.transcript_id, count(*)::integer
  from member m
  where has_seat()
  group by m.theme_id, m.transcript_id
  union all
  select null::uuid, a.transcript_id, count(*)::integer
  from active a
  where has_seat() and not exists (select 1 from member m where m.code_id = a.id)
  group by a.transcript_id;
$$;

revoke execute on function corpus_matrix from public, anon;
grant execute on function corpus_matrix to authenticated;

-- ═══ Phase 6: connectors and deliverables ══════════════════════════════
-- Applied as migration 20260929e on existing databases; kept here verbatim,
-- in the same order, so a fresh install runs exactly what they ran.

-- ─── connectors: Google Drive, for Meet transcripts ──────────────────────
-- One connection per person per provider. The refresh token is encrypted by
-- the app (AES-256-GCM, key in CONNECTOR_TOKEN_KEY) before it gets here, so
-- the database alone can't reveal it. Each person sees only their own row;
-- writes go through the functions below.
create table connector_account (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references seat (user_id) on delete cascade,
  provider          text not null check (provider in ('google')),
  account_email     text not null,
  refresh_token_enc text not null,
  scopes            text not null,
  connected_at      timestamptz not null default now(),
  unique (user_id, provider)
);
alter table connector_account enable row level security;
create policy connector_account_read on connector_account
  for select to authenticated using (user_id = auth.uid());

-- Which outside files became which transcripts, so a file is never imported
-- twice and the connector can show what's already in the library.
create table connector_import (
  provider      text not null check (provider in ('google')),
  external_id   text not null,
  transcript_id uuid not null references transcript (id) on delete cascade,
  imported_by   uuid not null default auth.uid() references seat (user_id),
  imported_at   timestamptz not null default now(),
  primary key (provider, external_id)
);
create index on connector_import (transcript_id);
alter table connector_import enable row level security;
create policy connector_import_read on connector_import
  for select to authenticated using (has_seat());

create or replace function save_connector_account(p_provider text, p_email text, p_token_enc text, p_scopes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can connect an account.' using errcode = '42501';
  end if;
  insert into connector_account (user_id, provider, account_email, refresh_token_enc, scopes)
  values (auth.uid(), p_provider, p_email, p_token_enc, p_scopes)
  on conflict (user_id, provider) do update
    set account_email = excluded.account_email,
        refresh_token_enc = excluded.refresh_token_enc,
        scopes = excluded.scopes,
        connected_at = now()
  returning id into v_id;
  insert into activity (actor, verb, object)
  values (auth.uid(), 'connected ' || p_provider, p_email);
  return v_id;
end;
$$;

create or replace function remove_connector_account(p_provider text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from connector_account where user_id = auth.uid() and provider = p_provider;
end;
$$;

create or replace function record_connector_import(p_provider text, p_external_id text, p_transcript_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_edit() then
    raise exception 'Only editors and owners can import transcripts.' using errcode = '42501';
  end if;
  insert into connector_import (provider, external_id, transcript_id)
  values (p_provider, p_external_id, p_transcript_id)
  on conflict (provider, external_id) do nothing;
end;
$$;

revoke execute on function save_connector_account, remove_connector_account, record_connector_import from public, anon;
grant execute on function save_connector_account, remove_connector_account, record_connector_import to authenticated;

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
