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

## Suggested order

1. **Items 3, 3a, then 4.** The client → project picker and organizations
   first, since editing (4) reuses both; then source-record editing. One
   migration covers it: `organization`, and `display_name` +
   `organization_id` on `transcript_speaker`.
2. **Item 5.** The project view. Labels slot in here.
3. **Item 2**, a small change to the existing dialog.
4. **Item 1**, the largest; it reuses 2 and 3.
