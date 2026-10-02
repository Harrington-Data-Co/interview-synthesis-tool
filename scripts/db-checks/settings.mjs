// Workspace settings, the two-factor rail, the access log, sign-ins, profiles and usage_runs().
// Settings, two-factor rail, access log, sign-ins, profiles — on top of 20260930g.
import { boot, as, REPO } from "./boot.mjs";
const db = await boot([]);
let failures = 0;
const ok = (c, m, x) => { if (!c) { failures++; console.log("✗", m, x ?? ""); } else console.log("✓", m); };
const q = async (u, sql, p) => (await as(db, u, sql, p)).rows;
const one = async (u, sql, p) => { const r = await q(u, sql, p); return r[0] ? Object.values(r[0])[0] : undefined; };
const fails = async (u, sql, p, re) => { try { await as(db, u, sql, p); return false; } catch (e) { if (re && !re.test(e.message)) { console.log("  (", e.message, ")"); return false; } return true; } };
const aal = async (level) => db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ aal: level })]);
const O = "00000000-0000-0000-0000-00000000000a", E = "00000000-0000-0000-0000-00000000000b", P = "00000000-0000-0000-0000-00000000000d", C = "00000000-0000-0000-0000-00000000000e";
await q(null, "insert into auth.users (id, email, last_sign_in_at) values ($1,'o@h.com', now()), ($2,'e@h.com', null), ($3,'p@x.com', null), ($4,'c@x.com', null)".replace("auth.users (id, email, last_sign_in_at)", "auth.users (id, email)").replace(", now()", "").replace(", null", "").replace(", null", "").replace(", null", ""), [O, E, P, C]).catch(async () => {});
await db.exec("alter table auth.users add column if not exists last_sign_in_at timestamptz");
if (!(await q(null, "select 1 from auth.users")).length) await q(null, "insert into auth.users (id, email) values ($1,'o@h.com'), ($2,'e@h.com'), ($3,'p@x.com'), ($4,'c@x.com')", [O, E, P, C]);
await q(null, "update auth.users set last_sign_in_at = now() - interval '2 days' where id = $1", [O]);
await q(null, "insert into seat (user_id, name, initials, email, role) values ($1,'Ryan','RH','o@h.com','owner')", [O]);
await aal("aal1");

// settings
ok(await one(O, "select invitation_days from workspace_setting") === 14, "default invitation lifetime is 14 days");
await q(O, "select set_workspace_settings(30, null)");
ok(await one(O, "select invitation_days from workspace_setting") === 30, "owner changes invitation lifetime");
ok(await fails(E, "select set_workspace_settings(5, null)", [], /owners/), "non-owner can't change settings");
await one(O, "select invite_member('e@h.com', 'Ed', 'editor', null, null)");
const days = await one(O, "select round(extract(epoch from expires_at - now()) / 86400)::int from invitation where email = 'e@h.com'");
ok(days === 30, "new invitations last the configured days", days);
await one(E, "select accept_invitations()");
const cl = await one(O, "insert into client (name, created_by) values ('C', $1) returning id", [O]);
const A = await one(E, "select create_project($1, 'A')", [cl]);
await one(E, "select invite_member('p@x.com', null, null, $1, 'editor')", [A]);
await one(E, "select invite_member('c@x.com', null, null, $1, 'client')", [A]);
await one(P, "select accept_invitations()");
await one(C, "select accept_invitations()");
await q(E, "select set_project_member($1, $2, 'client', 'full')", [A, C]);
await q(E, "select remove_project_member($1, $2)", [A, P]);

// access log
const verbs = (await q(O, "select verb from access_event order by at, verb")).map((r) => r.verb);
for (const v of ["invited", "accepted an invitation", "joined the workspace", "added", "changed the role of", "removed", "changed workspace settings"]) ok(verbs.includes(v), `access log has "${v}"`, verbs.join(" | "));
ok(await one(E, "select count(*)::int from access_event where project_id = $1", [A]) > 0, "project owner reads their project's log");
ok(await one(E, "select count(*)::int from access_event where project_id is null") === 0, "project owner doesn't read workspace-level events");
ok(await one(C, "select count(*)::int from access_event") === 0, "client reads no log");
ok(await fails(E, "insert into access_event (verb) values ('forged')"), "nobody writes the log directly");

