// Every writing function still works for a partner editor on their own project.
// Every writing path, exercised by a partner editor on their own project.
import { boot, as, REPO } from "./boot.mjs";
const db = await boot([]);
let failures = 0;
const ok = (cond, msg, extra) => { if (!cond) { failures++; console.log("✗", msg, extra ?? ""); } else console.log("✓", msg); };
async function q(uid, sql, params) { return (await as(db, uid, sql, params)).rows; }
async function one(uid, sql, params) { const r = await q(uid, sql, params); return r[0] ? Object.values(r[0])[0] : undefined; }
async function run(label, uid, sql, params) { try { const v = await one(uid, sql, params); ok(true, label); return v; } catch (e) { ok(false, label, e.message); return undefined; } }
const O = "00000000-0000-0000-0000-00000000000a", P = "00000000-0000-0000-0000-00000000000d";
await q(null, "insert into auth.users (id, email) values ($1,'ryan@harringtondata.com'), ($2,'pat@partner.com')", [O, P]);
await q(null, "insert into seat (user_id, name, initials, email, role) values ($1,'Ryan','RH','ryan@harringtondata.com','owner')", [O]);
const cl = await one(O, "insert into client (name, created_by) values ('C', $1) returning id", [O]);
const A = await one(O, "select create_project($1, 'A')", [cl]);
await one(O, "select invite_member('pat@partner.com', 'Pat', null, $1, 'editor')", [A]);
await one(P, "select accept_invitations()");
const lines = JSON.stringify([{ n: 1, speaker: "Int", text: "Tell me about the process." }, { n: 2, speaker: "Dana", text: "We copy everything into a spreadsheet by hand every week." }, { n: 3, speaker: "Dana", text: "It takes most of Friday." }]);
const t = await run("ingest", P, "select ingest_transcript('T', $1, null, null, 'upload', $2::jsonb, $3::jsonb, null, null, null, null, $4)", ["a".repeat(64), lines, JSON.stringify([{ name: "Int", role: "interviewer" }, { name: "Dana", role: "participant", new_person: "Dana" }]), A]);
await run("update_source_record title + speaker", P, "select update_source_record($1, '{\"title\":\"T2\"}'::jsonb, '[{\"name\":\"Dana\",\"title\":\"Analyst\"}]'::jsonb)", [t]);
// labels (direct writes)
const ax = await run("label_axis insert", P, "insert into label_axis (project_id, key, name) values ($1, 'dept', 'Dept') returning id", [A]);
const opt = await run("label_option insert", P, "insert into label_option (axis_id, value) values ($1, 'Ops') returning id", [ax]);
await run("transcript_label insert", P, "insert into transcript_label (transcript_id, axis_id, option_id, set_by) values ($1, $2, $3, $4) returning 1", [t, ax, opt, P]);
await run("label_option update", P, "update label_option set value = 'Operations' where id = $1 returning 1", [opt]);
// coding
const cr = await run("start_coding_run", P, "select start_coding_run($1, 'm', 'high', 'v')", [t]);
const sc = await run("save_coding_run", P, "select save_coding_run($1, $2::jsonb, $3::jsonb)", [cr, JSON.stringify([{ line_start: 2, line_end: 2, type: "Pain", label: "Copying", verbatim: "We copy everything into a spreadsheet by hand every week." }, { line_start: 3, line_end: 3, type: "Pain", label: "Friday", verbatim: "It takes most of Friday." }]), JSON.stringify([{ proposal: {}, reason: "test" }])]);
ok(sc?.accepted === 2 && sc?.rejected === 1, "coding run accepted 2, rejected 1", JSON.stringify(sc));
const rej = await one(P, "select id from code_rejection where resolution is null limit 1");
await run("dismiss_rejection", P, "select dismiss_rejection($1)", [rej]);
const [c1, c2] = (await q(P, "select id from code where transcript_id = $1 order by line_start", [t])).map((r) => r.id);
const c3 = await run("create_code", P, "select create_code($1, 'Step', 'Ask', 'Tell me about the process.', 1, 1)", [t]);
await run("update_code", P, "select update_code($1, '{\"label\":\"Ask more\"}'::jsonb)", [c3]);
await run("revert_last_code_edit", P, "select revert_last_code_edit($1)", [c3]);
const c4 = await run("create_code 2", P, "select create_code($1, 'Step', 'Ask2', 'Tell me about the process.', 1, 1)", [t]);
await run("merge_codes", P, "select merge_codes($1, array[$2]::uuid[])", [c3, c4]);
// notes: library template by owner, copied by partner
const nt = await run("owner library note template", O, "insert into note_template (name, created_by) values ('Lib', $1) returning id", [O]);
await run("owner library note section", O, "insert into note_section (template_id, ordinal, name, created_by) values ($1, 1, 'Pains', $2) returning 1", [nt, O]);
ok(!!(await q(P, "select 1 from note_template where id = $1", [nt])).length, "partner sees the library template");
const ntA = await run("copy_note_template", P, "select copy_note_template($1, $2)", [nt, A]);
await run("partner edits project note section", P, "update note_section set name = 'Pain points' where template_id = $1 returning 1", [ntA]);
let failedLib = false; try { await one(P, "update note_section set name = 'x' where template_id = $1 returning 1", [nt]); } catch { failedLib = true; }
ok(failedLib, "partner can't edit the library template");
const secA = await one(P, "select id from note_section where template_id = $1", [ntA]);
const nr = await run("start_note_run", P, "select start_note_run($1, $2, 'm', 'e', 'v')", [t, ntA]);
const sn = await run("save_note_run", P, "select save_note_run($1, $2::jsonb)", [nr, JSON.stringify([{ section_id: secA, text: "Copies by hand", code_ids: [c1] }])]);
ok(sn?.accepted === 1, "note run accepted", JSON.stringify(sn));
const note = await one(P, "select id from note where transcript_id = $1", [t]);
const ni = await run("create_note_item", P, "select create_note_item($1, $2, 'Loses Fridays', array[$3]::uuid[])", [note, secA, c2]);
await run("update_note_item", P, "select update_note_item($1, '{\"text\":\"Loses most Fridays\"}'::jsonb)", [ni]);
await run("move_note_item", P, "select move_note_item($1, -1)", [ni]);
await run("revert_last_note_item_edit", P, "select revert_last_note_item_edit($1)", [ni]);
await run("delete_note_item", P, "select delete_note_item($1)", [ni]);
ok((await q(P, "select * from note_coverage($1)", [note])).length > 0, "note_coverage");
// themes
const tr = await run("start_theme_run", P, "select start_theme_run($1, 'm', 'e', 'v')", [A]);
const st = await run("save_theme_run", P, "select save_theme_run($1, $2::jsonb)", [tr, JSON.stringify([{ title: "Manual work", description: "d", code_ids: [c1, c2] }, { title: "Other", description: "d", code_ids: [c3] }])]);
ok(st?.accepted === 2, "theme run accepted", JSON.stringify(st));
const [th1, th2] = (await q(P, "select id from theme where project_id = $1 order by ref", [A])).map((r) => r.id);
await run("confirm_theme", P, "select confirm_theme($1, true)", [th1]);
await run("update_theme", P, "select update_theme($1, '{\"title\":\"Manual work everywhere\"}'::jsonb)", [th1]);
await run("revert_last_theme_edit", P, "select revert_last_theme_edit($1)", [th1]);
const th3 = await run("split_theme", P, "select split_theme($1, array[$2]::uuid[], 'Fridays')", [th1, c2]);
await run("merge_themes", P, "select merge_themes($1, array[$2]::uuid[])", [th1, th3]);
await run("confirm_theme again", P, "select confirm_theme($1, true)", [th1]);
await run("delete_theme", P, "select delete_theme($1)", [th2]);
// memo
const pt = await run("owner library memo template", O, "insert into product_template (name, kind, created_by) values ('Memo', 'report', $1) returning id", [O]);
await run("owner library memo section", O, "insert into product_section (template_id, ordinal, name, requires, created_by) values ($1, 1, 'Findings', '{}', $2) returning 1", [pt, O]);
const ptA = await run("copy_product_template", P, "select copy_product_template($1, $2)", [pt, A]);
const psA = await one(P, "select id from product_section where template_id = $1", [ptA]);
const prr = await run("start_product_run", P, "select start_product_run($1, $2, 'm', 'e', 'v')", [A, ptA]);
const sp = await run("save_product_run", P, "select save_product_run($1, 'Memo', $2::jsonb)", [prr, JSON.stringify([{ section_id: psA, text: "People copy by hand.", theme_ids: [th1], code_ids: [] }])]);
ok(sp?.accepted === 1, "memo run accepted", JSON.stringify(sp) + " " + JSON.stringify(await q(P, "select reason from product_item_rejection")));
const prod = await one(P, "select id from product where project_id = $1 and template_id = $2", [A, ptA]);
const pi = await run("create_product_item", P, "select create_product_item($1, $2, 'More.', array[$3]::uuid[], array[]::uuid[])", [prod, psA, th1]);
await run("update_product_item", P, "select update_product_item($1, '{\"text\":\"More text.\"}'::jsonb)", [pi]);
await run("move_product_item", P, "select move_product_item($1, -1)", [pi]);
await run("revert_last_product_item_edit", P, "select revert_last_product_item_edit($1)", [pi]);
await run("set_product_title", P, "select set_product_title($1, 'Findings memo')", [prod]);
await run("delete_product_item", P, "select delete_product_item($1)", [pi]);
// deck
const dt = await run("owner library deck template", O, "insert into product_template (name, kind, created_by) values ('Deck', 'deck', $1) returning id", [O]);
await run("owner library deck section", O, "insert into product_section (template_id, ordinal, name, requires, created_by) values ($1, 1, 'Findings', '{}', $2) returning 1", [dt, O]);
const dtA = await run("copy deck template", P, "select copy_product_template($1, $2)", [dt, A]);
const dsA = await one(P, "select id from product_section where template_id = $1", [dtA]);
const drr = await run("start deck run", P, "select start_product_run($1, $2, 'm', 'e', 'v')", [A, dtA]);
const sd = await run("save_deck_run", P, "select save_deck_run($1, 'Deck', $2::jsonb)", [drr, JSON.stringify([{ section_id: dsA, layout: "finding", title: "Copying by hand", bullets: ["Every week"], theme_ids: [th1], code_ids: [] }])]);
ok(sd?.accepted === 1, "deck run accepted", JSON.stringify(sd) + " " + JSON.stringify(await q(P, "select reason from product_item_rejection order by created_at desc limit 1")));
const deck = await one(P, "select id from product where template_id = $1", [dtA]);
const sl = await run("create_deck_slide", P, "select create_deck_slide($1, $2, 'statement', 'A statement', array['x']::text[], null, null, array[$3]::uuid[], array[]::uuid[])", [deck, dsA, th1]);
await run("update_deck_slide", P, "select update_deck_slide($1, '{\"title\":\"A better statement\"}'::jsonb)", [sl]);
await run("move_deck_slide", P, "select move_deck_slide($1, -1)", [sl]);
await run("revert_last_deck_slide_edit", P, "select revert_last_deck_slide_edit($1)", [sl]);
await run("delete_deck_slide", P, "select delete_deck_slide($1)", [sl]);
// flows
const fr = await run("start_flow_run", P, "select start_flow_run($1, 'm', 'e', 'v')", [A]);
const sf = await run("save_flow_run", P, "select save_flow_run($1, $2::jsonb)", [fr, JSON.stringify([{ title: "Weekly", scope: "s", lanes: ["Analyst"], steps: [{ lane: 0, position: 1, label: "Copy", kind: "task", code_ids: [c1] }] }])]);
ok(sf?.accepted >= 1, "flow run accepted", JSON.stringify(sf) + JSON.stringify(await q(P, "select reason from flow_rejection")));
const fl = await one(P, "select id from flow where project_id = $1 limit 1", [A]);
const ln = await run("create_flow_lane", P, "select create_flow_lane($1, 'Manager')", [fl]);
await run("rename_flow_lane", P, "select rename_flow_lane($1, 'Boss')", [ln]);
await run("move_flow_lane", P, "select move_flow_lane($1, -1)", [ln]);
const stp = await run("create_flow_step", P, "select create_flow_step($1, $2, 1, 'Approve', 'decision', null, array[$3]::uuid[])", [fl, ln, c2]);
await run("update_flow_step", P, "select update_flow_step($1, '{\"label\":\"Approves\"}'::jsonb)", [stp]);
await run("revert_last_flow_step_edit", P, "select revert_last_flow_step_edit($1)", [stp]);
await run("delete_flow_step", P, "select delete_flow_step($1)", [stp]);
await run("delete_flow_lane", P, "select delete_flow_lane($1)", [ln]);
await run("update_flow", P, "select update_flow($1, '{\"title\":\"Weekly report\"}'::jsonb)", [fl]);
// architecture
const ar = await run("start_arch_run", P, "select start_arch_run($1, 'm', 'e', 'v')", [A]);
const sa = await run("save_arch_run", P, "select save_arch_run($1, $2::jsonb)", [ar, JSON.stringify([{ title: "Systems", scope: "s", nodes: [{ name: "Excel", kind: "spreadsheet", official: false, code_ids: [c1] }, { name: "SIS", kind: "system", official: true, code_ids: [c1] }], flows: [{ from: "SIS", to: "Excel", label: "rows", manual: true, code_ids: [c1] }], gaps: [{ title: "No export", code_ids: [c2] }] }])]);
ok(sa?.accepted >= 1, "arch run accepted", JSON.stringify(sa) + JSON.stringify(await q(P, "select reason from arch_rejection")));
const am = await one(P, "select id from arch_map where project_id = $1 limit 1", [A]);
const node = await run("save_arch_item (new node)", P, "select save_arch_item($1, 'node', null, $2::jsonb)", [am, JSON.stringify({ name: "Email", kind: "communication", official: true, code_ids: [c2] })]);
await run("delete_arch_item", P, "select delete_arch_item($1, 'node', $2)", [am, node]);
await run("update_arch_map", P, "select update_arch_map($1, '{\"title\":\"Current systems\"}'::jsonb)", [am]);
// connector import record, activity, edits read back
await run("record_connector_import", P, "select record_connector_import('google', 'doc-1', $1)", [t]);
await run("verify-style activity insert", P, "insert into activity (project_id, actor, verb, object) values ($1, $2, 'verified', 'T') returning 1", [A, P]);
ok(await one(P, "select count(*)::int from edit where project_id = $1", [A]) > 5, "edits are tagged with the project");
// discards and deletes
ok(await q(P, "select discard_claude_codes($1)", [t]).then(() => false, (e) => /must cite/.test(e.message)), "discard_claude_codes refused while a note cites them (existing rule)");
await run("discard_proposed_themes", P, "select discard_proposed_themes($1)", [A]);
await run("delete_flow", P, "select delete_flow($1)", [fl]);
await run("delete_arch_map", P, "select delete_arch_map($1)", [am]);
await run("delete a memo directly", P, "delete from product where id = $1 returning 1", [prod]);
await run("delete transcript directly", P, "delete from transcript where id = $1 returning 1", [t]);
await run("partner renames project", P, "update project set name = 'A2' where id = $1 returning 1", [A]);
let delFailed = false; try { const r = await one(P, "delete from project where id = $1 returning 1", [A]); delFailed = r === undefined; } catch { delFailed = true; }
ok(delFailed, "partner editor can't delete the project");
await run("owner deletes the project", O, "delete from project where id = $1 returning 1", [A]);
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
