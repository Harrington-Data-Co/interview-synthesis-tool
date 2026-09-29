-- Phase 2: coding.
--
-- Run once in the Supabase SQL editor on a database that has
-- 20260928c_labels_attribution_signup.sql applied. A fresh database doesn't
-- need this: schema.sql already includes everything below.
--
-- Adds:
--   - The quote check, in the database: a code's verbatim must appear word
--     for word in its line range, touching the first and last line. Every
--     path that writes a code is held to it, not just the coding pass.
--   - Claude's anchoring rule: a code of origin 'claude' can't include an
--     interviewer's line. People can code any speaker.
--   - coding_run: one row per pass — model, effort, tokens, cost, outcome.
--   - code_rejection: what Claude proposed that failed the check, kept for a
--     person to fix or dismiss rather than silently dropped.
--   - start_coding_run / save_coding_run / fail_coding_run: the pass's only
--     way to write, each checking the caller can edit; discard_claude_codes
--     clears Claude's codes for a re-run, keeping people's.
--   - The human layer: create_code, update_code, merge_codes, delete_code,
--     revert_last_code_edit, dismiss_rejection. Each logs to edit (with the
--     values before and after) and activity; direct writes to code are closed.

begin;

create type code_origin as enum ('claude', 'human');
create type run_status  as enum ('running', 'done', 'failed');

-- ─── runs ────────────────────────────────────────────────────────────────

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

create trigger coding_run_keep_started_by
  before update on coding_run
  for each row execute function keep_attribution('started_by');

-- ─── codes: origin and run ───────────────────────────────────────────────

alter table code
  add column origin code_origin not null default 'human',
  add column run_id uuid references coding_run (id) on delete set null;
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

-- ─── the quote check ─────────────────────────────────────────────────────

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

commit;
