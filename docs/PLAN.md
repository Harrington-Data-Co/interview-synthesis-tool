# Interview Synthesis — from Claude Design prototype to a working product

## Context

`Discovery Workspace.dc.html` in the Claude Design project *Transcript to discovery system* is a complete, convincing demonstration of a five-stage research pipeline — source → transcript → code → interview note → client product — with every derivation traceable back to a line of transcript. It is also entirely static. All 25 data structures live in `discovery-data.js` as hardcoded fixtures: one interview has a transcript, codes are pre-baked, connectors render state but nothing connects, and the four products are hand-authored previews.

The prototype is the specification. This plan builds the real thing, MVP first: **manual transcript upload, then work the four stages downstream of it.** Connectors, the other three product shapes, and multi-tenancy are deliberately deferred behind seams laid in from day one.

Target: a Next.js + TypeScript app on Postgres (Supabase), calling Claude Opus 5.5 for the coding and synthesis passes, deployed behind `tools.harringtondata.com`.

## What exists today (read, not guessed)

| File | What it is | Fate |
|---|---|---|
| `Discovery Workspace.dc.html` | 2,001 lines — ~1,109 of `<x-dc>` template markup, then a `class Component extends DCLogic` of ~865 lines | **The spec.** Port view by view. |
| `discovery-data.js` | `window.DISCOVERY` — 25 static structures | **The schema, in disguise.** Becomes the DB model + dev seed. |
| `harrington/tools.css` | Brand tokens + component layer (`.btn`, `.card`, `.tag`, `.input`, `.seg`, `.table`, `.dialog`) | **Port verbatim.** Zero redesign work. |
| `support.js` | Generated dc-runtime — a React-backed interpreter for `sc-if`/`sc-for`/`{{ }}` | Discard. Its `DCLogic` is `React.Component`, so the logic translates directly. |

The prototype's `renderVals()` is the single most valuable artifact here: it is an explicit, exhaustive list of every derived value each view needs. Port it section by section rather than re-deriving the UI from scratch.

## Architecture

- **Next.js 15 (App Router) + TypeScript.** Server components for reads, route handlers for the Claude calls and ingest.
- **Styling: `tools.css` as `app/globals.css`, unchanged.** Components use its existing class names exactly as the prototype does. No Tailwind — the token system already exists and is the brand.
- **Supabase**: Postgres, Auth (email restricted to `@harringtondata.com`, matching `doSignIn()`), Storage for uploaded files.
- **Claude**: `@anthropic-ai/sdk`, model `claude-opus-5-5`, `thinking: {type: "adaptive"}`, streaming with `.finalMessage()`, structured outputs via `output_config.format`. Server-side only.
  - Set `output_config.effort` explicitly (`high` for coding and synthesis): Opus 5.5 defaults to `medium`.
  - Thinking cannot be disabled on Opus 5.5, and forced `tool_choice` (`any`/`tool`) returns a 400. Neither matters here: structured outputs carry every response shape.
  - Always check `stop_reason` for `refusal` before reading content.

## Data model

Derived directly from `discovery-data.js`. The provenance chain the prototype *draws* becomes foreign keys the database *enforces*.

```
client            id, name
project           id, client_id, name, state
seat              user_id, role (owner|editor|viewer), title

transcript        id, project_id?, title, participant, participant_role,
                  source, storage_path, sha256, duration_mins, recorded_on,
                  ingested_at, ingested_by, status (new|queued|coded)
transcript_line   id, transcript_id, n, speaker, text          -- IMMUTABLE

label_axis        id, project_id, key, name                     -- FACETS
label_option      id, axis_id, value
transcript_label  transcript_id, axis_id, option_id             -- IV_LABELS

code              id, transcript_id, line_start, line_end, type, label,
                  verbatim, note, created_by, created_at, merged_into_id?
                  -- (transcript_id, line_start|line_end) → transcript_line (transcript_id, n)

note_template     id, project_id?, name, scope                  -- ART_TEMPLATES
note_section      id, template_id, ordinal, name, requires[], note
note              id, transcript_id, template_id
note_item         id, note_id, section_id, ordinal, text        -- ARTIFACT.items
note_item_code    note_item_id, code_id                         -- the refs[] array

theme             id, project_id, title
theme_code        theme_id, code_id                             -- gives codes/ivs counts free

product_template  id, project_id?, name, kind (deck|report|arch|flow), scope
product_section   id, template_id, ordinal, name, requires[], note
product           id, project_id, template_id, rendered_at, content jsonb

edit              object_type, object_id, text, by, at, reverted  -- SEED_EDITS
lock              object_type, object_id, by, acquired_at         -- LOCKS
activity          project_id, actor, verb, object, at             -- ACTIVITY
```

