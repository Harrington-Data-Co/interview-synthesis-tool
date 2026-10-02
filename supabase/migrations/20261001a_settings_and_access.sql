-- Settings, identity and access (2026-10-01). Starts from 20260930g_invitations.
--
-- Toward deploying at tools.harringtondata.com/interview-synthesis:
--
--   workspace_setting  one row of workspace-wide settings, owners only:
--                      how long invitations last, and which roles must use
--                      two-factor sign-in (nobody yet).
--   two-factor rail    current_seat_role(), has_seat() and my_memberships()
--                      — what every access check rests on — see nothing for
--                      someone whose role requires two-factor sign-in until
--                      their session has it (Supabase's aal2). With the
--                      requirement empty, nothing changes. Turning it on
--                      later needs only the enrollment screens.
--   access_event       who invited, added, changed or removed whom, and
--                      when: written by triggers on invitation, seat and
--                      project_member, so every path is logged.
--   member_sign_ins()  when each person last signed in (from auth.users).
--   update_my_profile  a person's own name, initials and title.

begin;

-- ─── workspace settings ──────────────────────────────────────────────────

create table workspace_setting (
  id                 boolean primary key default true check (id),   -- one row
  -- Days an invitation lasts, and how long Send again extends it.
  invitation_days    integer not null default 14 check (invitation_days between 1 and 90),
  -- Who must sign in with two-factor: any of 'owner', 'editor', 'viewer'
  -- (workspace roles), 'project_owner', 'outside' (no workspace role), or
  -- 'everyone'. Empty: nobody.
  mfa_required_for   text[] not null default '{}'
    check (mfa_required_for <@ array['owner', 'editor', 'viewer', 'project_owner', 'outside', 'everyone']),
  updated_by         uuid references seat (user_id),
  updated_at         timestamptz not null default now()
);
insert into workspace_setting default values;

alter table workspace_setting enable row level security;
-- Everyone signed in may read it (the app shows the invitation lifetime);
-- only owners change it, through set_workspace_settings().
create policy workspace_setting_read on workspace_setting for select to authenticated using (true);
grant select on workspace_setting to authenticated;

create or replace function invitation_days()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select invitation_days from workspace_setting), 14);
$$;

-- ─── the two-factor rail ─────────────────────────────────────────────────

-- Whether this session meets the workspace's two-factor requirement for the
-- caller. Reads seat directly (definer), so it doesn't depend on the
-- functions it guards.
create or replace function mfa_satisfied()
returns boolean language sql stable security definer set search_path = public as $$
  with req as (select mfa_required_for as r from workspace_setting),
  me as (select role::text as role from seat where user_id = auth.uid())
  select cardinality(req.r) = 0
      or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not (
        req.r @> array['everyone']
        or coalesce(req.r @> array[me.role], false)
        or (req.r @> array['outside'] and me.role is null)
        or (req.r @> array['project_owner']
            and exists (select 1 from project_member where user_id = auth.uid() and role = 'owner'))
      )
  from req left join me on true;
$$;

-- Does the caller still need to verify a second factor before they see
-- anything? For the app, to send them to the right screen.
create or replace function mfa_required_now()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from seat where user_id = auth.uid() and deactivated_at is null) and not mfa_satisfied();
$$;

-- The three functions every access check rests on, now also asking
-- mfa_satisfied(). Otherwise as in 20260930g.
create or replace function current_seat_role()
returns seat_role language sql stable security definer set search_path = public as $$
  select role from seat where user_id = auth.uid() and deactivated_at is null and mfa_satisfied();
$$;

create or replace function has_seat()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from seat where user_id = auth.uid() and deactivated_at is null) and mfa_satisfied();
$$;

create or replace function my_memberships()
returns setof project_member language sql stable security definer set search_path = public as $$
  select m.* from project_member m
  join seat s on s.user_id = m.user_id and s.deactivated_at is null
  where m.user_id = auth.uid() and mfa_satisfied();
$$;

create or replace function set_workspace_settings(p_invitation_days integer default null, p_mfa_required_for text[] default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then
    raise exception 'Only workspace owners can change workspace settings.' using errcode = '42501';
  end if;
  update workspace_setting set
    invitation_days = coalesce(p_invitation_days, invitation_days),
    mfa_required_for = coalesce(p_mfa_required_for, mfa_required_for),
    updated_by = auth.uid(),
    updated_at = now();
  insert into access_event (actor, verb, detail)
  values (auth.uid(), 'changed workspace settings',
          (select format('invitations last %s days; two-factor for %s', invitation_days,
                         coalesce(nullif(array_to_string(mfa_required_for, ', '), ''), 'nobody'))
           from workspace_setting));
end;
$$;

-- Invitations last as long as the setting says. Set on the way in, and
-- whenever an invitation is sent again, so invite_member() and
-- renew_invitation() needn't know. Writes with no person behind them (the
-- SQL editor) keep whatever they set.
create or replace function invitation_lifetime()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and (tg_op = 'INSERT' or new.expires_at is distinct from old.expires_at) then
    new.expires_at := now() + make_interval(days => invitation_days());
  end if;
  return new;
end;
$$;

create trigger invitation_lifetime before insert or update of expires_at on invitation
  for each row execute function invitation_lifetime();

-- ─── the access log ──────────────────────────────────────────────────────

create table access_event (
  id            uuid primary key default gen_random_uuid(),
  at            timestamptz not null default now(),
  actor         uuid references seat (user_id),       -- null: the system
  verb          text not null,
  subject_user  uuid references seat (user_id),
  subject_email text,
  project_id    uuid references project (id) on delete set null,
  detail        text
);
create index on access_event (at desc);
create index on access_event (project_id, at desc);

