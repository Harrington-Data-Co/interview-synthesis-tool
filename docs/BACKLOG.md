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
- Organization and project chosen once for the batch, overridable per row.
- Save commits each file independently through the existing ingest route; one
  failure doesn't block the rest, and the result lists what landed.

### 2. "Save and add another"
After saving, offer to add the next transcript without leaving the dialog.

- A second button beside *Save transcript*. Keeps the organization and project
  just used; clears the file and per-file details.
- Mostly subsumed by bulk upload, but still useful for one-at-a-time pasting
  from Wispr Flow, where there are no files to multi-select.

### 3. Separate Organization and Project dropdowns
In the add-transcript dialog, choose the organization first; the project list
shows only that organization's projects.

- The database calls the organization `client`. Decide whether the UI says
  "Organization" everywhere (library, project view, New project dialog) —
  one term throughout, whichever it is.
- Same pair of dropdowns wherever a transcript is assigned (library, source
  record editing in item 4, bulk upload in item 1).

### 4. Edit the source record after upload
The transcript lines stay immutable; the metadata around them doesn't.
Editable: participant name, date recorded, organization, project, speaker
names, and speaker roles.

- **Speaker names need care.** `transcript_line.speaker` is part of the
  immutable record and keeps the name exactly as the export wrote it ("Jen :)").
  Editing a name therefore means a display name on `transcript_speaker`, not a
  change to the lines: add `display_name`, show it everywhere, keep the
  original visible on the transcript page. This also lets two export names map
  to one person ("Jen :)" and "Jennifer Koester" → Jennifer Koester).
- Every change writes an `edit` + `activity` row, so the record shows who
  changed what — the same attribution the coding layer will use.
- Changing organization/project reuses the assignment rules (`new` ↔ `queued`).

### 5. Project view, and a library organized by it
Click into a project to see its transcripts; the library becomes a queue of
unassigned transcripts, with everything else living under its organization
and project.

- Library: an *Unassigned* queue (status `new`) first, then organizations →
  projects, each with a transcript count.
- Project page (`/projects/[id]`): its transcripts, participants, status mix,
  and later the Study stages (codes, notes, themes) for that project. This is
  the natural home for the plan's `study/[projectId]` view.
- Depends on item 3's naming decision.

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

1. **Item 3, then 4.** Naming and the organization → project picker first,
   since editing (4) reuses it; then source-record editing, which needs one
   small migration (`transcript_speaker.display_name`).
2. **Item 5.** The project view, built on 3's naming. Labels slot in here.
3. **Item 2**, a small change to the existing dialog.
4. **Item 1**, the largest; it reuses 2 and 3.
