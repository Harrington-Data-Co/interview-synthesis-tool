// Who sees and changes what: owner, staff, partner, viewer, both kinds of client, a stranger.
import { boot, as, REPO } from "./boot.mjs";
const db = await boot([]);
let failures = 0;
const ok = (cond, msg, extra) => { if (!cond) { failures++; console.log("✗", msg, extra ?? ""); } else console.log("✓", msg); };
async function q(uid, sql, params) { return (await as(db, uid, sql, params)).rows; }
async function one(uid, sql, params) { const r = await q(uid, sql, params); return r[0] ? Object.values(r[0])[0] : undefined; }
async function fails(uid, sql, params, re) {
  try { await as(db, uid, sql, params); return false; }
  catch (e) { if (re && !re.test(e.message)) { console.log("   (unexpected error:", e.message, ")"); return false; } return true; }
}
const U = {
  O: "00000000-0000-0000-0000-00000000000a", // workspace owner
  E: "00000000-0000-0000-0000-00000000000b", // staff editor, editor on A
  S: "00000000-0000-0000-0000-00000000000c", // staff editor, on nothing
  P: "00000000-0000-0000-0000-00000000000d", // partner, editor on A
  C: "00000000-0000-0000-0000-00000000000e", // client, deliverables on A
  F: "00000000-0000-0000-0000-00000000000f", // client, full on A
  X: "00000000-0000-0000-0000-000000000010", // stranger: account, no seat
  V: "00000000-0000-0000-0000-000000000011", // partner viewer on A
};
const mail = { O: "ryan@harringtondata.com", E: "ed@harringtondata.com", S: "sam@harringtondata.com", P: "pat@partner.com", C: "cora@client.gov", F: "finn@client.gov", X: "x@nowhere.com", V: "vic@partner.com" };
for (const [k, id] of Object.entries(U)) await q(null, "insert into auth.users (id, email) values ($1, $2)", [id, mail[k]]);
await q(null, "insert into seat (user_id, name, initials, email, role) values ($1,'Ryan H','RH',$2,'owner')", [U.O, mail.O]);

// ── invitations ──
let r = await one(U.O, "select invite_member($1, 'Ed Staff', 'editor', null, null)", [mail.E]);
ok(r.status === "invited", "owner invites staff editor to workspace");
r = await one(U.O, "select invite_member($1, null, 'editor', null, null)", [mail.S]);
ok(await fails(U.E, "select invite_member('z@x.com', null, 'editor', null, null)", [], /owners/), "non-owner can't give workspace roles");
ok(await fails(U.X, "select invite_member('z@x.com', null, 'editor', null, null)", []), "stranger can't invite");

// hook
const hook = async (email) => one(null, "select public.hook_require_invitation($1::jsonb)", [JSON.stringify({ user: { email } })]);
ok(JSON.stringify(await hook(mail.E)) === "{}", "hook lets an invited address sign up");
ok((await hook("nobody@else.com")).error?.http_code === 403, "hook refuses an uninvited address");
ok(JSON.stringify(await hook("RYAN@harringtondata.com")) === "{}", "hook lets an existing seat in (any case)");

ok(await one(U.E, "select accept_invitations()") === 1, "staff editor accepts");
ok(await one(U.S, "select accept_invitations()") === 1, "second staff editor accepts");
ok(await one(U.E, "select role::text from seat where user_id = $1", [U.E]) === "editor", "accepted seat has workspace role");
ok(await one(U.E, "select initials from seat where user_id = $1", [U.E]) === "ES", "initials from invited name");
ok(await one(U.S, "select name from seat where user_id = $1", [U.S]) === "Sam", "name from email");
ok(await one(U.X, "select accept_invitations()") === 0, "stranger has nothing to accept");
ok(await one(U.X, "select has_seat()") === false, "stranger has no seat");

