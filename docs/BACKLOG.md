# Backlog

Improvements queued after Phase 1's exit test passed (2026-09-28). Each item
notes what it touches, so it can be picked up without re-deriving the design.
Order is not priority — see *Suggested order* at the end.

## From the Phase 1 review

### 1. Bulk upload
*Done 2026-09-28 — no migration needed, tested.*
Add several files at once instead of one per dialog.

- Pick many files → one review table, a row per file: parsed layout, turns,
  pre-filled title / participant / date, and any duplicate flagged and skipped.
- Speaker roles still need a human, so each row expands to its speakers table.
  Defaults (first-name guesses) apply to rows nobody opens.
- Client and project chosen once for the batch, overridable per row.
- Save commits each file independently through the existing ingest route; one
  failure doesn't block the rest, and the result lists what landed.

### 2. "Save and add another"
*Done 2026-09-28 — no migration needed, tested.*
After saving, offer to add the next transcript without leaving the dialog.

- A second button beside *Save transcript*. Keeps the client and project just
  used; clears the file and per-file details.
- Mostly subsumed by bulk upload, but still useful for one-at-a-time pasting
  from Wispr Flow, where there are no files to multi-select.

### 3. Separate Client and Project dropdowns
*Done 2026-09-28 — migration `20260928b`, tested.*
In the add-transcript dialog, choose the client first; the project list shows
only that client's projects.

- **Client and Organization are different things** (decided 2026-09-28):
  - **Client** — the paying customer the project is for. Client → Project is
    the existing `client` / `project` hierarchy.
  - **Organization** — the group a *speaker* represents. It belongs to a
    person in a transcript, not to the project. Example: client *DE Dept. of
    Education*, project *PDG B-5 Data Workstream*, participant *Thomas Smith*,
    organization *Profisee*.
- Same pair of dropdowns wherever a transcript is assigned (library, source
  record editing in item 4, bulk upload in item 1).

