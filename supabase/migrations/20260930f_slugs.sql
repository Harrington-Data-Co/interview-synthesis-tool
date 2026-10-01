-- Meaningful URLs (backlog R1).
--
-- A project's page moves from /projects/<uuid> to
-- /clients/<client slug>/<project slug>, so each client gets a slug (unique)
-- and each project one (unique within its client). They are stored, not
-- derived from names on every request, so renaming a client or project
-- never breaks a link. The client part is the client's name, never its
-- short code: codes are optional (R7).
--
-- New rows get a slug from their name on insert (the trigger), with -2, -3…
-- added when it's taken. Old /projects/<uuid> links redirect in the app.

create or replace function slugify(p_text text)
returns text language sql immutable as $$
  -- "Département & Co." → "departement-and-co": accents dropped, anything
  -- else between words becomes one dash, at most 80 characters.
  select coalesce(nullif(btrim(left(btrim(regexp_replace(
    regexp_replace(lower(normalize(replace(p_text, '&', ' and '), NFKD)), '[\u0300-\u036f]', '', 'g'),
    '[^a-z0-9]+', '-', 'g'), '-'), 80), '-'), ''), 'untitled')
$$;

alter table client add column slug text check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
alter table project add column slug text check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Backfill, oldest first, so the first of two same-named rows keeps the
-- plain slug.
with numbered as (
  select id, slugify(name) as base,
         row_number() over (partition by slugify(name) order by created_at, id) as n
  from client
)
update client c
   set slug = rtrim(left(numbered.base, 76), '-') || case when n = 1 then '' else '-' || n end
  from numbered where numbered.id = c.id;

with numbered as (
  select id, slugify(name) as base,
         row_number() over (partition by client_id, slugify(name) order by created_at, id) as n
  from project
)
update project p
   set slug = rtrim(left(numbered.base, 76), '-') || case when n = 1 then '' else '-' || n end
  from numbered where numbered.id = p.id;

alter table client alter column slug set not null;
alter table project alter column slug set not null;
create unique index client_slug_key on client (slug);
create unique index project_slug_key on project (client_id, slug);

-- A slug from the name on insert, unless one is given; -2, -3… when taken.
create or replace function set_slug()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text := rtrim(left(slugify(new.name), 76), '-');
  candidate text;
  n int := 1;
  taken boolean;
begin
  if new.slug is not null then return new; end if;
  loop
    candidate := base || case when n = 1 then '' else '-' || n end;
    -- Separate statements: a project's client_id isn't a field of a client row.
    if tg_table_name = 'client' then
      taken := exists (select 1 from client where slug = candidate);
    else
      taken := exists (select 1 from project where client_id = new.client_id and slug = candidate);
    end if;
    exit when not taken;
    n := n + 1;
  end loop;
  new.slug := candidate;
  return new;
end $$;

create trigger client_set_slug before insert on client for each row execute function set_slug();
create trigger project_set_slug before insert on project for each row execute function set_slug();