// sign-ins
ok((await q(O, "select * from member_sign_ins()")).length === 4, "owner sees everyone's last sign-in");
ok((await q(E, "select * from member_sign_ins()")).length >= 2, "project owner sees their members' sign-ins");
ok((await q(C, "select * from member_sign_ins()")).length === 0, "client sees none");

// profile
await q(C, "select update_my_profile('Cora Client', null, 'Director')");
ok(await one(C, "select initials from seat where user_id = $1", [C]) === "CC", "profile: initials from the name");
ok((await q(O, "select verb from access_event where verb = 'renamed'")).length === 1, "renaming is logged");
ok(await fails(C, "select update_my_profile('', null, null)", [], /empty/), "name can't be empty");
ok(await fails(C, "select update_my_profile('X', 'ABCD', null)", [], /three/), "initials at most three");

// two-factor rail
ok(await one(O, "select can_read_project($1)", [A]) === true, "before: owner reads A at aal1");
await q(O, "select set_workspace_settings(null, array['owner'])");
ok(await one(O, "select can_read_project($1)", [A]) === false, "owner at aal1 sees nothing once owners need two-factor");
ok(await one(O, "select mfa_required_now()") === true, "mfa_required_now tells the app");
ok(await one(E, "select can_read_project($1)", [A]) === true, "editors unaffected");
await aal("aal2");
ok(await one(O, "select can_read_project($1)", [A]) === true, "owner at aal2 sees everything again");
ok(await one(O, "select mfa_required_now()") === false, "and isn't asked");
await q(O, "select set_workspace_settings(null, array['outside'])");
await aal("aal1");
ok(await one(C, "select can_read_project($1)", [A]) === false, "'outside' covers people with no workspace role");
ok(await one(E, "select can_read_project($1)", [A]) === true, "but not staff");
await aal("aal2");
await q(O, "select set_workspace_settings(null, array[]::text[])");
await aal("aal1");
ok(await one(C, "select can_read_project($1)", [A]) === true, "cleared: back to normal at aal1");
ok(await fails(O, "select set_workspace_settings(null, array['nonsense'])"), "unknown requirement refused");
// usage
const lines = JSON.stringify([{ n: 1, speaker: "Dana", text: "We copy everything by hand." }]);
const t = await one(P, "select 1").catch(() => null);
const tA = await one(O, "select ingest_transcript('Usage T', $1, null, null, 'upload', $2::jsonb, '[]'::jsonb, null, null, null, null, $3)", ["9".repeat(64), lines, A]);
const run1 = await one(O, "select start_coding_run($1, 'claude-opus-5-5', 'high', 'v')", [tA]);
await q(O, "select save_coding_run($1, '[]'::jsonb, '[]'::jsonb, '{\"cost_usd\": 0.42, \"input_tokens\": 1000, \"output_tokens\": 200, \"served_by\": \"claude-opus-5-5\"}'::jsonb)", [run1]);
await q(O, "select start_theme_run($1, 'claude-opus-5-5', 'high', 'v')", [A]);
const u = await q(O, "select * from usage_runs()");
ok(u.length === 2 && u.some((r) => r.pass === "Coding" && Number(r.cost_usd) === 0.42 && r.subject === "Usage T") && u.some((r) => r.pass === "Themes" && r.status === "running"), "usage_runs lists every pass's runs", JSON.stringify(u.map((r) => [r.pass, r.cost_usd, r.status])));
ok((await q(E, "select * from usage_runs()")).length === 0, "usage_runs is for workspace owners only");
ok((await q(O, "select * from usage_runs(now() + interval '1 day')")).length === 0, "usage_runs filters by date");
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
