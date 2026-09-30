-- Phase 6: the Google Drive connector, for Google Meet transcripts.
--
-- Run once in the Supabase SQL editor on a database that has
-- 20260929d_corpus.sql applied. A fresh database doesn't need this:
-- schema.sql already includes everything below.
--
-- Adds:
--   - connector_account: each person's Google connection. The refresh token
--     arrives encrypted by the app; each person reads only their own row.
--   - connector_import: which Drive files became which transcripts, so none
--     is imported twice.

begin;

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

commit;