### 3a. Organizations
*Done 2026-09-28 — migration `20260928b`, tested.*
A reusable `organization` list (workspace-wide, not per client, since the same
organization can appear across clients' projects), and an organization on each
speaker: `transcript_speaker.organization_id`.

- Per speaker, not per transcript: one call routinely mixes organizations
  (the Profisee call has Profisee's people, Jen, and Harrington Data).
- The participant's organization is the organization of the speaker(s) marked
  participant; the source record shows it.
- **Nested** (decided 2026-09-28): an organization can sit under a parent
  (Delaware DOE › Office of Early Learning), shown as its path. No cycles.
- Picked (or created) in the upload review's speakers table and in item 4's
  editing. Later: coverage and saturation by organization.

### 4. Edit the source record after upload
*Done 2026-09-28 — migration `20260928b`, tested.*
The transcript lines stay immutable; the metadata around them doesn't.
Editable: participant name, date recorded, client, project, speaker names,
speaker roles, and speaker organizations (3a).

- **Speaker names use a display name** (decided 2026-09-28).
  `transcript_line.speaker` is part of the immutable record and keeps the name exactly as the export wrote it ("Jen :)").
  Editing a name therefore means a display name on `transcript_speaker`, not a
  change to the lines: add `display_name`, show it everywhere, keep the
  original visible on the transcript page. This also lets two export names map
  to one person ("Jen :)" and "Jennifer Koester" → Jennifer Koester).
- Every change writes an `edit` + `activity` row, so the record shows who
  changed what — the same attribution the coding layer will use.
- Changing client/project reuses the assignment rules (`new` ↔ `queued`).

### 5. Project view, and a library organized by it
*Done 2026-09-28 — no migration needed, tested.*
Click into a project to see its transcripts; the library becomes a queue of
unassigned transcripts, with everything else living under its client and
project.

- Library: an *Unassigned* queue (status `new`) first, then clients →
  projects, each with a transcript count.
- Project page (`/projects/[id]`): its transcripts, participants and their
  organizations, status mix, and later the Study stages (codes, notes, themes) for that project. This is
  the natural home for the plan's `study/[projectId]` view.
- Builds on item 3's client → project picker.

## Carried over

- **Labels** (Phase 1 step 6). *Done 2026-09-28 — migration `20260928c`,
  tested.* Label axes and options per project. Reworked after review
  to one Labels column of chips, one *Label as…* menu for a row or a
  selection (new labels and options typed in place), and *Manage labels* for
  renaming and removing. Then reworked again: the Group by switch and filter
  pills are gone; sorting, grouping and filtering happen from the column
  headers (participant, organization, each label, recorded, length, status),
  the sidebar counts whatever the table is grouped by, and the view is
  remembered per project in the browser. The database keeps options on their
  own axis and labels in the transcript's project, and a transcript that moves
  project drops the old project's labels.
- **Verify** button. *Done 2026-09-28, tested.* Re-hashes the stored
  original against its `sha256`; editors' checks are logged to activity.
- **Wispr Flow paste**. *Tested 2026-09-28.* Follow-up built: the paste form
  asks where the text came from (default Wispr Flow) instead of assuming.
- **Attribution on inserts**. *Done 2026-09-28 — migration `20260928c`,
  tested.* A row's author must be the person writing it, and who
  created a row can't be changed afterwards (`keep_attribution`). Tables
  without an author column yet (`note_section`, `note_item`,
  `product_section`, the join tables) get one when their phase builds them.
- **Block outside sign-ups**. *Built 2026-09-28 — migration `20260928c`;
  deliberately not turned on.* The hook function exists but is inert until
  enabled (Authentication → Hooks → Before User Created →
  `public.hook_restrict_signup_domain`). Likely superseded by the invitation
  model below. Until then, a stranger can create an empty account against the
  Auth API but sees nothing: every policy requires a seat.

- **Custom SMTP**. *Needs doing in Supabase and DNS* — not code. Steps in the
  README under "Before adding teammates". Before adding teammates.
- **Lint**: unused `redirect` import. *Fixed 2026-09-28.*

## Under consideration

### Invitation-only access, project roles, and client access
*Built 2026-09-30 overnight (branch `invitations`) — migration
`20260930g_invitations`, checked in PGlite; not yet applied or tried
signed in.* Only invited people can use the tool, whatever their email
domain. Multi-tenant client access moved here from Phase 6 on 2026-09-29.

**Decided with Ryan 2026-09-30:**
- **Access is per project for everyone.** Workspace owners see and manage
  everything; anyone else sees only the projects they're a member of.
- **Who invites**: workspace owners (to anything, and workspace roles);
  project owners (to their own project).
- **What a client sees**: by default the deliverables (memo, deck, process
  flows, architecture), confirmed themes, and the quotes those cite,
  attributed by title, not name — no transcripts, notes, uncited codes,
  people, chain or corpus. A project owner can switch one client to
  **everything, read-only** when more is needed.
- Branch, commit, push; no merge.

**Decided in the build (Ryan to confirm or change):**
- Project roles are owner / editor / viewer / client. The workspace role
  (owner / editor / viewer) is now optional: it marks Harrington's own
  people, who also get Sources, People, Organizations and the template
  library. Someone from outside has none.
- Invitations last **14 days**; Send again restarts them. **Copy link**
  hands one over by hand (it replaces any emailed link). Inviting someone
  who already has a seat adds them at once.
- Staff see **every person** on People (it's a workspace page), but a
  person's interviews only where they're on the project. Outsiders see the
  people who speak in transcripts they can read.
- **Partners** (outside editors) may add people and organizations while
  working (speaker pickers) but not rename, merge or delete them; they
  can't start clients or projects or leave transcripts unassigned.
- The creator of a project is its owner. Existing seats became members of
  every existing project with their old role, so nothing changed for them.
- Removing someone from the workspace keeps their seat (it authors their
  work), takes them off every project and withdraws their invitations; only
  a workspace owner can bring them back.
- Workspace owners aren't listed on a project's Members unless they're on it.

**How it's enforced** (migration header has the detail): read policies ask
which projects the reader belongs to; one guard trigger per project table
checks every write — direct or through the definer functions — against the
row's project, so the 150 writing functions didn't each need a new check.
Clients get quotes through `client_evidence()`, titles through
`code_speakers()`.

**Follow-ups:**
- Activity on Members (the prototype's Activity tab).
- Who edits people in place (BACKLOG person model) can now follow project
  roles if wanted.
- A client's deliverables view could drop the editing chrome entirely
  (today it's the read-only version of each tab).

### Settings, identity and access, toward deployment
*Built 2026-10-01 (branch `settings-and-access`) — migration
`20261001a_settings_and_access`, checked in PGlite.* Decided with Ryan
2026-10-01: tools.harringtondata.com is the Harrington Tools hub and this
tool lives at **/interview-synthesis**; one shared sign-in across tools,
roles per tool; hosted on **Vercel**; two-factor sign-in later, with the
rails built now.

- **Base path**: `NEXT_PUBLIC_BASE_PATH` (empty locally) read by
  `next.config.ts` and `src/lib/basePath.ts`; every plain `fetch`, `<a>`
  and redirect goes through `withBase()`. The domain root redirects to the
  tool until the hub exists. Security headers (no framing, nosniff,
  referrer policy, HSTS) in `next.config.ts`.
- **Your account** (`/account`): name, initials, title (name also on the
  shared Supabase account), password, sign out of other devices, your
  access.
- **Settings** (`/settings`, owners, from the account menu — Ryan
  2026-10-01: these belong under the account dropdown, not the header),
  four tabs: **Members** (with last sign-in, how long invitations last,
  and — Ryan 2026-10-01 — adding someone to a project with a role, or
  taking them off one, from their row), **Usage** (below), **Access log** (written by triggers into
  `access_event`; project owners see their project's on its Members tab),
  **Setup** (what the server has been given and the addresses to
  register; reports only). `/members` and `/workspace` redirect.
- **Usage** (`/settings/usage`, Ryan 2026-10-01: "an activity list of all
  of the runs and a dashboard around how the tool is being used"):
  `usage_runs()` unions every pass's runs (owners only). Range (30 / 90
  days, 12 months, all); spend as the headline with runs, failures, people
  and tokens; spend per day or week; spend by project, person and pass
  (top 7 + Other; each a link that narrows the page); the latest 100 runs
  with model (and any fallback), tokens, cost and outcome. Then, from
  Ryan's reaction: spend **by client**; **per interview** (coding + notes
  over the interviews they ran on); and **what each project cost to
  build**, a table of spend by pass with an all-in cost per interview.
  Then, after Ryan's look: the figures as one even strip (spend set like
  the rest); the four breakdowns two across; the cost table tighter, with
  Interviews / Artifacts / Altogether column groups; and the runs moved to
  their own **Runs** view beside the Dashboard, on the shared table engine
  (sort, group, filter, search; each group's heading shows its total).
  `usage_runs()` is migration `20261001b` (Ryan had applied `20261001a`
  before it was added). Owners only for now; project owners later. No
  budget alerts for now.
- **Two-factor rail**: `workspace_setting.mfa_required_for` (empty);
  `current_seat_role`, `has_seat` and `my_memberships` hide everything from
  a session below `aal2` when the caller's role needs it;
  `mfa_required_now()` for the app, which shows a "required" screen. Not
  switchable in the UI until enrollment exists.
- Dates formatted on the server use `NEXT_PUBLIC_TIME_ZONE`
  (default America/New_York): Vercel runs on UTC.

**Next for deployment:** custom SMTP (Supabase + DNS); the Vercel project,
domain and env vars (README → *Deploying*); one Supabase project or two.
**Next for two-factor:** an enrollment screen on Your account (Supabase
`mfa.enroll` / `challenge` / `verify`, TOTP), a verify step after sign-in
when `mfa_required_now()`, then a switch in Settings.

### Choose the model for the AI passes
Raised by Ryan 2026-10-01, for a later release. Every Claude pass — coding,
notes, themes, the memo, deck, process flows and architecture — uses one
model and effort fixed in code (`MODEL = "claude-opus-5-5"`, effort `high`,
`src/lib/claude/call.ts`), with the server-side fallback. Make it a choice
instead.

- Each run already records the model asked for and the one that answered
  (`*_run.model`, `served_by`) and its cost, so switching keeps the record
  straight; `PRICES` in `call.ts` needs an entry for each model offered.
- To decide: who chooses (workspace owners in **Settings**,
  per project, or per run); one model for everything or per pass (a
  cheaper model for coding, the strongest for the memo); whether effort
  is chosen too; which models are on the list (current Claude models, kept
  up to date) and what the fallback does when a chosen model isn't
  available.
- Prompts are versioned (`coding-v2`, `memo-v1`…); a model change may want
  a check that the quote and citation gates still pass at the same rate.

### Active and archived projects
Raised by Ryan 2026-09-30, once the Clients menu existed: it lists every
project, and will get long. Mark a project **archived** (finished work)
so the Clients menu, the home page and pickers show only **active**
projects, with archived ones found some other way (a "Show archived"
toggle on the home page or client page, say).

- `project.state` (`project_state` enum, default `Coding`) already exists
  and nothing reads it; an archived state could live there or in its own
  `archived_at` column. Decide which.
- Archived projects stay readable and their URLs keep working.
- Open questions: can transcripts still be added to an archived project;
  does a client with only archived projects drop out of the menu?

### Mobile-friendly layout
Make the tool usable on a phone. Raised 2026-09-29. Most pages already work
reasonably well; **the chain board and the corpus views are the concern.**

- **Chain board** (`src/components/chain/`): five side-by-side columns with
  minimum widths (Fit needs about 1,330px before it scrolls; Spread is
  wider), and edges measured between them. On a phone that's a sideways
  scroll with little of any column visible. Likely one stage at a time with
  a stage switcher, the selected chain carried from stage to stage instead
  of drawn as edges.
- **Corpus** (`src/components/corpus/`):
  - The theme × interview matrix is a wide grid with angled group labels;
    sideways scroll may be acceptable, but the theme name column should stay
    pinned while the cells scroll.
  - The memo map and chord diagram are SVGs that scale down with the screen,
    so their text gets very small; their side lists sit beside them and
    should stack below instead.
  - The evidence-mix rows need about 650px across (ref, name, bar, label).
  - Tooltips are hover-only, and touch has no hover: needs a tap equivalent
    that doesn't fight with tap-to-select.
  - Check the selection bar and quotes panel at phone width (the panel is
    already `min(480px, 100vw)`).
- The rest of the app mostly works; a pass over the tables on Sources and
  the project's Interviews tab is worth doing alongside.

## From the 2026-09-30 review

Raised by Ryan after Phase 6. Numbered as he raised them; the order to
build them in is under *Suggested order* below.

### R1. Meaningful URLs
*Built 2026-09-30 with R8 (branch `urls-and-nav`) — migration
`20260930f_slugs`. A project is `/clients/<client>/<project>`, each tab
after Interviews a segment named for its label
(`/clients/longwood-foundation/ai-and-automation-opportunity-assessment/process-flows?map=…`);
what a tab keeps (map, template, interview, facet) stays in the query.
`client.slug` and `project.slug` (unique within the client) are set from
the name on insert by a trigger, -2, -3… when taken, and never change with
a rename. Old `/projects/<uuid>?view=…` links, print links included,
redirect permanently. Links are built in one place, `src/lib/urls.ts`.
Each client has a page (`/clients/<client>`): its code and project cards.
Decided with Ryan: URLs under `/clients`, the tab in the path, and a client
page behind each client's name.*
`/projects/443f9438-…?view=swimlanes` becomes something like
`/projects/longwood-foundation/ai-and-automation-opportunity-assessment?view=swimlanes`.

- Needs a stored slug per project (unique within its client) and a client
  slug. Store them rather than derive them from names, so renaming a
  project doesn't break links; keep old UUID links working with a redirect.
- **Decided 2026-09-30:** the client part is the client's *name* slug,
  not its short code. Short codes are optional (R7), so they can't anchor
  a URL.
- Touches every link and route under `/projects/[id]`. The API routes that
  take a project id stay as they are (URLs are for people; APIs can keep
  ids).

### R2. Remove participant name and role from the upload dialog
*Built 2026-09-30 on branch `people` with R4 and R5 — migration
`20260930a_people`. See "The person model" below.*
They duplicate *Who's speaking*, and don't fit interviews that aren't 1:1.

- **Not just a form change.** `transcript.participant` and
  `participant_role` are read by the coding prompt, the deck's quote
  attribution ("— Program officer"), the swimlane and architecture routes,
  the source record editor, and the evidence lists everywhere
  (`participant`). They'd become derived from the speakers marked
  *participant*, with a role (job title) per speaker instead of per
  transcript. The existing `speaker_role` enum (interviewer / participant /
  other) is the speaker's part in the call, not their job, so a job title
  needs its own field.
- Coding prompt input changes, so its version bumps.
- Do with R4 and R5: all three need a *person* behind a speaker.

### R3. Create a client or project from the upload dialog's dropdowns
*Built 2026-09-30 (branch `intake-and-project-tabs`), no migration: the shared client and
project picker (upload dialog, Edit record) offers "New client…" (name and
optional code, then straight on to its first project) and "New project…".*
"New client…" / "New project…" at the foot of each dropdown, created in
place. Small. A new client can take a short code (R7), optionally.

### R4. Remember each person's organization and role
*Built 2026-09-30 (branch `people`).*
When a known person turns up in *Who's speaking*, fill in their most recent
organization and role; both stay editable per transcript.

- Today a speaker exists only per transcript (`transcript_speaker`, keyed
  by transcript and export name), so there is no "person" to remember
  anything about. Needs a workspace-wide `person` (name, current
  organization, current role) and `transcript_speaker.person_id`, matched
  by name on upload and confirmed in the dialog.
- The transcript keeps its own organization and role for that call, so a
  person changing jobs doesn't rewrite old interviews.

### R5. Merge speakers
*Built 2026-09-30 (branch `people`).*
Someone joins by phone, then by computer, and appears as two speakers.

- `display_name` already lets two export names show as one name, but they
  stay two speakers. With R4's `person`, merging is pointing both speakers
  at the same person; views that count or list speakers count people.
- The lines stay immutable: each keeps the name the export wrote.

### The person model (R2 + R4 + R5), as built
Designed with Ryan 2026-09-30: interviewers are people too; the speaker's
part in the call is **Part** and their job is **Title**; there's a People
page; visibility is designed for client access.

- `person` (name; current organization and title) behind each
  `transcript_speaker` (`person_id`, plus `title` as of that call).
  `display_name` follows the person's name (triggers), so every existing
  view shows people without changes.
- Current organization and title follow the person's most recent
  interview whenever a speaker of theirs changes; editable on People.
- Two export names for one person in a call: pick the same person on both
  rows. Duplicate people across interviews: merge on the People page.
- Quotes are attributed by the title of whoever spoke the quoted line
  (`code_speakers()`); swimlanes and architecture get participants' titles
  per interview; coding prompt `coding-v2` lists the people in the call.
- Client access: `can_see_person()` is the one place that decides who sees
  a person (today `has_seat()`).
- The People page uses the shared table engine (`src/components/table/`:
  sort, group and filter from the headers, remembered per browser), the
  same as a project's Interviews table. Organization and title are edited
  in place; clicking a row opens the person in the drawer; ticking two or
  more brings up the selection bar (as on the Corpus page) to merge them.
- **Organization levels** (2026-09-30): the drawer shows a person's
  organization level by level (Organization, then Sub-organization rows),
  with "Show all" to filter the table by any level and sub-organizations
  added in place. The People and Interviews tables and the corpus can
  also group and filter by **top organization** (every office of Delaware
  DOE together).
- **Managing organizations** (migration `20260930b_organizations`): an
  Organizations tab beside People shows the tree with people and
  interview counts (own, and "in all" with sub-organizations). The drawer
  renames, moves (under another organization or to the top level) and
  deletes one nothing uses; ticking two or more merges them, moving their
  people, speakers and sub-organizations to the one kept. All through
  definer functions that log to `edit`; direct updates and deletes of
  organizations are closed.
- **Deep organizations** (migration `20260930c_organization_detail`), for
  structures like the State of Delaware (agencies, departments,
  divisions, units): each organization has an optional **kind** (what the
  layer is) and **short name** (DOE, OEL). Organizations can be created
  directly (New organization; Add a sub-organization in the drawer) or a
  whole hierarchy at once from an indented outline, which reuses what
  exists. Every kind in use becomes a grouping in the People and
  Interviews tables and the corpus (a row counts under its nearest
  organization of that kind). The organization picker is searchable by
  any part of the path, short names and kind. The tree has "Show levels"
  and the drawer's path links to each parent.
- **Later, with project roles:** who may edit people in place (Ryan,
  2026-09-30). Today any editor can.
- **Follow-up:** a migration dropping `transcript.participant` and
  `participant_role` once the backfill is confirmed on real data. Only
  fallbacks still read `participant` (library and evidence lists, for
  transcripts with no participant speaker).

### R6. Rework the upload dialog; new Meet transcripts show up by themselves
*Built 2026-09-30 (branch `intake-and-project-tabs`) — migration `20260930e_drive_inbox`.
The review is wider and in numbered steps (Where it goes, Details, Who's
speaking), with a tighter speakers table, Review/Hide on batch rows, and
the note beside the buttons. Sources shows new Meet transcripts in Drive by
themselves (the newest not imported, not uploaded by hand, not set aside):
tick and "Review and import", or "Not an interview" to set one aside
(brought back from Browse and search Drive). Not built: suggesting a
client from the Drive folder.*
- A design pass on the dialog, best done after R2–R5 change what's in it.
- New Meet transcripts appear on Sources without clicking *Import from
  Google Meet*: a "Waiting in Drive" list of Docs not yet imported, checked
  when Sources loads (no background job needed to start).
- With R7, a Doc's Drive folder can suggest the client.

### R7. Client short codes
*Built 2026-09-30 (branch `intake-and-project-tabs`) — migration `20260930d_client_codes`:
an optional `client.code`, unique ignoring case, shown beside the client's
name (pickers, library, project page) and set or changed in place from the
library. Not in URLs.*
Use the same short codes for clients as Ryan's Google Drive.

- **Decided 2026-09-30: optional.** A quality-of-life aid for matching,
  not core data. Ryan means the codes as a through-line key matching the
  same client across every tool he uses, so they should be exactly what
  he uses elsewhere.
- A nullable `code` column on `client` (unique when set), shown beside
  client names and editable wherever a client is.
- Feeds R6 (matching Drive folders to clients). Not used in URLs (R1).

### R8. Rethink the top navigation
*Built 2026-09-30 with R1 (branch `urls-and-nav`): Sources · Clients ·
People · Templates. Clients opens a menu of every client (to its page) with
its projects under it; Templates opens Note, Memo and Deck templates. Menus
open on click (so they work on touch), close on Escape, a click elsewhere or
navigating. `/study` is gone.*

*Follow-ups (Ryan, 2026-09-30):* "Harrington Tools" no longer links into
the tool; it will link to the suite hub, tools.harringtondata.com, once
that exists (`TOOLS_HOME_URL` in `src/lib/config.ts`, null until then).
"Interview Synthesis" goes to a new **home page** (`/`): every project by
client, as cards showing each process step (coded and noted interviews,
confirmed and to-review themes, memo drafted) and which outputs exist
(Corpus, Process Flows, Architecture, Deck), plus a pointer to anything
in Unassigned. The same cards are on each client's page
(`src/lib/progress.ts`). Sources is now intake only (new Meet transcripts
and Unassigned); its "Clients and projects" list moved to home, and its
"00 ·" eyebrow is gone.
Replace *Study* with **Sources**, **Clients** (a menu of clients, each with
its projects) and **Templates** (Note, Memo and Deck templates directly).

- Removes the placeholder `/study` page.
- Clients menu links use R1's URLs, so build it with or after R1.
- Worth designing with the mobile layout in mind (see *Mobile-friendly
  layout*).

### R9. Separate process from outputs in a project's tabs
*Built 2026-09-30 (branch `intake-and-project-tabs`): `src/components/project/ProjectTabs.tsx`
groups the tabs as Process (Interviews → Themes → Memo, with arrows),
Check (Chain) and Outputs; the current tab is a raised segment. Outputs
reordered (Ryan, 2026-09-30) to Corpus, Process Flows, Architecture, Deck,
with "Swimlanes" renamed **Process Flows** in the tab.*
Process: **Interviews → Themes → Memo → Chain**, shown as steps with arrows.
Outputs: **Deck, Swimlanes, Architecture, Corpus**, set apart.

- The project page's `VIEWS` list and tab bar only. Independent of the
  rest.
- **Decided 2026-09-30:** Chain is not a fourth step. It traces a finding
  back through every step, so it sits beside the arrows as a check on the
  whole process: **Interviews → Themes → Memo**, then Chain set apart.

### R10. Swimlane whitespace
*Fixed 2026-09-30 (branch `intake-and-project-tabs`). The cause (Ryan's screenshots): after
viewing a long map (PF-1, 22 steps) and switching to a shorter one, the
shorter map kept the long map's scroll position and width — its arrow
layer was sized to a measured width, which then held the page that wide —
so it showed blank space on the right. Now each map gets its own swimlane
(switching starts at the beginning) and the arrow layer is sized to the
drawing itself; the architecture diagram had the same pattern and got the
same fix. Also: columns shrink to 140px before a map scrolls, cards are a
little tighter, and lanes with no steps are slim.*
Short process maps leave a wide empty area on the right. Size the grid to
its steps (or spread steps to fill) in `Swimlane.tsx`. Small.

### R11. Favicon
*Done 2026-09-30 (branch `favicon`): Ryan replaced `src/app/favicon.ico`
with the Harrington Data Co icon (16 and 32 px).*
Use the Harrington Data Co website's favicon (`src/app/icon.*` /
`favicon.ico`). Small; needs the file from harringtondata.com.

### R12. Rebuild the Deck
Raised 2026-09-30. Ryan doesn't like how the Deck tab turned out: it's
clunky. Not for now; a later piece of work.

- **Goal:** the deck as a **reveal.js** slide deck with interactions,
  presented and navigated in the browser, instead of today's slide list
  with a .pptx download.
- **Export** to other formats: **Google Slides**, **PowerPoint** and
  **PDF**.
- Today's pieces to build on or replace: slides as `deck_slide` rows
  citing themes and codes (`src/lib/deck/`), the deck template, the
  Claude pass (`deck-v1`), and `src/lib/deck/pptx.ts` (pptxgenjs).
- To work out: what "interactions" means here (e.g. click a finding to see
  its quotes, as the evidence drawer does elsewhere), and whether Google
  Slides export goes through the Drive connection (which is read-only
  today).

## Suggested order

Earlier items are all done. For the 2026-09-30 review (R1–R11):

1. **The person model first: R4 + R5 + R2** (decided 2026-09-30: it's
   foundational, so it goes before anything else). One migration adding
   `person` and a per-speaker role, then moving everything that reads
   `participant` / `participant_role` over to the speakers.
2. **R7 then R3.** One small migration (optional client short code).
3. **R6.** The upload dialog redesign, once 1–2 have settled what's in it.
4. **R1 + R8 together.** *Built 2026-09-30 (branch `urls-and-nav`).* Both
   reshape routes and links; done in one pass, before client access
   (clients will see these URLs).
5. **Quick wins whenever: R11, R10, R9.** *All done 2026-09-30.*
6. Then *Invitation-only access…* (built 2026-09-30, branch `invitations`)
   and *Mobile-friendly layout* above.