**Two invariants worth enforcing in the database, not the app:**

1. `transcript_line` is append-only — revoke `UPDATE`/`DELETE`. This is what backs the prototype's "Transcripts are immutable" refusal (`tryEditRaw()`), and it is the reason a `sha256` is worth storing at all.
2. Every mutable row carries a `created_by` / owning user id. The prototype's own comment calls this out — it is the seam that makes a later multi-tenant move a migration rather than a rewrite.

## Build order

### Phase 0 — Scaffold
`git init` (the working directory is currently empty and untracked), Next.js + TS, `tools.css` in place, Supabase project, auth gate with the `@harringtondata.com` restriction, seats and roles, and the app shell: header, client/project pickers, `Sources | Templates | Study` nav. Port the markup from `Discovery Workspace.dc.html` lines 26–177 and 1040–1110 (auth screen, header, notice and members dialogs).

### Phase 1 — Ingest + Transcript (stages 00–01)
- Upload `.vtt` / `.srt` / `.txt` / `.docx` to Storage; compute and store `sha256`.
- Parsers normalize to `(n, speaker, text)`. VTT/SRT are cue-block parses; `.docx` via `mammoth`.
- **Source priority**, from how interviews are actually recorded: Google Meet (meetings Ryan owns; transcript Doc exported as `.docx`) and Wispr Flow (meetings he doesn't own) first. Zoom and Teams arrive only occasionally, as files a client sends, and never as a direct connection. Add `wispr` to the `transcript_src` enum.
- **One line per speaker turn.** Consecutive cues from the same speaker merge into one line, keeping the first cue's start and the last cue's end. The stored file keeps the original cue boundaries, and its `sha256` proves it is unaltered.
- Real client exports live in `fixtures/private/` (gitignored) for checking parsers against real formats. Committed tests use synthetic fixtures only.
- **Layouts actually seen:** Teams `.vtt` (`<v Name>` voice tags, utterances split across numbered cues); Google Meet "Notes by Gemini" `.docx` (Gemini's AI notes, then a `📖 Transcript` section with bold speaker names and a time marker about every minute); Google Meet "Transcript" `.docx` (Attendees list, then plain `Name: text`); Wispr Flow (plain `Name: text` lines, no times). **Only transcript sections are ingested** — Gemini and Wispr summaries are a machine's account of what was said, not a record of it.
- **Wispr Flow has no file export.** Upload offers a "paste transcript" box; pasted text is stored as a `.txt` file with its own `sha256`, exactly like an upload. A direct Wispr connection waits for Phase 6 and a Wispr API the app itself can call.
- **`transcript_speaker`** (transcript, name as written, role: interviewer / participant / other), set at upload with one dropdown per speaker. The same person appears under different names across exports ("Jennifer Koester", "Jen :)"), and Phase 2 must know which turns are the participant's. The lines themselves are never rewritten.
- **Filename guesses** pre-fill the upload form: Meet names give participant and date, Teams names give the participant only. All editable.
- Row lands in the library as `new`; assigning it to a project moves it to `queued`.
- Transcript view: numbered read-only lines, source record panel (file, hash, ingested, by), and the immutability refusal on an edit attempt.
- Label axes and bulk labelling (prototype: `mutateSchema`, `applyBulkLabel`).

**Exit criterion:** a real Google Meet transcript from a real call becomes a real, immutable, addressable transcript.

### Phase 2 — Coding (stage 02) — *highest risk, budget accordingly*
- **First pass:** one Claude call per transcript. Input is the numbered lines plus the project's code-type vocabulary (`Pain | Step | Tool | Goal | Constraint | Question`). Structured output returns `{line_start, line_end, type, label, verbatim, note}[]`. A single-line code has `line_start = line_end`.
- **The anti-hallucination gate:** reject any returned code whose `verbatim` is not a literal substring of its line range (lines joined with single spaces), or whose range is wider than the quote (the quote must touch both the first and last line). This single check is what makes every downstream claim in the tool trustworthy — without it the provenance chain is decorative. Flag rejects for human review rather than silently dropping them.
- Long transcripts chunk by line range with overlap. Never truncate.
- **Human layer:** create, rename, retype, re-anchor (including widening or narrowing the range), merge, split, delete. Each writes `edit` + `activity` rows. Soft locks per `lockOn()`.
- Bidirectional line ↔ code selection, type filters, the scroll-settle behaviour (`revealPair`, `settle`).

Cost is not a constraint here: a 40-minute transcript is roughly 10k input tokens; a coding pass runs about **$0.10–0.20 per transcript** on Opus 5.5 ($4 / $20 per MTok).

**Decisions (2026-09-29):**
- **Vocabulary:** Claude proposes the six types above. `Quote` and `Stakeholder` stay in the enum for hand-made codes only.
- **Claude's codes land accepted**, marked `origin = 'claude'`, and are edited from there. Only gate rejections wait for review, in `code_rejection`.
- **Anchoring is a hybrid:** Claude codes participant turns only ("other" speakers count as participants); interviewer turns are context it may not quote. People can code any speaker's turns. The database enforces both.
- **The quote check lives in the database** — a trigger on `code` — not only in the app, so every path that writes a code is held to it: the pass, the human layer, anything later.
- **Soft locks are deferred** until teammates join; one editor doesn't need them.
- **No fixture eval:** `discovery-data.js` (the prototype's hand-coded Dana Reyes interview) isn't in the repo. Prompt quality is judged on real transcripts in `fixtures/private/`, with runs approved before they spend.

### Phase 3 — Artifact (stage 03)
- Template defines sections and which code types fill each.
- Second Claude call: given one transcript's codes and the template's section schema, produce note items, each citing code ids. **Reject any item whose refs are not real code ids for that transcript** — same discipline as Phase 2.
- Coverage check (codes used / total, orphan list) as a SQL query, not a client computation.
- Human edits with attribution, revert, and locks.

**Decisions (2026-09-29):**
- **Templates are a library plus project copies.** Library templates have no project. Adding one to a project copies it (sections and all) into the project, which then edits its copy freely; the library and other projects never change. A copy remembers what it was copied from.
- **Several notes per interview**, one per template, from any of its project's templates. Unassigned interviews can't have notes until they're in a project.
- **Section code types limit Claude, not people** — the anchoring hybrid again. Claude's items may only cite codes of their section's types (a section with no types accepts any); people may cite any code anywhere.
- **Every item cites at least one code of its own interview**, enforced by the database at commit. A citation of a merged code is refused; cite the code it was merged into.
- **Notes are a rearrangement, not a rewrite:** items restate what their codes say, organised by the template, and add no new claims.
- **Evidence can't be deleted from under a note:** removing a section that has items is refused (it used to cascade), as is deleting a template that notes use.
- **Coverage is a database function**, not a client computation: every active code of the interview, and whether the note uses it (directly, or through a code merged into it).
- **Locks stay deferred**, as in Phase 2.

### Phase 4 — Themes + the findings memo (stage 04)
- Themes cluster codes across the project. Claude proposes clusters; a human confirms. `theme_code` rows yield the `codes · ivs` weights for free.
- **Ship the findings memo first.** Of the four product shapes it carries the most value and the least bespoke rendering. Export to Markdown and PDF.
- Deck, current-state architecture, and swimlane follow in Phase 6.

**Decisions (2026-09-29):**
- **Themes are per project** (the open question below, closed). Cross-project patterns can come later as a client-level view.
- **Themes cluster codes**, not note items: codes are the evidence, note items are already summaries. Interviews are keyed I1, I2… in the prompt, since code refs repeat across interviews.
- **Claude's themes count only once confirmed.** They land as proposals; a person confirms each (or edits, merges, splits, deletes it). The memo is written from confirmed themes only. Regenerating replaces unconfirmed proposals and leaves confirmed themes alone.
- **The memo is template-driven now**, not in Phase 6: product templates follow note templates exactly — a library plus project copies, sections with guidance and what they fill from. A memo section can fill from *Themes* (cite confirmed themes) or from code types (cite those codes).
- **Memo paragraphs are rows, not a blob**: each cites at least one theme or code of its project, enforced by the database, edited and reverted like note items. A theme or code a memo cites can't be deleted.
- **PDF is a print-ready page** (Print → Save as PDF); Markdown is a direct download, with citations as footnotes.

**As built:**
- Migration `20260929c_themes_memo.sql`. Themes: `theme_run`, `theme_rejection`, proposed/confirmed status, and definer functions for create, update, confirm, merge, split, delete and revert. Memo: `product_run`, `product_item` with theme and code citations, `product_item_rejection`, and the same function set as note items plus `set_product_title`.
- **Claude's memo paragraphs are held to more than people's:** confirmed themes only, themes only in sections that fill from themes, and codes only of the section's types or members of a cited theme. People may cite any theme or code in the project. The app's gate mirrors the rules; the database has the final word.
- **An unknown citation rejects the whole paragraph** (unlike themes, where unknown codes are trimmed): the wording may rest on it.
- Coverage for the memo is confirmed themes cited; the left-out ones are the check.

### Phase 5 — The chain board and corpus views
Saturation, the code × interview matrix, and coverage-by-label are pure derivations of tables that now hold real data — mostly SQL plus the SVG edge-drawing already written in `measure()` / `edges()` / `chain()`. Cheap at this point, and the most persuasive thing in the product.

*Decided 2026-09-29:* a code belongs to one transcript, so the thing that recurs across interviews is the **theme**. The matrix is theme × interview (cell = that interview's codes in the theme), with a foot row of codes in no theme; saturation counts new themes per interview in recording order. Confirmed themes by default, with a toggle to include proposals. The counting lives in `corpus_matrix()`; grouping, saturation and coverage are pure functions in `src/lib/corpus/`. The chain board is per interview and ends in memo paragraphs (themes → paragraph, and codes → paragraph for direct citations); theme edges come from codes, not from the note.

### Phase 6 — Deferred
Connectors and the remaining product shapes (deck, current-state architecture, swimlane), with `.pptx` export. *Rescoped 2026-09-29:* multi-tenant client access moved to the backlog, to be designed with invitation-only access and project roles. Connectors follow where Ryan's transcripts actually come from: Google Meet (as Google Docs in Drive) first and best; Zoom and Teams stay file uploads, not integrations.

*Decided 2026-09-29:* connectors are **Google Meet only** (transcripts read from Google Drive, where Meet saves them as Google Docs); Wispr Flow stays paste-in, Zoom and Teams stay file uploads, and the Otter connector is dropped. The deck is built in the app (slides citing themes and codes, like the memo) with a `.pptx` download. Build order: **swimlane**, then deck, then current-state architecture, then the Meet connector.

## Files to create (representative)

```
app/globals.css                     ← harrington/tools.css, verbatim
app/(auth)/sign-in/page.tsx
app/sources/page.tsx                ← library + connectors
app/templates/page.tsx
app/study/[projectId]/page.tsx      ← chain | stages | corpus
app/api/ingest/route.ts
app/api/code/[transcriptId]/route.ts
app/api/note/[transcriptId]/route.ts
app/api/themes/[projectId]/route.ts
lib/parsers/{vtt,srt,docx}.ts
lib/claude/{client,coding,note,themes}.ts
lib/db/schema.sql
lib/db/seed.ts                      ← discovery-data.js as dev fixture + test corpus
components/…                        ← ported view by view from the .dc.html
```

## Verification

- **Parsers:** unit tests over real `.vtt` and `.srt` fixtures, including multi-line cues and speaker-prefixed text.
- **Immutability:** a test that attempts `UPDATE transcript_line` and asserts the database refuses it.
- **Line ranges:** the database rejects a code with `line_start > line_end` or with either end pointing at a line outside its transcript.
- **Coding fidelity:** run the pass over Dana Reyes's transcript (already in `discovery-data.js`) and assert every returned `verbatim` is a literal substring of its cited line range, and that no range is wider than its quote. Then compare the output against the 16 hand-written codes in the fixture — not for equality, but as a quality read. Worth turning into a small eval before Phase 2 prompt iteration begins.
- **Provenance:** an integration test that follows one code from `transcript_line` → `code` → `note_item` → `theme` → `product` and asserts every hop resolves.
- **End to end:** upload a real interview recording's transcript, code it, generate the note, cluster themes, render the memo, and read the result. The tool is working when that memo is something you would actually send.

## Open decisions (not blocking Phase 0)

*Resolved:* codes attach to an inclusive line range (`line_start`, `line_end`); a single-line code is a range of one.


- ~~Whether themes are per-project or can span projects for a client.~~ Per project (2026-09-29).
- Whether the note template's `requires` is advisory or enforced at generation time.
