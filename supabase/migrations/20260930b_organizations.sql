-- Managing organizations: rename, move, merge, delete.
--
-- Organizations were only ever created (from the speaker pickers). This adds
-- the rest, as definer functions that check the rules and log each change to
-- edit (object_type 'organization'):
--
--   - update_organization(id, {name?, parent_id?}): rename, or move under a
--     different parent (null: top level). A move can't put an organization
--     under itself or its own sub-organizations (the existing cycle trigger),
--     and names stay unique among siblings.
--   - merge_organizations(keep, [others]): everyone and every speaker at the
--     others moves to the one kept, and their sub-organizations move under it.
--   - delete_organization(id): only one nothing uses — no speakers, people or
--     sub-organizations. Otherwise merge it.
--
-- Direct updates and deletes are closed: a plain delete would quietly blank
-- the organization of every speaker and person at it. Inserts stay as they
-- are (the pickers create organizations directly).
--
-- Needs 20260930a_people applied first.

drop policy if exists organization_update on organization;
drop policy if exists organization_delete on organization;

create or replace function org_path(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  with recursive up (id, parent_id, name, depth) as (
    select id, parent_id, name, 0 from organization where id = p_id
    union all
    select o.id, o.parent_id, o.name, up.depth + 1 from organization o join up on o.id = up.parent_id where up.depth < 50
  )
  select string_agg(name, ' › ' order by depth desc) from up;
$$;

-- p_changes: any of {name, parent_id}; present keys apply ('' or null
-- parent_id: top level).
create or replace function update_organization(p_org_id uuid, p_changes jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_old     organization%rowtype;
  v_name    text;
  v_parent  uuid;
  v_changes integer := 0;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can change organizations.' using errcode = '42501';
  end if;
  select * into v_old from organization where id = p_org_id for update;
  if not found then
    raise exception 'Unknown organization.' using errcode = 'P0002';
  end if;

  begin
    if p_changes ? 'name' then
      v_name := nullif(btrim(p_changes ->> 'name'), '');
      if v_name is null then
        raise exception 'An organization needs a name.';
      end if;
      if v_name is distinct from v_old.name then
        update organization set name = v_name where id = p_org_id;
        insert into edit (object_type, object_id, text, edited_by)
        values ('organization', p_org_id, format('name: %s → %s', quote_literal(v_old.name), quote_literal(v_name)), v_uid);
        v_changes := v_changes + 1;
      end if;
    end if;

    if p_changes ? 'parent_id' then
      v_parent := nullif(p_changes ->> 'parent_id', '')::uuid;
      if v_parent is not null and not exists (select 1 from organization where id = v_parent) then
        raise exception 'Unknown parent organization.';
      end if;
      if v_parent is distinct from v_old.parent_id then
        update organization set parent_id = v_parent where id = p_org_id;
        insert into edit (object_type, object_id, text, edited_by)
        values ('organization', p_org_id,
                format('moved: %s → %s',
                       coalesce('under ' || quote_literal(org_path(v_old.parent_id)), 'top level'),
                       coalesce('under ' || quote_literal(org_path(v_parent)), 'top level')), v_uid);
        v_changes := v_changes + 1;
      end if;
    end if;
  exception when unique_violation then
    raise exception 'There''s already an organization named % there.', coalesce(v_name, v_old.name);
  end;

  return v_changes;
end;
$$;

-- Fold duplicates into one organization. Returns how many speakers and
-- people moved.
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
  if not can_edit() then
    raise exception 'Only editors and owners can merge organizations.' using errcode = '42501';
  end if;
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

create or replace function delete_organization(p_org_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_subs integer;
  v_used integer;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can delete organizations.' using errcode = '42501';
  end if;
  select name into v_name from organization where id = p_org_id;
  if v_name is null then
    raise exception 'Unknown organization.' using errcode = 'P0002';
  end if;
  select count(*) into v_subs from organization where parent_id = p_org_id;
  if v_subs > 0 then
    raise exception '% has % sub-organization%. Move or delete those first.', v_name, v_subs, case when v_subs = 1 then '' else 's' end;
  end if;
  select (select count(*) from transcript_speaker where organization_id = p_org_id)
       + (select count(*) from person where organization_id = p_org_id) into v_used;
  if v_used > 0 then
    raise exception '% is in use by people or speakers. Merge it into another organization instead.', v_name;
  end if;
  delete from organization where id = p_org_id;
end;
$$;

revoke execute on function update_organization, merge_organizations, delete_organization from public, anon;
grant execute on function update_organization, merge_organizations, delete_organization to authenticated;