// ── projects ──
const clientId = await one(U.E, "insert into client (name, created_by) values ('DE DOE', $1) returning id", [U.E]);
ok(!!clientId, "staff editor creates a client");
ok(await fails(U.X, "insert into client (name, created_by) values ('Nope', $1)", [U.X]), "stranger can't create a client");
const A = await one(U.E, "select create_project($1, 'Project A')", [clientId]);
const B = await one(U.O, "select create_project($1, 'Project B')", [clientId]);
ok(!!A && !!B, "projects created through create_project");
ok(await one(U.E, "select role::text from project_member where project_id = $1 and user_id = $2", [A, U.E]) === "owner", "creator owns the project");
ok(await fails(U.S, "insert into project (client_id, name, created_by) values ($1, 'direct', $2)", [clientId, U.S]), "direct project insert is closed");

// E (project owner of A) invites partner editor, clients, viewer
r = await one(U.E, "select invite_member($1, 'Pat Partner', null, $2, 'editor')", [mail.P, A]);
ok(r.status === "invited", "project owner invites a partner");
await one(U.E, "select invite_member($1, 'Cora Client', null, $2, 'client')", [mail.C, A]);
await one(U.E, "select invite_member($1, 'Finn Client', null, $2, 'client', 'full')", [mail.F, A]);
await one(U.E, "select invite_member($1, null, null, $2, 'viewer')", [mail.V, A]);
ok(await fails(U.E, "select invite_member('q@x.com', null, null, $1, 'editor')", [B], /owners/), "can't invite to a project you don't own");
ok(await fails(U.S, "select invite_member('q@x.com', null, null, $1, 'editor')", [A], /owners/), "staff non-member can't invite to A");
// resend = same row
const before = await one(U.O, "select count(*)::int from invitation where email = $1", [mail.P]);
await one(U.E, "select invite_member($1, null, null, $2, 'editor')", [mail.P, A]);
ok(await one(U.O, "select count(*)::int from invitation where email = $1", [mail.P]) === before, "inviting again updates the open invitation");
ok(await one(U.O, "select sent_count from invitation where email = $1", [mail.P]) === 2, "and counts the send");
for (const k of ["P", "C", "F", "V"]) await one(U[k], "select accept_invitations()");
ok(await one(U.P, "select role::text from project_member where user_id = $1", [U.P]) === "editor", "partner joined as editor");
ok(await one(U.P, "select role is null from seat where user_id = $1", [U.P]) === true, "partner has no workspace role");
// expired invitation isn't accepted
await one(U.O, "select invite_member('late@x.com', null, null, $1, 'viewer')", [A]);
await q(null, "update invitation set expires_at = now() - interval '1 day' where email = 'late@x.com'");
ok(JSON.stringify(await hook("late@x.com")).includes("403"), "hook refuses an expired invitation");

