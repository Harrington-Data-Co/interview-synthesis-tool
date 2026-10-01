-- Client short codes (backlog R7).
--
-- Ryan gives each client a short code (LWF, DEDOE) that he uses across all
-- his tools, Google Drive folders included, to match the same client
-- everywhere. Optional: a client needn't have one, and nothing depends on
-- it (URLs use the client's name). Unique when set, ignoring case, so a
-- code always means one client.

alter table client
  add column code text check (code is null or (btrim(code) <> '' and length(code) <= 20));

create unique index client_code_key on client (lower(code)) where code is not null;
