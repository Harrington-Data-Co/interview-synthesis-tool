-- Invitations and project roles (2026-09-30). Starts from 20260930f_slugs.
--
-- Only invited people can use the tool, whatever their email domain, and
-- everyone sees only the projects they belong to. Decided with Ryan
-- 2026-09-30:
--
--   * Access is per project for everyone. A workspace owner sees and manages
--     everything; anyone else sees the projects they're a member of.
--   * Project roles: owner (manages members), editor, viewer, client.
--   * A client sees the deliverables (memo, deck, swimlanes, architecture),
--     confirmed themes, and the quotes those cite — attributed by title, not
--     name. No transcripts, notes, uncited codes, people or chain. An owner
--     can switch one client's access to "full": everything, read-only.
--   * Workspace owners invite anyone to anything; project owners invite to
--     their own project.
--   * Invitations expire after 14 days; they can be sent again or revoked.
--
-- A seat is still an account on the workspace (name, initials, email), and
-- authentication still isn't membership. What changes:
--
--   seat.role       is now the *workspace* role, and optional. owner, editor
--                   and viewer are Harrington's own people ("staff"): they
--                   also see the workspace-wide pages (People,
--                   Organizations, the template library, unassigned
--                   transcripts). Null is someone from outside — a client
--                   or partner — who sees only their projects.
--   project_member  who is on a project, as what.
--   invitation      a pending seat and/or membership for an email address,
--                   turned into the real thing on first sign-in.
--
-- How it's enforced:
--
--   Reads   every table's read policy asks which projects the reader belongs
--           to (my_projects, my_full_projects, my_transcripts).
--   Writes  the definer functions that do all the writing keep their coarse
--           can_edit() check ("an editor somewhere"); a guard trigger on each
--           project's tables then checks the project the row belongs to.
--           One trigger per table instead of a check in each of 150
--           functions, and nothing written later can forget it.
--
-- Run once in the Supabase SQL editor. Then, in Authentication → Hooks,
-- switch the Before User Created hook to public.hook_require_invitation.

begin;

-- ─── seats: the workspace role becomes optional ──────────────────────────

alter table seat alter column role drop default;
alter table seat alter column role drop not null;
-- Set when a workspace owner removes someone. The row stays, since it's the
-- author of everything they made; it just stops letting them in.
alter table seat add column deactivated_at timestamptz;

-- ─── project roles ───────────────────────────────────────────────────────

create type project_role as enum ('owner', 'editor', 'viewer', 'client');

create table project_member (
  project_id    uuid not null references project (id) on delete cascade,
  user_id       uuid not null references seat (user_id) on delete cascade,
  role          project_role not null,
  -- For clients only: the deliverables and their evidence, or everything
  -- (read-only).
  client_access text not null default 'deliverables' check (client_access in ('deliverables', 'full')),
  added_by      uuid references seat (user_id),
  added_at      timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index on project_member (user_id);

create table invitation (
  id             uuid primary key default gen_random_uuid(),
  email          text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name           text check (name is null or btrim(name) <> ''),
  -- What accepting gives: a workspace role (owners only), a project role, or both.
  workspace_role seat_role,
  project_id     uuid references project (id) on delete cascade,
  project_role   project_role,
  client_access  text not null default 'deliverables' check (client_access in ('deliverables', 'full')),
  invited_by     uuid not null references seat (user_id),
  invited_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '14 days',
  sent_count     integer not null default 1,
  accepted_at    timestamptz,
  accepted_by    uuid references seat (user_id),
  revoked_at     timestamptz,
  revoked_by     uuid references seat (user_id),
  check (workspace_role is not null or project_id is not null),
  check ((project_id is null) = (project_role is null))
);
-- One open invitation per address per project (or to the workspace alone).
create unique index invitation_open_key
  on invitation (email, coalesce(project_id, '00000000-0000-0000-0000-000000000000'))
  where accepted_at is null and revoked_at is null;

-- Everyone already here keeps exactly what they had: a member of every
-- existing project, with the role they had on the workspace.
insert into project_member (project_id, user_id, role, added_by)
select p.id, s.user_id, s.role::text::project_role, s.user_id
from project p cross join seat s
where s.role is not null;

-- ─── who is asking ───────────────────────────────────────────────────────
-- security definer throughout: these read seat and project_member, whose
-- own policies call them.

create or replace function current_seat_role()
returns seat_role language sql stable security definer set search_path = public as $$
  select role from seat where user_id = auth.uid() and deactivated_at is null;
$$;

-- Has an account here at all (any workspace role, or none).
create or replace function has_seat()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from seat where user_id = auth.uid() and deactivated_at is null);
$$;

-- Harrington's own people: a workspace role of any kind.
create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select current_seat_role() is not null;
$$;

create or replace function is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_seat_role() = 'owner', false);
$$;

-- May change workspace-wide things: clients, the template library, people
-- and organizations, unassigned transcripts.
create or replace function can_edit_workspace()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_seat_role() in ('owner', 'editor'), false);
$$;

-- The caller's active memberships.
create or replace function my_memberships()
returns setof project_member language sql stable security definer set search_path = public as $$
  select m.* from project_member m
  join seat s on s.user_id = m.user_id and s.deactivated_at is null
  where m.user_id = auth.uid();
$$;

-- An editor somewhere: of the workspace or of any project. The coarse gate
-- every writing function starts with; the guard triggers below then check
-- the particular project.
create or replace function can_edit()
returns boolean language sql stable security definer set search_path = public as $$
  select can_edit_workspace() or exists (select 1 from my_memberships() where role in ('owner', 'editor'));
$$;

-- The caller's role on a project: owner for a workspace owner, else their
-- membership's, else null.
create or replace function my_project_role(p_project_id uuid)
returns project_role language sql stable security definer set search_path = public as $$
  select case when is_owner() then 'owner'::project_role
              else (select role from my_memberships() where project_id = p_project_id) end;
$$;