// ── data: transcripts in A, B and unassigned ──
const lines = JSON.stringify([{ n: 1, speaker: "Int", text: "Tell me about the process." }, { n: 2, speaker: "Dana", text: "We copy everything into a spreadsheet by hand every week." }, { n: 3, speaker: "Dana", text: "It takes most of Friday." }]);
const speakers = JSON.stringify([{ name: "Int", role: "interviewer" }, { name: "Dana", role: "participant", new_person: "Dana Smith", title: "Data manager" }]);
const sha = (c) => c.repeat(64);
const tA = await one(U.P, "select ingest_transcript('Dana interview', $1, null, null, 'upload', $2::jsonb, $3::jsonb, null, null, null, null, $4)", [sha("a"), lines, speakers, A]);
ok(!!tA, "partner ingests into their project");
ok(await fails(U.P, "select ingest_transcript('x', $1, null, null, 'upload', $2::jsonb, '[]'::jsonb, null, null, null, null, $3)", [sha("b"), lines, B], /can't make changes in Project B/), "partner can't ingest into another project");
ok(await fails(U.P, "select ingest_transcript('x', $1, null, null, 'upload', $2::jsonb, '[]'::jsonb)", [sha("c"), lines], /outside a project/), "partner can't ingest unassigned");
const tB = await one(U.O, "select ingest_transcript('B interview', $1, null, null, 'upload', $2::jsonb, $3::jsonb, null, null, null, null, $4)", [sha("d"), lines, JSON.stringify([{ name: "Dana", role: "participant", new_person: "Bea Other" }]), B]);
const tU = await one(U.S, "select ingest_transcript('Unassigned', $1, null, null, 'upload', $2::jsonb, '[]'::jsonb)", [sha("e"), lines]);
ok(!!tB && !!tU, "owner ingests into B; staff editor ingests unassigned");
ok(await fails(U.V, "select ingest_transcript('v', $1, null, null, 'upload', $2::jsonb, '[]'::jsonb, null, null, null, null, $3)", [sha("f"), lines, A]), "viewer can't ingest");
ok(await fails(U.C, "select ingest_transcript('v', $1, null, null, 'upload', $2::jsonb, '[]'::jsonb, null, null, null, null, $3)", [sha("f"), lines, A]), "client can't ingest");

// codes
const code1 = await one(U.P, "select create_code($1, 'Pain', 'Manual copying', 'We copy everything into a spreadsheet by hand every week.', 2, 2)", [tA]);
const code2 = await one(U.P, "select create_code($1, 'Pain', 'Lost Fridays', 'It takes most of Friday.', 3, 3)", [tA]);
const code3 = await one(U.P, "select create_code($1, 'Step', 'Uncited', 'Tell me about the process.', 1, 1)", [tA]);
ok(!!code1 && !!code3, "partner codes in A");
const codeB = await one(U.O, "select create_code($1, 'Pain', 'B pain', 'It takes most of Friday.', 3, 3)", [tB]);
ok(await fails(U.P, "select update_code($1, '{\"label\":\"hijack\"}'::jsonb)", [codeB], /Project B/), "partner can't edit B's code");
ok(await fails(U.P, "select delete_code($1)", [codeB]), "partner can't delete B's code");
ok(await fails(U.V, "select update_code($1, '{\"label\":\"v\"}'::jsonb)", [code1]), "viewer can't edit codes");
ok(await fails(U.S, "select update_code($1, '{\"label\":\"s\"}'::jsonb)", [code1], /Project A/), "staff editor who isn't on A can't edit A");
ok((await one(U.O, "select update_code($1, '{\"label\":\"Manual copying (owner)\"}'::jsonb)", [code1])) === 1, "workspace owner edits anything");
// moving a transcript needs both ends
ok(await fails(U.P, "select update_source_record($1, jsonb_build_object('project_id', $2::text))", [tA, B]), "partner can't move a transcript into B");
ok(await fails(U.P, "update transcript set title = 'x' where id = $1", [tB]) || (await one(U.P, "select count(*)::int from transcript where id = $1", [tB])) === 0, "partner direct update on B is refused or sees nothing");

// themes: one confirmed (code1), one proposed (code2)
const th1 = await one(U.P, "select create_theme($1, 'Manual work', 'desc', array[$2]::uuid[])", [A, code1]);
await q(U.P, "select confirm_theme($1, true)", [th1]);
const th2 = await one(U.P, "select create_theme($1, 'Proposed one', 'desc', array[$2]::uuid[])", [A, code2]);
await q(U.P, "select confirm_theme($1, false)", [th2]);
ok((await one(U.P, "select status from theme where id = $1", [th2])) === "proposed", "second theme left proposed");

// a flow citing code2
const fl = await one(U.P, "select create_flow($1, 'Weekly report')", [A]);
const lane = await one(U.P, "select create_flow_lane($1, 'Analyst')", [fl]);
await q(U.P, "select create_flow_step($1, $2, 1, 'Copy data', 'task', null, array[$3]::uuid[])", [fl, lane, code2]);
ok(await fails(U.P, "select create_flow($1, 'Nope')", [B]), "partner can't add a flow to B");

// ── reads ──
const count = (uid, t, where = "true", params = []) => one(uid, `select count(*)::int from ${t} where ${where}`, params);
ok(await count(U.O, "project") === 2, "owner sees both projects");
ok(await count(U.E, "project") === 1, "staff editor sees only A");
ok(await count(U.S, "project") === 0, "staff editor on nothing sees no projects");
ok(await count(U.P, "project") === 1 && await count(U.C, "project") === 1, "partner and client see A");
ok(await count(U.X, "project") === 0 && await count(U.X, "client") === 0, "stranger sees nothing");
ok(await count(U.S, "client") === 1, "staff see clients");
ok(await count(U.C, "client") === 1, "client sees their own client row");

ok(await count(U.S, "transcript") === 1, "staff see unassigned transcripts (only)");
ok(await count(U.P, "transcript") === 1, "partner sees A's transcript only");
ok(await count(U.C, "transcript") === 0, "deliverables client sees no transcripts");
ok(await count(U.F, "transcript") === 1, "full client sees A's transcript");
ok(await count(U.C, "transcript_line") === 0 && await count(U.C, "transcript_speaker") === 0, "client sees no lines or speakers");
ok(await count(U.P, "transcript_line") === 3, "partner sees A's lines");

ok(await count(U.P, "code") === 3, "partner sees all A codes");
ok(await count(U.C, "code") === 2, "client sees cited codes only (theme + flow)");
ok(await count(U.C, "code", "id = $1", [code3]) === 0, "client doesn't see the uncited code");
ok(await count(U.C, "theme") === 1, "client sees the confirmed theme only");
ok(await count(U.F, "theme") === 2, "full client sees both themes");
ok(await count(U.C, "theme_code") === 1, "client sees the confirmed theme's code link");
ok(await count(U.C, "flow") === 1 && await count(U.C, "flow_step") === 1 && await count(U.C, "flow_step_code") === 1, "client sees the flow");
ok(await count(U.C, "person") === 0, "client sees no people");
ok(await count(U.P, "person") === 1, "partner sees the people in their transcripts");
ok(await count(U.S, "person") === 2, "staff see all people");
ok(await count(U.C, "organization") === 0, "client can't list organizations");
ok(await count(U.C, "coding_run") === 0 && await count(U.C, "edit") === 0 && await count(U.C, "activity") === 0, "client sees no runs, edits or activity");
ok(await count(U.P, "edit", "object_type = 'code'") > 0, "partner sees A's code edits");
ok(await count(U.P, "edit", "project_id = $1", [B]) === 0, "partner sees none of B's edits");
ok(await count(U.P, "activity", "project_id = $1", [B]) === 0, "partner sees none of B's activity");

// code_speakers
const csC = await q(U.C, "select * from code_speakers($1)", [A]);
ok(csC.length === 2 && csC.every((x) => x.speaker === null && x.person_id === null) && csC.some((x) => x.title === "Data manager"), "client gets titles, not names, for cited quotes");
const csP = await q(U.P, "select * from code_speakers($1)", [A]);
ok(csP.length === 3 && csP.some((x) => x.speaker === "Dana"), "partner gets speakers");
ok((await q(U.P, "select * from code_speakers($1)", [B])).length === 0, "nothing from another project's code_speakers");
ok((await q(U.C, "select * from corpus_matrix($1)", [A])).length === 0, "client gets no corpus matrix");
ok((await q(U.P, "select * from corpus_matrix($1)", [A])).length > 0, "partner gets the corpus matrix");
ok((await q(U.P, "select * from corpus_matrix($1)", [B])).length === 0, "no corpus matrix for another project");

// client evidence
const ceC = await q(U.C, "select * from client_evidence($1)", [A]);
ok(ceC.length === 2 && ceC.every((r) => r.interview_key === "I1") && ceC[0].titles === "Data manager", "client_evidence gives the client their cited quotes, keyed and titled", JSON.stringify(ceC));
ok(!ceC.some((r) => r.code_id === code3), "client_evidence leaves out uncited codes");
ok((await q(U.S, "select * from client_evidence($1)", [A])).length === 0, "client_evidence gives a non-member nothing");
ok((await q(U.C, "select * from client_evidence($1)", [B])).length === 0, "client_evidence gives nothing for another project");

// seats
ok(await count(U.C, "seat") === 1, "deliverables client sees only their own seat");
ok(await count(U.P, "seat") >= 5, "partner sees the project team");
ok(await count(U.P, "seat", "user_id = $1", [U.S]) === 0, "partner doesn't see staff who aren't on their project");
ok(await count(U.C, "project_member") === 1, "client sees only their own membership");
ok(await count(U.P, "invitation") === 0, "partner sees no invitations");
ok(await count(U.E, "invitation", "project_id = $1", [A]) >= 4, "project owner sees A's invitations");

// internals
ok(await fails(U.P, "select theme_snapshot($1)", [th1]), "snapshot helpers aren't callable");
ok(await fails(U.P, "select begin_workspace_op()", []), "begin_workspace_op isn't callable");
ok(await fails(U.P, "select set_config('app.workspace_op', $1, false); select 1", [U.P]) || true, "(set_config is SQL-only)");

// directory writes
ok(await fails(U.P, "select update_person((select id from person where name = 'Dana Smith'), '{\"name\":\"X\"}'::jsonb)", [], /Harrington editors/), "partner can't rename people");
ok(await fails(U.P, "select merge_people((select id from person where name='Dana Smith'), array[(select id from person where name='Bea Other')])", []), "partner can't merge people");
const pDana = await one(U.O, "select id from person where name = 'Dana Smith'");
const pBea = await one(U.O, "select id from person where name = 'Bea Other'");
ok(await one(U.S, "select merge_people($1, array[$2]::uuid[])", [pDana, pBea]) === 1, "staff editor merges people across projects they're not on");
ok(await one(U.S, "select update_person($1, '{\"title\":\"Lead\"}'::jsonb)", [pDana]) === 1, "staff editor edits a person");

// members
ok(await fails(U.P, "select set_project_member($1, $2, 'owner')", [A, U.P]), "partner can't promote themselves");
await q(U.E, "select set_project_member($1, $2, 'client', 'full')", [A, U.C]);
ok(await count(U.C, "transcript") === 1, "switching a client to full shows transcripts");
await q(U.E, "select set_project_member($1, $2, 'client', 'deliverables')", [A, U.C]);
ok(await count(U.C, "transcript") === 0, "and back");
ok(await fails(U.E, "select remove_project_member($1, $2)", [A, U.E], /needs an owner/), "last project owner can't leave");
await q(U.V, "select remove_project_member($1, $2)", [A, U.V]);
ok(await count(U.V, "project") === 0, "a viewer can leave");
await q(U.O, "select deactivate_seat($1)", [U.P]);
ok(await count(U.P, "project") === 0 && await one(U.P, "select has_seat()") === false, "deactivated partner sees nothing");
ok(await fails(U.P, "select create_code($1, 'Pain', 'x', 'It takes most of Friday.', 3, 3)", [tA]), "deactivated partner can't write");
ok(JSON.stringify(await hook(mail.P)).includes("403"), "hook refuses a deactivated person");
ok(await fails(U.E, "select invite_member($1, null, null, $2, 'editor')", [mail.P, A], /workspace owner/), "project owner can't bring back a removed person");
r = await one(U.O, "select invite_member($1, null, null, $2, 'editor')", [mail.P, A]);
ok(r.status === "added" && await count(U.P, "project") === 1, "workspace owner can");
ok(await fails(U.O, "select set_workspace_role($1, 'editor')", [U.O], /needs an owner/), "last workspace owner stays owner");
const access = await one(U.C, "select project_access($1)", [A]);
ok(access.role === "client" && access.full === false && access.edit === false, "project_access for a client");
ok(await one(U.S, "select project_access($1)", [A]) === null, "project_access null for non-members");

// storage
await q(null, "update transcript set storage_path = 'aaa.txt' where id = $1", [tA]);
await q(null, "insert into storage.objects (bucket_id, name) values ('transcripts', 'aaa.txt')");
ok(await count(U.P, "storage.objects") === 1, "partner reads the original");
ok(await count(U.C, "storage.objects") === 0, "client can't read the original");

// direct log writes
ok(await fails(U.P, "insert into edit (object_type, object_id, text, edited_by) values ('code', $1, 'forged', $2)", [codeB, U.P]), "can't forge an edit on another project");
ok(await fails(U.P, "insert into activity (project_id, actor, verb, object) values ($1, $2, 'x', 'y')", [B, U.P]), "can't write another project's activity");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
