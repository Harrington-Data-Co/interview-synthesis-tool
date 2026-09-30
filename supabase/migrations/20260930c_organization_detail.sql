-- Organizations with depth: a kind and a short name on each, and whole
-- hierarchies created at once.
--
-- Government structures run several layers deep (State of Delaware ›
-- Department of Education › Office of Early Learning › a unit), and each
-- layer means something. So:
--
--   - organization.kind: what this layer is ("Agency", "Department",
--     "Division", "Unit"…), free text since every structure names its layers
--     differently. The app groups by it: everyone under their Department.
--   - organization.short_name: the acronym people actually say (DOE, OEL,
--     DHSS), shown beside the name and matched by search.
--   - update_organization() also takes short_name and kind.
--   - create_organization_tree(parent, nodes): a nested list of
--     organizations ([{name, short_name?, kind?, children?}]) created under a
--     parent (null: top level) in one go. One that already exists under the
--     same parent (by name, ignoring case) is reused, and fills in a short
--     name or kind it lacked; nothing existing is renamed or moved.
--
-- Needs 20260930b_organizations applied first.

alter table organization
  add column short_name text check (short_name is null or btrim(short_name) <> ''),
  add column kind       text check (kind is null or btrim(kind) <> '');

-- p_changes: any of {name, parent_id, short_name, kind}; present keys apply
-- ('' or null parent_id: top level; '' or null short_name / kind: clear).
create or replace function update_organization(p_org_id uuid, p_changes jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_old     organization%rowtype;
  v_name    text;
  v_parent  uuid;
  v_text    text;
  v_key     text;
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

  foreach v_key in array array['short_name', 'kind'] loop
    continue when not p_changes ? v_key;
    v_text := nullif(btrim(p_changes ->> v_key), '');
    if v_text is distinct from (to_jsonb(v_old) ->> v_key) then
      execute format('update organization set %I = $1 where id = $2', v_key) using v_text, p_org_id;
      insert into edit (object_type, object_id, text, edited_by)
      values ('organization', p_org_id,
              format('%s: %s → %s', replace(v_key, '_', ' '),
                     coalesce(quote_literal(to_jsonb(v_old) ->> v_key), 'empty'), coalesce(quote_literal(v_text), 'empty')), v_uid);
      v_changes := v_changes + 1;
    end if;
  end loop;

  return v_changes;
end;
$$;

-- One level of a tree: each node under p_parent_id, then its children
-- under it. Returns {created, reused}.
create or replace function org_tree_level(p_parent_id uuid, p_nodes jsonb, p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n         jsonb;
  v_name    text;
  v_short   text;
  v_kind    text;
  v_id      uuid;
  v_created integer := 0;
  v_reused  integer := 0;
  v_sub     jsonb;
begin
  if p_nodes is null or jsonb_typeof(p_nodes) <> 'array' then
    return jsonb_build_object('created', 0, 'reused', 0);
  end if;
  for n in select value from jsonb_array_elements(p_nodes) loop
    v_name := nullif(btrim(n ->> 'name'), '');
    if v_name is null then
      raise exception 'Every organization needs a name.';
    end if;
    v_short := nullif(btrim(n ->> 'short_name'), '');
    v_kind := nullif(btrim(n ->> 'kind'), '');

    select id into v_id from organization
    where parent_id is not distinct from p_parent_id and lower(name) = lower(v_name);
    if v_id is null then
      insert into organization (name, parent_id, short_name, kind, created_by)
      values (v_name, p_parent_id, v_short, v_kind, p_uid)
      returning id into v_id;
      v_created := v_created + 1;
    else
      update organization set short_name = coalesce(short_name, v_short), kind = coalesce(kind, v_kind) where id = v_id;
      v_reused := v_reused + 1;
    end if;

    v_sub := org_tree_level(v_id, n -> 'children', p_uid);
    v_created := v_created + (v_sub ->> 'created')::integer;
    v_reused := v_reused + (v_sub ->> 'reused')::integer;
  end loop;
  return jsonb_build_object('created', v_created, 'reused', v_reused);
end;
$$;
revoke execute on function org_tree_level from public, anon, authenticated;

create or replace function create_organization_tree(p_parent_id uuid, p_nodes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if not can_edit() then
    raise exception 'Only editors and owners can add organizations.' using errcode = '42501';
  end if;
  if p_parent_id is not null and not exists (select 1 from organization where id = p_parent_id) then
    raise exception 'Unknown parent organization.';
  end if;
  v_result := org_tree_level(p_parent_id, p_nodes, auth.uid());
  if (v_result ->> 'created')::integer > 0 then
    insert into activity (actor, verb, object)
    values (auth.uid(), 'added organizations',
            format('%s under %s', v_result ->> 'created', coalesce(org_path(p_parent_id), 'the top level')));
  end if;
  return v_result;
end;
$$;
revoke execute on function create_organization_tree from public, anon;
grant execute on function create_organization_tree to authenticated;
