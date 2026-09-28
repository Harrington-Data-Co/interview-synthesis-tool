# Backlog

Improvements queued after Phase 1's exit test passed (2026-09-28). Each item
notes what it touches, so it can be picked up without re-deriving the design.
Order is not priority — see *Suggested order* at the end.

## From the Phase 1 review

### 1. Bulk upload
Add several files at once instead of one per dialog.

- Pick many files → one review table, a row per file: parsed layout, turns,
  pre-filled title / participant / date, and any duplicate flagged and skipped.
- Speaker roles still need a human, so each row expands to its speakers table.
  Defaults (first-name guesses) apply to rows nobody opens.
- Client and project chosen once for the batch, overridable per row.
- Save commits each file independently through the existing ingest route; one
  failure doesn't block the rest, and the result lists what landed.

### 2. "Save and add another"
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

- **Labels** (Phase 1 step 6): label axes per project and bulk labelling.
  Fits naturally into the project view (item 5).
- **Verify** button: re-hash the stored original and compare to `sha256`.
- **Wispr Flow paste**: test with a real transcript once one is copied out.
- **Attribution on inserts**: policies check the caller can edit, not that
  `created_by` is them. Ingest already sets it server-side; tighten the rest.
- **Block outside sign-ups**: Supabase "before user created" hook rejecting
  non-`@harringtondata.com` addresses. Before going live.
- **Custom SMTP**: before adding teammates (Supabase's built-in mailer is
  rate-limited).
- **Lint**: unused `redirect` import in `src/app/(app)/layout.tsx`.

## Suggested order

1. **Items 3, 3a, then 4.** The client → project picker and organizations
   first, since editing (4) reuses both; then source-record editing. One
   migration covers it: `organization`, and `display_name` +
   `organization_id` on `transcript_speaker`.
2. **Item 5.** The project view. Labels slot in here.
3. **Item 2**, a small change to the existing dialog.
4. **Item 1**, the largest; it reuses 2 and 3.
