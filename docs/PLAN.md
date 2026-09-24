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
- Row lands in the library as `new`; assigning it to a project moves it to `queued`.
- Transcript view: numbered read-only lines, source record panel (file, hash, ingested, by), and the immutability refusal on an edit attempt.
- Label axes and bulk labelling (prototype: `mutateSchema`, `applyBulkLabel`).

**Exit criterion:** a real `.vtt` from a real call becomes a real, immutable, addressable transcript.

### Phase 2 — Coding (stage 02) — *highest risk, budget accordingly*
- **First pass:** one Claude call per transcript. Input is the numbered lines plus the project's code-type vocabulary (`Pain | Step | Tool | Goal | Constraint | Question`). Structured output returns `{line_start, line_end, type, label, verbatim, note}[]`. A single-line code has `line_start = line_end`.
- **The anti-hallucination gate:** reject any returned code whose `verbatim` is not a literal substring of its line range (lines joined with single spaces), or whose range is wider than the quote (the quote must touch both the first and last line). This single check is what makes every downstream claim in the tool trustworthy — without it the provenance chain is decorative. Flag rejects for human review rather than silently dropping them.
- Long transcripts chunk by line range with overlap. Never truncate.
- **Human layer:** create, rename, retype, re-anchor (including widening or narrowing the range), merge, split, delete. Each writes `edit` + `activity` rows. Soft locks per `lockOn()`.
- Bidirectional line ↔ code selection, type filters, the scroll-settle behaviour (`revealPair`, `settle`).

Cost is not a constraint here: a 40-minute transcript is roughly 10k input tokens; a coding pass runs about **$0.10–0.20 per transcript** on Opus 5.5 ($4 / $20 per MTok).

### Phase 3 — Artifact (stage 03)
- Template defines sections and which code types fill each.
- Second Claude call: given one transcript's codes and the template's section schema, produce note items, each citing code ids. **Reject any item whose refs are not real code ids for that transcript** — same discipline as Phase 2.
- Coverage check (codes used / total, orphan list) as a SQL query, not a client computation.
- Human edits with attribution, revert, and locks.

### Phase 4 — Themes + the findings memo (stage 04)
- Themes cluster codes across the project. Claude proposes clusters; a human confirms. `theme_code` rows yield the `codes · ivs` weights for free.
- **Ship the findings memo first.** Of the four product shapes it carries the most value and the least bespoke rendering. Export to Markdown and PDF.
- Deck, current-state architecture, and swimlane follow in Phase 6.

### Phase 5 — The chain board and corpus views
Saturation, the code × interview matrix, and coverage-by-label are pure derivations of tables that now hold real data — mostly SQL plus the SVG edge-drawing already written in `measure()` / `edges()` / `chain()`. Cheap at this point, and the most persuasive thing in the product.

### Phase 6 — Deferred
Meet / Zoom / Otter connectors (the `source` column and connector table exist from Phase 1, so this is an insert path, not a migration), remaining product shapes, `.pptx` export, multi-tenant client access.

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


- Whether themes are per-project or can span projects for a client.
- Whether the note template's `requires` is advisory or enforced at generation time.
