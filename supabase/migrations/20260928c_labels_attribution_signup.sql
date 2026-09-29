-- Labels, enforced attribution, and the sign-up domain hook.
--
-- Run once in the Supabase SQL editor on a database that has
-- 20260928b_organizations_and_record_edits.sql applied. A fresh database
-- doesn't need this: schema.sql already includes everything below.
--
-- After running it, turn the hook on: Authentication → Hooks → "Before User
-- Created" → Postgres → public.hook_restrict_signup_domain.
--
-- Adds:
--   - created_by on label_axis and label_option (they were the only mutable
--     rows without an author), and label integrity: an option must belong to
--     its axis, a label must belong to the transcript's project, and moving a
--     transcript to another project drops labels that no longer apply.
--   - Attribution enforced by the database: a row's author must be the person
--     writing it, and who created a row can never be changed afterwards.
--   - hook_restrict_signup_domain(): refuses to create accounts outside
--     @harringtondata.com, so the sign-in form's domain check is no longer the
--     only one.

begin;

-- ─── labels ──────────────────────────────────────────────────────────────
-- The tables are empty until this release (there was no UI), so the new
-- not-null columns need no backfill.

alter table label_axis
  add column created_by uuid not null default auth.uid() references seat (user_id),
  add column created_at timestamptz not null default now(),
  add constraint label_axis_name_present check (btrim(name) <> '');

alter table label_option
  add column created_by uuid not null default auth.uid() references seat (user_id),
  add column created_at timestamptz not null default now(),
  add constraint label_option_value_present check (btrim(value) <> ''),
  add constraint label_option_axis_id_id_key unique (axis_id, id);

-- The option must be one of that axis's options.
alter table transcript_label
  add constraint transcript_label_option_on_axis
  foreign key (axis_id, option_id) references label_option (axis_id, id) on delete cascade;

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

-- ─── attribution ─────────────────────────────────────────────────────────
-- (This block is repeated verbatim in schema.sql.)

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

commit;