alter table access_event enable row level security;
-- Owners read everything; a project's owners read its own.
create policy access_event_read on access_event for select to authenticated
  using (is_owner() or (project_id is not null and can_manage_project(project_id)));
grant select on access_event to authenticated;
-- Written only by the triggers and functions here.

create or replace function log_invitation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_gives text := concat_ws(', ',
    case when new.workspace_role is not null then 'workspace ' || new.workspace_role end,
    case when new.project_id is not null then
      new.project_role || case when new.project_role = 'client' then ' (' || new.client_access || ')' else '' end end);
begin
  if tg_op = 'INSERT' then
    insert into access_event (actor, verb, subject_email, project_id, detail)
    values (auth.uid(), 'invited', new.email, new.project_id, v_gives);
  elsif new.revoked_at is not null and old.revoked_at is null then
    insert into access_event (actor, verb, subject_email, project_id, detail)
    values (auth.uid(), 'withdrew the invitation of', new.email, new.project_id, v_gives);
  elsif new.accepted_at is not null and old.accepted_at is null then
    insert into access_event (actor, verb, subject_user, subject_email, project_id, detail)
    values (new.accepted_by, 'accepted an invitation', new.accepted_by, new.email, new.project_id, v_gives);
  elsif new.sent_count > old.sent_count then
    insert into access_event (actor, verb, subject_email, project_id, detail)
    values (auth.uid(), 'sent the invitation again to', new.email, new.project_id, v_gives);
  end if;
  return null;
end;
$$;

create trigger log_invitation after insert or update on invitation
  for each row execute function log_invitation();

create or replace function log_project_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into access_event (actor, verb, subject_user, project_id, detail)
    values (auth.uid(), 'added', new.user_id, new.project_id,
            new.role || case when new.role = 'client' then ' (' || new.client_access || ')' else '' end);
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role or new.client_access is distinct from old.client_access then
      insert into access_event (actor, verb, subject_user, project_id, detail)
      values (auth.uid(), 'changed the role of', new.user_id, new.project_id,
              format('%s → %s', old.role || case when old.role = 'client' then ' (' || old.client_access || ')' else '' end,
                                new.role || case when new.role = 'client' then ' (' || new.client_access || ')' else '' end));
    end if;
  else
    -- A project being deleted takes its members with it; that isn't news
    -- about each of them.
    if exists (select 1 from project where id = old.project_id) then
      insert into access_event (actor, verb, subject_user, project_id, detail)
      values (auth.uid(), case when old.user_id = auth.uid() then 'left' else 'removed' end,
              old.user_id, old.project_id, old.role::text);
    end if;
  end if;
  return null;
end;
$$;

create trigger log_project_member after insert or update or delete on project_member
  for each row execute function log_project_member();

create or replace function log_seat()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into access_event (actor, verb, subject_user, subject_email, detail)
    values (auth.uid(), 'joined the workspace', new.user_id, new.email, coalesce('workspace ' || new.role, 'no workspace role'));
    return null;
  end if;
  if new.role is distinct from old.role and new.deactivated_at is null then
    insert into access_event (actor, verb, subject_user, detail)
    values (auth.uid(), 'changed the workspace role of', new.user_id,
            format('%s → %s', coalesce(old.role::text, 'none'), coalesce(new.role::text, 'none')));
  end if;
  if new.deactivated_at is not null and old.deactivated_at is null then
    insert into access_event (actor, verb, subject_user) values (auth.uid(), 'removed from the workspace', new.user_id);
  elsif new.deactivated_at is null and old.deactivated_at is not null then
    insert into access_event (actor, verb, subject_user) values (auth.uid(), 'brought back', new.user_id);
  end if;
  if new.name is distinct from old.name then
    insert into access_event (actor, verb, subject_user, detail)
    values (auth.uid(), 'renamed', new.user_id, format('%s → %s', old.name, new.name));
  end if;
  return null;
end;
$$;

create trigger log_seat after insert or update on seat
  for each row execute function log_seat();

-- ─── sign-ins and profiles ───────────────────────────────────────────────

-- When people last signed in: everyone for owners, a project's members for
-- its owners.
create or replace function member_sign_ins()
returns table (user_id uuid, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select s.user_id, u.last_sign_in_at
  from public.seat s join auth.users u on u.id = s.user_id
  where public.is_owner()
     or exists (select 1 from public.project_member m
                where m.user_id = s.user_id and public.can_manage_project(m.project_id));
$$;

-- Your own name, initials and title. The shared account (Supabase Auth)
-- keeps the name too, for the other Harrington Tools; the app writes both.
create or replace function update_my_profile(p_name text, p_initials text default null, p_title text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := nullif(btrim(p_name), '');
begin
  if v_name is null then
    raise exception 'Your name can''t be empty.';
  end if;
  if char_length(btrim(coalesce(p_initials, ''))) > 3 then
    raise exception 'Initials are at most three letters.';
  end if;
  update seat set
    name = v_name,
    initials = coalesce(nullif(upper(btrim(p_initials)), ''), initials_for(v_name)),
    title = nullif(btrim(p_title), '')
  where user_id = auth.uid() and deactivated_at is null;
  if not found then
    raise exception 'No seat to update.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function
  set_workspace_settings, member_sign_ins, update_my_profile, mfa_required_now
from public, anon;
grant execute on function
  set_workspace_settings, member_sign_ins, update_my_profile, mfa_required_now
to authenticated;
revoke execute on function invitation_lifetime, log_invitation, log_project_member, log_seat
from public, anon, authenticated;

commit;