create or replace function can_read_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select my_project_role(p_project_id) is not null;
$$;

-- Sees the working layer (transcripts, codes, notes, runs), not just the
-- deliverables: everyone but a client on deliverables-only access.
create or replace function can_read_project_full(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_owner() or exists (
    select 1 from my_memberships()
    where project_id = p_project_id and (role <> 'client' or client_access = 'full'));
$$;

create or replace function can_edit_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_owner() or exists (
    select 1 from my_memberships() where project_id = p_project_id and role in ('owner', 'editor'));
$$;

-- Adds and removes members, and invites.
create or replace function can_manage_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_owner() or exists (
    select 1 from my_memberships() where project_id = p_project_id and role = 'owner');
$$;

-- Sets of ids, for read policies: an uncorrelated `x in (select …)` is
-- worked out once per query rather than once per row.
create or replace function my_projects()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from project where is_owner()
  union
  select project_id from my_memberships();
$$;

create or replace function my_full_projects()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from project where is_owner()
  union
  select project_id from my_memberships() where role <> 'client' or client_access = 'full';
$$;

-- Transcripts whose working layer the caller sees: those in their full
-- projects, and unassigned ones for staff.
create or replace function my_transcripts()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from transcript where project_id in (select my_full_projects())
  union all
  select id from transcript where project_id is null and is_staff();
$$;

-- Workspace-wide lists a person needs to work in a project (organizations
-- for the speaker picker, the template library): staff, and anyone with
-- more than deliverables access somewhere.
create or replace function can_see_directory()
returns boolean language sql stable security definer set search_path = public as $$
  select is_staff() or exists (select 1 from my_memberships() where role <> 'client' or client_access = 'full');
$$;

-- ─── what a client sees: deliverables and their evidence ─────────────────

-- Codes a deliverable cites, or a confirmed theme holds, in projects the
-- caller may read at all. Codes merged into a cited code come along, as do
-- the codes a cited (merged) code was folded into.
create or replace function my_evidence_codes()
returns setof uuid language sql stable security definer set search_path = public as $$
  with mine as (select my_projects() as id),
  cited as (
    select pic.code_id from product_item_code pic
      join product_item i on i.id = pic.item_id join product p on p.id = i.product_id
      where p.project_id in (select id from mine)
    union select dc.code_id from deck_slide_code dc
      join deck_slide s on s.id = dc.slide_id join product p on p.id = s.product_id
      where p.project_id in (select id from mine)
    union select fc.code_id from flow_step_code fc
      join flow_step s on s.id = fc.step_id join flow f on f.id = s.flow_id
      where f.project_id in (select id from mine)
    union select nc.code_id from arch_node_code nc
      join arch_node n on n.id = nc.node_id join arch_map m on m.id = n.map_id
      where m.project_id in (select id from mine)
    union select fc.code_id from arch_flow_code fc
      join arch_flow f on f.id = fc.flow_id join arch_map m on m.id = f.map_id
      where m.project_id in (select id from mine)
    union select gc.code_id from arch_gap_code gc
      join arch_gap g on g.id = gc.gap_id join arch_map m on m.id = g.map_id
      where m.project_id in (select id from mine)
    union select tc.code_id from theme_code tc
      join theme th on th.id = tc.theme_id
      where th.status = 'confirmed' and th.project_id in (select id from mine)
  )
  select code_id from cited
  union
  select c.merged_into_id from code c where c.id in (select code_id from cited) and c.merged_into_id is not null
  union
  select c.id from code c where c.merged_into_id in (select code_id from cited);
$$;

-- Themes a client sees: confirmed ones, and any a deliverable cites.
create or replace function my_evidence_themes()
returns setof uuid language sql stable security definer set search_path = public as $$
  select th.id from theme th
  where th.project_id in (select my_projects())
    and (th.status = 'confirmed'
         or exists (select 1 from product_item_theme pit where pit.theme_id = th.id)
         or exists (select 1 from deck_slide_theme dst where dst.theme_id = th.id));
$$;

-- People: staff see everyone (People is a workspace page); others see the
-- people who speak in transcripts they can read.
create or replace function can_see_person(p_person_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_staff() or exists (
    select 1 from transcript_speaker s
    where s.person_id = p_person_id and s.transcript_id in (select my_transcripts()));
$$;

-- Accounts the caller may see: their own, everyone for staff, and anyone
-- they share a project with (unless they're a deliverables-only client).
create or replace function can_see_seat(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user_id = auth.uid() or is_staff() or exists (
    select 1 from project_member m
    where m.user_id = p_user_id and m.project_id in (select my_full_projects()));
$$;

-- ─── which project a row belongs to ──────────────────────────────────────
-- Null: no project — an unassigned transcript, a library template, or a row
-- that doesn't exist.

create or replace function scope_project(p_kind text, p_id uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if p_id is null then
    return null;
  end if;
  return case p_kind
    when 'project'          then p_id
    when 'transcript'       then (select project_id from transcript where id = p_id)
    when 'label_axis'       then (select project_id from label_axis where id = p_id)
    when 'code'             then (select t.project_id from code c join transcript t on t.id = c.transcript_id where c.id = p_id)
    when 'note_template'    then (select project_id from note_template where id = p_id)
    when 'note'             then (select t.project_id from note n join transcript t on t.id = n.transcript_id where n.id = p_id)
    when 'note_item'        then (select t.project_id from note_item i join note n on n.id = i.note_id
                                    join transcript t on t.id = n.transcript_id where i.id = p_id)
    when 'theme'            then (select project_id from theme where id = p_id)
    when 'product_template' then (select project_id from product_template where id = p_id)
    when 'product'          then (select project_id from product where id = p_id)
    when 'product_item'     then (select p.project_id from product_item i join product p on p.id = i.product_id where i.id = p_id)
    when 'deck_slide'       then (select p.project_id from deck_slide s join product p on p.id = s.product_id where s.id = p_id)
    when 'flow'             then (select project_id from flow where id = p_id)
    when 'flow_lane'        then (select f.project_id from flow_lane l join flow f on f.id = l.flow_id where l.id = p_id)
    when 'flow_step'        then (select f.project_id from flow_step s join flow f on f.id = s.flow_id where s.id = p_id)
    when 'arch_map'         then (select project_id from arch_map where id = p_id)
    when 'arch_node'        then (select m.project_id from arch_node n join arch_map m on m.id = n.map_id where n.id = p_id)
    when 'arch_flow'        then (select m.project_id from arch_flow f join arch_map m on m.id = f.map_id where f.id = p_id)
    when 'arch_gap'         then (select m.project_id from arch_gap g join arch_map m on m.id = g.map_id where g.id = p_id)
    else null
  end;
end;
$$;

-- The project an edit row is about, from what it names. Deleted objects and
-- workspace things (people, organizations, clients) have none.
create or replace function edit_project(p_object_type text, p_object_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case
    when p_object_type in ('transcript', 'transcript_speaker') then scope_project('transcript', p_object_id)
    when p_object_type in ('product_item', 'product')
      then coalesce(scope_project('product_item', p_object_id), scope_project('product', p_object_id))
    when p_object_type = 'deck_slide'
      then coalesce(scope_project('deck_slide', p_object_id), scope_project('product', p_object_id))
    when p_object_type in ('code', 'note_item', 'theme', 'flow', 'flow_lane', 'flow_step',
                           'arch_map', 'arch_node', 'arch_flow', 'arch_gap')
      then scope_project(p_object_type, p_object_id)
  end;
$$;

-- ─── the write guard ─────────────────────────────────────────────────────

-- Set for the rest of the transaction by workspace operations that touch
-- rows across projects (merging people or organizations), after they've
-- checked the caller is a workspace editor. Not settable through the API.
create or replace function workspace_op()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_setting('app.workspace_op', true), '') = coalesce(auth.uid()::text, '-')
     and can_edit_workspace();
$$;

create or replace function begin_workspace_op()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_edit_workspace() then
    raise exception 'Only Harrington editors can change people and organizations.' using errcode = '42501';
  end if;
  perform set_config('app.workspace_op', auth.uid()::text, true);
end;
$$;

create or replace function require_scope_edit(p_kind text, p_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  v_project uuid := scope_project(p_kind, p_id);
begin
  if v_project is null then
    if not can_edit_workspace() then
      raise exception 'Only Harrington editors can change things outside a project.' using errcode = '42501';
    end if;
  elsif not can_edit_project(v_project) then
    raise exception 'You can''t make changes in %. Ask its owner to make you an editor.',
      coalesce((select name from project where id = v_project), 'that project') using errcode = '42501';
  end if;
end;
$$;

-- BEFORE INSERT/UPDATE/DELETE, for each row. tg_argv: the kind of thing the
-- row hangs off and the column naming it ('transcript', 'transcript_id').
-- Checks the person's own writes, whether direct or through a definer
-- function; skips writes with no person behind them (the service role, the
-- SQL editor) and writes set off by another trigger (cascades, follow-on
-- updates), since the write that set them off was checked.
create or replace function guard_project_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old uuid;
  v_new uuid;
begin
  if auth.uid() is null or pg_trigger_depth() > 1 or workspace_op() then
    return coalesce(new, old);
  end if;
  if tg_op <> 'INSERT' then
    v_old := (to_jsonb(old) ->> tg_argv[1])::uuid;
    perform require_scope_edit(tg_argv[0], v_old);
  end if;
  if tg_op <> 'DELETE' then
    v_new := (to_jsonb(new) ->> tg_argv[1])::uuid;
    -- Moving a row (a transcript to another project) needs both ends.
    if tg_op = 'INSERT' or v_new is distinct from v_old then
      perform require_scope_edit(tg_argv[0], v_new);
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

do $$
declare r record;
begin
  for r in
    select * from (values
      ('transcript',             'project',          'project_id'),
      ('transcript_line',        'transcript',       'transcript_id'),
      ('transcript_speaker',     'transcript',       'transcript_id'),
      ('transcript_label',       'transcript',       'transcript_id'),
      ('label_axis',             'project',          'project_id'),
      ('label_option',           'label_axis',       'axis_id'),
      ('coding_run',             'transcript',       'transcript_id'),
      ('code',                   'transcript',       'transcript_id'),
      ('code_rejection',         'transcript',       'transcript_id'),
      ('note_template',          'project',          'project_id'),
      ('note_section',           'note_template',    'template_id'),
      ('note',                   'transcript',       'transcript_id'),
      ('note_run',               'transcript',       'transcript_id'),
      ('note_item',              'note',             'note_id'),
      ('note_item_code',         'note_item',        'note_item_id'),
      ('note_item_rejection',    'note',             'note_id'),
      ('theme',                  'project',          'project_id'),
      ('theme_code',             'theme',            'theme_id'),
      ('theme_run',              'project',          'project_id'),
      ('theme_rejection',        'project',          'project_id'),
      ('product_template',       'project',          'project_id'),
      ('product_section',        'product_template', 'template_id'),
      ('product',                'project',          'project_id'),
      ('product_run',            'project',          'project_id'),
      ('product_item',           'product',          'product_id'),
      ('product_item_theme',     'product_item',     'item_id'),
      ('product_item_code',      'product_item',     'item_id'),
      ('product_item_rejection', 'product',          'product_id'),
      ('deck_slide',             'product',          'product_id'),
      ('deck_slide_theme',       'deck_slide',       'slide_id'),
      ('deck_slide_code',        'deck_slide',       'slide_id'),
      ('flow_run',               'project',          'project_id'),
      ('flow',                   'project',          'project_id'),
      ('flow_lane',              'flow',             'flow_id'),
      ('flow_step',              'flow',             'flow_id'),
      ('flow_step_code',         'flow_step',        'step_id'),
      ('flow_rejection',         'project',          'project_id'),
      ('arch_run',               'project',          'project_id'),
      ('arch_map',               'project',          'project_id'),
      ('arch_node',              'arch_map',         'map_id'),
      ('arch_flow',              'arch_map',         'map_id'),
      ('arch_gap',               'arch_map',         'map_id'),
      ('arch_node_code',         'arch_node',        'node_id'),
      ('arch_flow_code',         'arch_flow',        'flow_id'),
      ('arch_gap_code',          'arch_gap',         'gap_id'),
      ('arch_rejection',         'project',          'project_id'),
      ('connector_import',       'transcript',       'transcript_id')
    ) as v (t, kind, col)
  loop
    -- "aaa_" so it runs before the table's other BEFORE triggers.
    execute format(
      'create trigger aaa_guard_project before insert or update or delete on %I '
      'for each row execute function guard_project_write(%L, %L)',
      r.t, r.kind, r.col);
  end loop;
end;
$$;

-- People and organizations belong to the workspace. Anyone who can edit
-- somewhere may add them (naming a new speaker, picking an organization);
-- only workspace editors may change or remove them.
create or replace function guard_directory_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 or workspace_op() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if not can_edit() then
      raise exception 'Only editors can add people and organizations.' using errcode = '42501';
    end if;
  elsif not can_edit_workspace() then
    raise exception 'Only Harrington editors can change people and organizations.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger aaa_guard_directory before insert or update or delete on person
  for each row execute function guard_directory_write();
create trigger aaa_guard_directory before insert or update or delete on organization
  for each row execute function guard_directory_write();

-- edit and activity are logs. Definer functions write them alongside writes
-- the guard has already checked; a person writing one directly (the client
-- code change, a verification) must be able to edit what it's about.
-- Not security definer, so current_user tells the two apart.
create or replace function guard_log_write()
returns trigger language plpgsql set search_path = public as $$
declare
  v_project uuid;
begin
  if auth.uid() is null or pg_trigger_depth() > 1 or current_user <> 'authenticated' then
    return new;
  end if;
  v_project := new.project_id;
  if v_project is null then
    if not can_edit_workspace() then
      raise exception 'Only Harrington editors can change things outside a project.' using errcode = '42501';
    end if;
  elsif not can_edit_project(v_project) then
    raise exception 'You can''t make changes in that project.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Which project each edit is about, so it can be read by that project's
-- members.
alter table edit add column project_id uuid references project (id) on delete set null;
update edit set project_id = edit_project(object_type, object_id);
create index on edit (project_id);

create or replace function edit_sets_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.project_id := edit_project(new.object_type, new.object_id);
  return new;
end;
$$;

-- In name order: the project is set, then checked.
create trigger aaa_edit_sets_project before insert on edit
  for each row execute function edit_sets_project();
create trigger aab_guard_log before insert on edit
  for each row execute function guard_log_write();
create trigger aab_guard_log before insert on activity
  for each row execute function guard_log_write();

-- ─── read policies ───────────────────────────────────────────────────────
-- Each table's <table>_read policy, replaced.

do $$
declare r record;
begin
  for r in
    select * from (values
      ('seat',                   'can_see_seat(user_id)'),
      ('client',                 'is_staff() or id in (select client_id from project where id in (select my_projects()))'),
      ('project',                'id in (select my_projects())'),
      ('organization',           'can_see_directory()'),
      ('person',                 'can_see_person(id)'),
      ('transcript',             'id in (select my_transcripts())'),
      ('transcript_line',        'transcript_id in (select my_transcripts())'),
      ('transcript_speaker',     'transcript_id in (select my_transcripts())'),
      ('transcript_label',       'transcript_id in (select my_transcripts())'),
      ('label_axis',             'project_id in (select my_full_projects())'),
      ('label_option',           'axis_id in (select id from label_axis where project_id in (select my_full_projects()))'),
      ('coding_run',             'transcript_id in (select my_transcripts())'),
      ('code',                   'transcript_id in (select my_transcripts()) or id in (select my_evidence_codes())'),
      ('code_rejection',         'transcript_id in (select my_transcripts())'),
      ('note_template',          'case when project_id is null then can_see_directory() else project_id in (select my_full_projects()) end'),
      ('note_section',           'template_id in (select id from note_template where case when project_id is null then can_see_directory() else project_id in (select my_full_projects()) end)'),
      ('note',                   'transcript_id in (select my_transcripts())'),
      ('note_run',               'transcript_id in (select my_transcripts())'),
      ('note_item',              'note_id in (select id from note where transcript_id in (select my_transcripts()))'),
      ('note_item_code',         'note_item_id in (select i.id from note_item i join note n on n.id = i.note_id where n.transcript_id in (select my_transcripts()))'),
      ('note_item_rejection',    'note_id in (select id from note where transcript_id in (select my_transcripts()))'),
      ('theme',                  'project_id in (select my_full_projects()) or id in (select my_evidence_themes())'),
      ('theme_code',             'theme_id in (select id from theme where project_id in (select my_full_projects())) or (theme_id in (select my_evidence_themes()) and code_id in (select my_evidence_codes()))'),
      ('theme_run',              'project_id in (select my_full_projects())'),
      ('theme_rejection',        'project_id in (select my_full_projects())'),
      -- Clients read their project's templates: the memo and deck are laid
      -- out by their sections.
      ('product_template',       'case when project_id is null then can_see_directory() else project_id in (select my_projects()) end'),
      ('product_section',        'template_id in (select id from product_template where case when project_id is null then can_see_directory() else project_id in (select my_projects()) end)'),
      ('product',                'project_id in (select my_projects())'),
      ('product_run',            'project_id in (select my_full_projects())'),
      ('product_item',           'product_id in (select id from product where project_id in (select my_projects()))'),
      ('product_item_theme',     'item_id in (select i.id from product_item i join product p on p.id = i.product_id where p.project_id in (select my_projects()))'),
      ('product_item_code',      'item_id in (select i.id from product_item i join product p on p.id = i.product_id where p.project_id in (select my_projects()))'),
      ('product_item_rejection', 'product_id in (select id from product where project_id in (select my_full_projects()))'),
      ('deck_slide',             'product_id in (select id from product where project_id in (select my_projects()))'),
      ('deck_slide_theme',       'slide_id in (select s.id from deck_slide s join product p on p.id = s.product_id where p.project_id in (select my_projects()))'),
      ('deck_slide_code',        'slide_id in (select s.id from deck_slide s join product p on p.id = s.product_id where p.project_id in (select my_projects()))'),
      ('flow_run',               'project_id in (select my_full_projects())'),
      ('flow',                   'project_id in (select my_projects())'),
      ('flow_lane',              'flow_id in (select id from flow where project_id in (select my_projects()))'),
      ('flow_step',              'flow_id in (select id from flow where project_id in (select my_projects()))'),
      ('flow_step_code',         'step_id in (select s.id from flow_step s join flow f on f.id = s.flow_id where f.project_id in (select my_projects()))'),
      ('flow_rejection',         'project_id in (select my_full_projects())'),
      ('arch_run',               'project_id in (select my_full_projects())'),
      ('arch_map',               'project_id in (select my_projects())'),
      ('arch_node',              'map_id in (select id from arch_map where project_id in (select my_projects()))'),
      ('arch_flow',              'map_id in (select id from arch_map where project_id in (select my_projects()))'),
      ('arch_gap',               'map_id in (select id from arch_map where project_id in (select my_projects()))'),
      ('arch_node_code',         'node_id in (select n.id from arch_node n join arch_map m on m.id = n.map_id where m.project_id in (select my_projects()))'),
      ('arch_flow_code',         'flow_id in (select f.id from arch_flow f join arch_map m on m.id = f.map_id where m.project_id in (select my_projects()))'),
      ('arch_gap_code',          'gap_id in (select g.id from arch_gap g join arch_map m on m.id = g.map_id where m.project_id in (select my_projects()))'),
      ('arch_rejection',         'project_id in (select my_full_projects())'),
      ('edit',                   'case when project_id is not null then project_id in (select my_full_projects()) when object_type in (''person'', ''organization'', ''client'') then is_staff() else is_owner() end'),
      ('activity',               'case when project_id is not null then project_id in (select my_full_projects()) else is_staff() end'),
      ('lock',                   'can_edit()'),
      ('connector_import',       'is_staff() or transcript_id in (select my_transcripts())'),
      ('connector_dismissal',    'is_staff()')
    ) as v (t, expr)
  loop
    execute format('drop policy if exists %I on %I', r.t || '_read', r.t);
    execute format('create policy %I on %I for select to authenticated using (%s)', r.t || '_read', r.t, r.expr);
  end loop;
end;
$$;

alter table project_member enable row level security;
create policy project_member_read on project_member for select to authenticated
  using (user_id = auth.uid() or project_id in (select my_full_projects()));
-- Written only by the functions below.
grant select on project_member to authenticated;

alter table invitation enable row level security;
create policy invitation_read on invitation for select to authenticated
  using (is_owner() or (project_id is not null and can_manage_project(project_id)));
grant select on invitation to authenticated;

-- The stored originals: readable with the transcript they're the original of.
drop policy if exists transcripts_read on storage.objects;
create policy transcripts_read on storage.objects
  for select to authenticated
  using (bucket_id = 'transcripts'
         and exists (select 1 from public.transcript t
                     where t.storage_path = name and t.id in (select public.my_transcripts())));

-- ─── direct writes to clients and projects ───────────────────────────────

drop policy if exists client_insert on client;
drop policy if exists client_update on client;
drop policy if exists client_delete on client;
create policy client_insert on client for insert to authenticated
  with check (can_edit_workspace() and created_by = auth.uid());
create policy client_update on client for update to authenticated using (can_edit_workspace());
create policy client_delete on client for delete to authenticated using (can_edit_workspace());

-- A project is created through create_project(), which makes its creator
-- its owner in the same step.
drop policy if exists project_insert on project;
drop policy if exists project_update on project;
drop policy if exists project_delete on project;
create policy project_update on project for update to authenticated using (can_edit_project(id));
create policy project_delete on project for delete to authenticated using (can_manage_project(id));

create or replace function create_project(p_client_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit_workspace() then
    raise exception 'Only Harrington editors can start projects.' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Give the project a name.';
  end if;
  if not exists (select 1 from client where id = p_client_id) then
    raise exception 'Unknown client.' using errcode = 'P0002';
  end if;
  insert into project (client_id, name, created_by)
  values (p_client_id, btrim(p_name), auth.uid())
  returning id into v_id;
  insert into project_member (project_id, user_id, role, added_by)
  values (v_id, auth.uid(), 'owner', auth.uid());
  insert into activity (project_id, actor, verb, object)
  values (v_id, auth.uid(), 'created project', btrim(p_name));
  return v_id;
end;
$$;
revoke execute on function create_project from public, anon;
grant execute on function create_project to authenticated;

-- ─── read functions that run as definer ──────────────────────────────────
-- They see past row-level security, so they check for themselves.

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
    and c.transcript_id in (select my_transcripts())
  order by c.line_start, c.ref;
$$;

create or replace function corpus_matrix(p_project_id uuid, p_include_proposed boolean default false)
returns table (theme_id uuid, transcript_id uuid, codes integer)
language sql stable security definer set search_path = public as $$
  with active as (
    select c.id, c.transcript_id
    from code c
    join transcript t on t.id = c.transcript_id
    where t.project_id = p_project_id and c.merged_into_id is null
      and can_read_project_full(p_project_id)
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
  group by m.theme_id, m.transcript_id
  union all
  select null::uuid, a.transcript_id, count(*)::integer
  from active a
  where not exists (select 1 from member m where m.code_id = a.id)
  group by a.transcript_id;
$$;

-- Who spoke each code, for attributing quotes by title. Now a definer, so a
-- client gets the title (and part in the call) behind each quote they may
-- see, without seeing the transcript; who the speaker is (their name as
-- written, their person) only for those who see the transcript.
create or replace function code_speakers(p_project_id uuid)
returns table (code_id uuid, speaker text, person_id uuid, title text, role speaker_role)
language sql stable security definer set search_path = public as $$
  with full_access as (select can_read_project_full(p_project_id) as yes)
  select c.id,
         case when f.yes then l.speaker end,
         case when f.yes then s.person_id end,
         s.title, s.role
  from code c
  cross join full_access f
  join transcript t on t.id = c.transcript_id and t.project_id = p_project_id
  join transcript_line l on l.transcript_id = c.transcript_id and l.n = c.line_start
  join transcript_speaker s on s.transcript_id = c.transcript_id and s.name = l.speaker
  where c.merged_into_id is null
    and can_read_project(p_project_id)
    and (f.yes or c.id in (select my_evidence_codes()));
$$;
revoke execute on function code_speakers from public, anon;
grant execute on function code_speakers to authenticated;

-- Copying a template reads the source: it must be one the caller can see.
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
  if not found
     or not (case when src.project_id is null then can_see_directory() else can_read_project_full(src.project_id) end) then
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
  if not found
     or not (case when src.project_id is null then can_see_directory() else can_read_project_full(src.project_id) end) then
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

-- Helpers the writing functions use, never called directly. Several are
-- definers that would otherwise read any project's rows for anyone.
revoke execute on function
  next_code_ref, note_item_snapshot, next_theme_ref, theme_snapshot, product_item_snapshot,
  scope_project, edit_project, require_scope_edit, refresh_person_current, org_path
from public, anon, authenticated;

-- ─── merging people and organizations ────────────────────────────────────
-- Workspace operations: a person's or organization's rows are spread over
-- projects the merger may not belong to, so these mark the transaction as
-- a workspace operation (begin_workspace_op) after checking the caller is a
-- workspace editor. Otherwise as in 20260930a and 20260930b.

create or replace function merge_people(p_keep_id uuid, p_merge_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_keep  person%rowtype;
  v_other person%rowtype;
  v_moved integer := 0;
  v_n     integer;
begin
  perform begin_workspace_op();
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

create or replace function merge_organizations(p_keep_id uuid, p_merge_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_keep  organization%rowtype;
  v_other organization%rowtype;
  v_clash text;
  v_n     integer;
  v_p     integer;
  v_moved integer := 0;
begin
  perform begin_workspace_op();
  select * into v_keep from organization where id = p_keep_id for update;
  if not found then
    raise exception 'Unknown organization.' using errcode = 'P0002';
  end if;
  if p_keep_id = any (p_merge_ids) then
    raise exception 'An organization can''t be merged into itself.';
  end if;

  for v_other in select * from organization where id = any (p_merge_ids) for update loop
    -- Keeping a sub-organization of the one merged in would put it under itself.
    if exists (
      with recursive up (id, parent_id, depth) as (
        select id, parent_id, 0 from organization where id = p_keep_id
        union all
        select o.id, o.parent_id, up.depth + 1 from organization o join up on o.id = up.parent_id where up.depth < 50
      )
      select 1 from up where id = v_other.id
    ) then
      raise exception '% sits under %; merge the other way round, or move it out first.', v_keep.name, v_other.name;
    end if;
    select c.name into v_clash from organization c
    where c.parent_id = v_other.id
      and exists (select 1 from organization k where k.parent_id = p_keep_id and lower(k.name) = lower(c.name))
    limit 1;
    if v_clash is not null then
      raise exception 'Both have a sub-organization named %. Merge those two first.', v_clash;
    end if;

    update transcript_speaker set organization_id = p_keep_id, set_by = v_uid, set_at = now() where organization_id = v_other.id;
    get diagnostics v_n = row_count;
    update person set organization_id = p_keep_id where organization_id = v_other.id;
    get diagnostics v_p = row_count;
    update organization set parent_id = p_keep_id where parent_id = v_other.id;
    v_moved := v_moved + v_n + v_p;

    insert into edit (object_type, object_id, text, edited_by)
    values ('organization', p_keep_id,
            format('merged in %s (%s speaker entr%s, %s %s)', quote_literal(org_path(v_other.id)),
                   v_n, case when v_n = 1 then 'y' else 'ies' end, v_p, case when v_p = 1 then 'person' else 'people' end), v_uid);
    delete from organization where id = v_other.id;
  end loop;

  if exists (select 1 from organization where id = any (p_merge_ids)) then
    raise exception 'Some of those organizations couldn''t be merged.';
  end if;
  return v_moved;
end;
$$;

revoke execute on function begin_workspace_op from public, anon, authenticated;

-- ─── invitations ─────────────────────────────────────────────────────────

-- "Dana Smith" → "DS"; "dana.smith@x.com" → "DS".
create or replace function initials_for(p_name text)
returns text language sql immutable as $$
  select upper(coalesce(string_agg(left(w, 1), '' order by i), '?'))
  from (
    select w, i from regexp_split_to_table(
      regexp_replace(split_part(p_name, '@', 1), '[._\-]+', ' ', 'g'), '\s+') with ordinality as x(w, i)
    where w <> '' limit 2
  ) words;
$$;

-- "dana.smith@x.com" → "Dana Smith", until they say otherwise.
create or replace function name_from_email(p_email text)
returns text language sql immutable as $$
  select initcap(btrim(regexp_replace(split_part(p_email, '@', 1), '[._\-]+', ' ', 'g')));
$$;

-- Invite someone, or add them straight away if they already have a seat.
-- A workspace role needs a workspace owner; a project role, an owner of
-- that project. Inviting an address that already has an open invitation
-- for the same place updates it and restarts its 14 days (sending again).
-- Returns {status: 'added' | 'invited', invitation_id?, user_id?}.
create or replace function invite_member(
  p_email          text,
  p_name           text default null,
  p_workspace_role seat_role default null,
  p_project_id     uuid default null,
  p_project_role   project_role default null,
  p_client_access  text default 'deliverables'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(btrim(p_email));
  v_seat  seat%rowtype;
  v_inv   uuid;
begin
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That doesn''t look like an email address.';
  end if;
  if p_workspace_role is null and p_project_id is null then
    raise exception 'Choose a project or a workspace role.';
  end if;
  if p_workspace_role is not null and not is_owner() then
    raise exception 'Only workspace owners can give workspace roles.' using errcode = '42501';
  end if;
  if p_project_id is not null then
    if p_project_role is null then
      raise exception 'Choose a role on the project.';
    end if;
    if not can_manage_project(p_project_id) then
      raise exception 'Only the project''s owners can invite people to it.' using errcode = '42501';
    end if;
  end if;
  if coalesce(p_client_access, 'deliverables') not in ('deliverables', 'full') then
    raise exception 'Client access is deliverables or full.';
  end if;

  select * into v_seat from seat where lower(email) = v_email;
  if found then
    if v_seat.deactivated_at is not null and not is_owner() then
      raise exception 'A workspace owner removed this person; only a workspace owner can add them back.' using errcode = '42501';
    end if;
    update seat set
      deactivated_at = null,
      role = coalesce(p_workspace_role, role)
    where user_id = v_seat.user_id;
    if p_project_id is not null then
      insert into project_member (project_id, user_id, role, client_access, added_by)
      values (p_project_id, v_seat.user_id, p_project_role, coalesce(p_client_access, 'deliverables'), v_uid)
      on conflict (project_id, user_id) do update
        set role = excluded.role, client_access = excluded.client_access;
      insert into activity (project_id, actor, verb, object)
      values (p_project_id, v_uid, 'added', format('%s as %s', v_seat.name, p_project_role));
    end if;
    return jsonb_build_object('status', 'added', 'user_id', v_seat.user_id);
  end if;

  update invitation set
    name = coalesce(nullif(btrim(p_name), ''), name),
    workspace_role = coalesce(p_workspace_role, workspace_role),
    project_role = p_project_role,
    client_access = coalesce(p_client_access, 'deliverables'),
    invited_by = v_uid,
    invited_at = now(),
    expires_at = now() + interval '14 days',
    sent_count = sent_count + 1
  where email = v_email
    and project_id is not distinct from p_project_id
    and accepted_at is null and revoked_at is null
  returning id into v_inv;

  if v_inv is null then
    insert into invitation (email, name, workspace_role, project_id, project_role, client_access, invited_by)
    values (v_email, nullif(btrim(p_name), ''), p_workspace_role, p_project_id, p_project_role,
            coalesce(p_client_access, 'deliverables'), v_uid)
    returning id into v_inv;
  end if;

  if p_project_id is not null then
    insert into activity (project_id, actor, verb, object)
    values (p_project_id, v_uid, 'invited', format('%s as %s', v_email, p_project_role));
  end if;
  return jsonb_build_object('status', 'invited', 'invitation_id', v_inv);
end;
$$;

-- Send again: restarts the 14 days.
create or replace function renew_invitation(p_invitation_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v invitation%rowtype;
begin
  select * into v from invitation where id = p_invitation_id for update;
  if not found or v.accepted_at is not null or v.revoked_at is not null then
    raise exception 'That invitation isn''t open any more.' using errcode = 'P0002';
  end if;
  if not (is_owner() or (v.project_id is not null and v.workspace_role is null and can_manage_project(v.project_id))) then
    raise exception 'Only the project''s owners can send its invitations.' using errcode = '42501';
  end if;
  update invitation set expires_at = now() + interval '14 days', sent_count = sent_count + 1
  where id = p_invitation_id;
  return v.email;
end;
$$;

create or replace function revoke_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v invitation%rowtype;
begin
  select * into v from invitation where id = p_invitation_id for update;
  if not found then
    raise exception 'Unknown invitation.' using errcode = 'P0002';
  end if;
  if not (is_owner() or (v.project_id is not null and v.workspace_role is null and can_manage_project(v.project_id))) then
    raise exception 'Only the project''s owners can withdraw its invitations.' using errcode = '42501';
  end if;
  update invitation set revoked_at = now(), revoked_by = auth.uid()
  where id = p_invitation_id and accepted_at is null and revoked_at is null;
end;
$$;

-- Called once someone has signed in: turns every open invitation to their
-- (verified) address into a seat and memberships. Returns how many it
-- accepted. A deactivated seat is brought back only by an invitation a
-- workspace owner made after the deactivation.
create or replace function accept_invitations()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_seat  seat%rowtype;
  v       invitation%rowtype;
  v_n     integer := 0;
  v_rank  constant seat_role[] := array['viewer', 'editor', 'owner']::seat_role[];
begin
  if v_uid is null then
    return 0;
  end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is null then
    return 0;
  end if;

  for v in
    select * from invitation
    where email = v_email and accepted_at is null and revoked_at is null and expires_at > now()
    order by invited_at
    for update
  loop
    select * into v_seat from seat where user_id = v_uid;
    if not found then
      insert into seat (user_id, name, initials, email, role)
      values (v_uid, coalesce(v.name, name_from_email(v_email)), initials_for(coalesce(v.name, v_email)),
              v_email, v.workspace_role)
      returning * into v_seat;
    elsif v_seat.deactivated_at is not null then
      if v_seat.deactivated_at > v.invited_at
         or not exists (select 1 from seat where user_id = v.invited_by and role = 'owner') then
        continue;
      end if;
      update seat set deactivated_at = null where user_id = v_uid;
    end if;

    -- A workspace role only ever goes up by invitation.
    if v.workspace_role is not null
       and (v_seat.role is null or array_position(v_rank, v.workspace_role) > array_position(v_rank, v_seat.role)) then
      update seat set role = v.workspace_role where user_id = v_uid;
    end if;

    if v.project_id is not null then
      insert into project_member (project_id, user_id, role, client_access, added_by)
      values (v.project_id, v_uid, v.project_role, v.client_access, v.invited_by)
      on conflict (project_id, user_id) do update
        set role = excluded.role, client_access = excluded.client_access;
      insert into activity (project_id, actor, verb, object)
      values (v.project_id, v_uid, 'joined', format('as %s', v.project_role));
    end if;

    update invitation set accepted_at = now(), accepted_by = v_uid where id = v.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ─── managing members ────────────────────────────────────────────────────

create or replace function set_project_member(
  p_project_id    uuid,
  p_user_id       uuid,
  p_role          project_role,
  p_client_access text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old project_member%rowtype;
begin
  if not can_manage_project(p_project_id) then
    raise exception 'Only the project''s owners can change its members.' using errcode = '42501';
  end if;
  select * into v_old from project_member where project_id = p_project_id and user_id = p_user_id for update;
  if not found then
    raise exception 'They aren''t on this project.' using errcode = 'P0002';
  end if;
  if v_old.role = 'owner' and p_role <> 'owner' and not is_owner()
     and not exists (select 1 from project_member where project_id = p_project_id and role = 'owner' and user_id <> p_user_id) then
    raise exception 'A project needs an owner. Make someone else an owner first.';
  end if;
  update project_member set
    role = p_role,
    client_access = coalesce(p_client_access, client_access)
  where project_id = p_project_id and user_id = p_user_id;
  insert into activity (project_id, actor, verb, object)
  values (p_project_id, auth.uid(), 'changed the role of',
          format('%s to %s', (select name from seat where user_id = p_user_id), p_role));
end;
$$;

-- An owner removes someone; anyone may leave.
create or replace function remove_project_member(p_project_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old project_member%rowtype;
begin
  if not (can_manage_project(p_project_id) or p_user_id = auth.uid()) then
    raise exception 'Only the project''s owners can remove people from it.' using errcode = '42501';
  end if;
  select * into v_old from project_member where project_id = p_project_id and user_id = p_user_id for update;
  if not found then
    return;
  end if;
  if v_old.role = 'owner' and not is_owner()
     and not exists (select 1 from project_member where project_id = p_project_id and role = 'owner' and user_id <> p_user_id) then
    raise exception 'A project needs an owner. Make someone else an owner first.';
  end if;
  delete from project_member where project_id = p_project_id and user_id = p_user_id;
  insert into activity (project_id, actor, verb, object)
  values (p_project_id, auth.uid(), 'removed', (select name from seat where user_id = p_user_id));
end;
$$;

-- Workspace roles: owners only, and the last owner stays one.
create or replace function set_workspace_role(p_user_id uuid, p_role seat_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then
    raise exception 'Only workspace owners can change workspace roles.' using errcode = '42501';
  end if;
  if p_role is distinct from 'owner'
     and (select role from seat where user_id = p_user_id) = 'owner'
     and not exists (select 1 from seat where role = 'owner' and deactivated_at is null and user_id <> p_user_id) then
    raise exception 'The workspace needs an owner. Make someone else an owner first.';
  end if;
  update seat set role = p_role where user_id = p_user_id;
  if not found then
    raise exception 'Unknown person.' using errcode = 'P0002';
  end if;
  insert into edit (object_type, object_id, text, edited_by)
  values ('seat', p_user_id, format('workspace role: %s', coalesce(p_role::text, 'none')), auth.uid());
end;
$$;

-- Take away someone's access to everything. The seat stays, as the author
-- of what they made; their memberships and open invitations go.
create or replace function deactivate_seat(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  if not is_owner() then
    raise exception 'Only workspace owners can remove people from the workspace.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You can''t remove yourself.';
  end if;
  update seat set deactivated_at = now(), role = null where user_id = p_user_id
  returning email into v_email;
  if not found then
    raise exception 'Unknown person.' using errcode = 'P0002';
  end if;
  delete from project_member where user_id = p_user_id;
  update invitation set revoked_at = now(), revoked_by = auth.uid()
  where email = lower(v_email) and accepted_at is null and revoked_at is null;
  insert into edit (object_type, object_id, text, edited_by)
  values ('seat', p_user_id, 'removed from the workspace', auth.uid());
end;
$$;

-- What the signed-in person may do on one project, for the app to show the
-- right tabs and buttons. Null when they can't see it.
create or replace function project_access(p_project_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when my_project_role(p_project_id) is null then null else jsonb_build_object(
    'role', my_project_role(p_project_id),
    'client_access', (select client_access from my_memberships() where project_id = p_project_id),
    'full', can_read_project_full(p_project_id),
    'edit', can_edit_project(p_project_id),
    'manage', can_manage_project(p_project_id)
  ) end;
$$;

revoke execute on function
  invite_member, renew_invitation, revoke_invitation, accept_invitations,
  set_project_member, remove_project_member, set_workspace_role, deactivate_seat, project_access
from public, anon;
grant execute on function
  invite_member, renew_invitation, revoke_invitation, accept_invitations,
  set_project_member, remove_project_member, set_workspace_role, deactivate_seat, project_access
to authenticated;

-- ─── sign-up: by invitation only ─────────────────────────────────────────
-- Supabase Auth calls this before creating any account (Authentication →
-- Hooks → Before User Created). It replaces hook_restrict_signup_domain:
-- an account can be made only for an address with an open invitation (or
-- one that already has a seat), whatever its domain.

create or replace function public.hook_require_invitation(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if exists (select 1 from invitation
             where email = v_email and accepted_at is null and revoked_at is null and expires_at > now())
     or exists (select 1 from seat where lower(email) = v_email and deactivated_at is null) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Harrington Tools is by invitation. Ask your contact at Harrington Data Co to invite you.'
  ));
end;
$$;

grant execute on function public.hook_require_invitation to supabase_auth_admin;
revoke execute on function public.hook_require_invitation from authenticated, anon, public;

commit;
