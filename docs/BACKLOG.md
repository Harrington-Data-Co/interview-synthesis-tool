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
Only invited people can use the tool, whatever their email domain, so clients
and partners can be let in too. Not yet designed; considered 2026-09-28.
Multi-tenant client access (clients seeing their own projects) moved here
from Phase 6 on 2026-09-29, to be designed alongside this.

- **Accounts by invitation only**: turn off public sign-ups in Supabase and
  invite from the app (server-side, via Supabase's invite API). This replaces
  the sign-up hook and the `@harringtondata.com` check in the sign-in form
  (`ALLOWED_EMAIL_DOMAIN`, `src/lib/config.ts`).
- **An invitation creates the seat**, perhaps pending until first sign-in;
  authentication still isn't membership.
- **Project roles**: a `project_member` (project, person, role) table, and
  read policies that check project membership instead of just `has_seat()` —
  the seam `schema.sql` was built to leave.
- **Open questions**: who can invite (workspace owners, project owners?);
  which roles exist per project (owner / editor / viewer / client?); what a
  client may see (their project's raw transcripts, or only deliverables?);
  who sees workspace-wide things (the Unassigned queue, the organization
  list); whether invitations expire.

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
- **Not built yet: managing organizations** — renaming, moving under a
  different parent, merging or deleting one. Today they're only created.
- **Later, with project roles:** who may edit people in place (Ryan,
  2026-09-30). Today any editor can.
- **Follow-up:** a migration dropping `transcript.participant` and
  `participant_role` once the backfill is confirmed on real data. Only
  fallbacks still read `participant` (library and evidence lists, for
  transcripts with no participant speaker).

### R6. Rework the upload dialog; new Meet transcripts show up by themselves
- A design pass on the dialog, best done after R2–R5 change what's in it.
- New Meet transcripts appear on Sources without clicking *Import from
  Google Meet*: a "Waiting in Drive" list of Docs not yet imported, checked
  when Sources loads (no background job needed to start).
- With R7, a Doc's Drive folder can suggest the client.

### R7. Client short codes
Use the same short codes for clients as Ryan's Google Drive.

- **Decided 2026-09-30: optional.** A quality-of-life aid for matching,
  not core data. Ryan means the codes as a through-line key matching the
  same client across every tool he uses, so they should be exactly what
  he uses elsewhere.
- A nullable `code` column on `client` (unique when set), shown beside
  client names and editable wherever a client is.
- Feeds R6 (matching Drive folders to clients). Not used in URLs (R1).

### R8. Rethink the top navigation
Replace *Study* with **Sources**, **Clients** (a menu of clients, each with
its projects) and **Templates** (Note, Memo and Deck templates directly).

- Removes the placeholder `/study` page.
- Clients menu links use R1's URLs, so build it with or after R1.
- Worth designing with the mobile layout in mind (see *Mobile-friendly
  layout*).

### R9. Separate process from outputs in a project's tabs
Process: **Interviews → Themes → Memo → Chain**, shown as steps with arrows.
Outputs: **Deck, Swimlanes, Architecture, Corpus**, set apart.

- The project page's `VIEWS` list and tab bar only. Independent of the
  rest.
- **Decided 2026-09-30:** Chain is not a fourth step. It traces a finding
  back through every step, so it sits beside the arrows as a check on the
  whole process: **Interviews → Themes → Memo**, then Chain set apart.

### R10. Swimlane whitespace
Short process maps leave a wide empty area on the right. Size the grid to
its steps (or spread steps to fill) in `Swimlane.tsx`. Small.

### R11. Favicon
Use the Harrington Data Co website's favicon (`src/app/icon.*` /
`favicon.ico`). Small; needs the file from harringtondata.com.

## Suggested order

Earlier items are all done. For the 2026-09-30 review (R1–R11):

1. **The person model first: R4 + R5 + R2** (decided 2026-09-30: it's
   foundational, so it goes before anything else). One migration adding
   `person` and a per-speaker role, then moving everything that reads
   `participant` / `participant_role` over to the speakers.
2. **R7 then R3.** One small migration (optional client short code).
3. **R6.** The upload dialog redesign, once 1–2 have settled what's in it.
4. **R1 + R8 together.** Both reshape routes and links; do them in one
   pass, before client access (clients will see these URLs).
5. **Quick wins whenever: R11, R10, R9.**
6. Then *Invitation-only access…* and *Mobile-friendly layout* above.
