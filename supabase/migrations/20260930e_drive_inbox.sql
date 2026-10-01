-- The Drive inbox (backlog R6): new Meet transcripts show up on Sources by
-- themselves, and ones that aren't interviews can be set aside.
--
--   - connector_dismissal: a Drive file someone marked "not an interview",
--     so it stops showing as waiting. Undoable.
--   - set_connector_dismissal(provider, external_id, dismissed): mark or
--     unmark. Editors only; reads are open to anyone with a seat.

create table connector_dismissal (
  provider     text not null check (provider in ('google')),
  external_id  text not null,
  dismissed_by uuid not null default auth.uid() references seat (user_id),
  dismissed_at timestamptz not null default now(),
  primary key (provider, external_id)
);
alter table connector_dismissal enable row level security;
create policy connector_dismissal_read on connector_dismissal
  for select to authenticated using (has_seat());

create or replace function set_connector_dismissal(p_provider text, p_external_id text, p_dismissed boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_edit() then
    raise exception 'Only editors and owners can set files aside.' using errcode = '42501';
  end if;
  if p_dismissed then
    insert into connector_dismissal (provider, external_id, dismissed_by)
    values (p_provider, p_external_id, auth.uid())
    on conflict (provider, external_id) do nothing;
  else
    delete from connector_dismissal where provider = p_provider and external_id = p_external_id;
  end if;
end;
$$;
revoke execute on function set_connector_dismissal from public, anon;
grant execute on function set_connector_dismissal to authenticated;
