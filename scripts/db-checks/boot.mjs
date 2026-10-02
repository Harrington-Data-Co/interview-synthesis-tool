// Loads supabase/schema.sql (plus any extra files) into a fresh in-memory
// Postgres (PGlite), with just enough of Supabase stubbed in: auth.users,
// auth.uid() / auth.jwt() from settings, the roles, and storage.
// as(db, uid, sql) runs a query as that signed-in user (null: as the owner).
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
export const REPO = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
export async function boot(extra = [], base = `${REPO}/supabase/schema.sql`) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users (id uuid primary key, email text unique, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz, created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
    alter table storage.objects enable row level security;
    grant usage on schema public, auth, storage to authenticated, anon;
    grant execute on function auth.uid(), auth.jwt() to authenticated, anon;
  `);
  const files = [base, ...extra];
  for (const f of files) {
    try { await db.exec(fs.readFileSync(f, "utf8")); }
    catch (e) { console.error("FAILED loading", f, e.message, e.position ? "pos " + e.position : ""); throw e; }
  }
  await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;
                 grant usage, select on all sequences in schema public to authenticated; grant select, insert on storage.objects to authenticated;`);
  return db;
}
// Run fn as user uid (null = superuser).
export async function as(db, uid, sql, params = []) {
  await db.exec("reset role");
  if (uid) {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    await db.exec("set role authenticated");
  } else {
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
  try { return await db.query(sql, params); }
  finally { await db.exec("reset role"); }
}
