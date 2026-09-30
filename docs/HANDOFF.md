# Handoff — where things stand

Updated 2026-09-30, after Phase 6 merged. Read this first, then
`docs/PLAN.md` and `docs/BACKLOG.md`.

## State

- `main` holds Phases 0–6 (Phase 6 squash-merged 2026-09-30). All
  migrations through `20260929h_architecture` are applied.
- **Google Drive is connected** (Ryan's harringtondata.com account,
  read-only scope). Meet transcripts live across his drives, mostly the
  shared drive, not in "Meet Recordings".
- Since the overnight session: one evidence drawer
  (`src/components/evidence/EvidenceDrawer.tsx`) now serves the corpus,
  memo (paragraph or theme tag), interview notes (item) and themes page
  (theme card; the source ledger and inline quote list are gone). Action
  buttons say "Draw"/"Write", not "… with Claude".
- Prompts: `coding-v1`, `note-v2`, `themes-v1`, `memo-v1`, `flow-v1`,
  `deck-v1`, `arch-v1`. Model `claude-opus-5-5`, effort `high`.
- Deliberate gaps: architecture edits have no undo; big architecture maps
  are crowded (see backlog).

## Likely next steps

1. **The person model** (backlog R2 + R4 + R5), decided 2026-09-30 to come
   before everything else. A proposal went to Ryan on 2026-09-30; build once
   he's answered its open questions.
2. Then the backlog's *Suggested order*: optional client short codes and
   "new client/project" in the upload dialog, the upload dialog redesign,
   meaningful URLs with the new top navigation, and the quick wins.
3. Try Swimlanes, Deck and Architecture on a real project; none has been
   clicked through signed in yet.

## How Phase 6 is put together

- **Google connection** (`src/lib/connectors/google.ts`,
  `/api/connectors/google/{start,callback}`, `connector_account`): per-user
  OAuth, `drive.readonly`, offline access. The refresh token is sealed with
  AES-256-GCM under `CONNECTOR_TOKEN_KEY` before it's stored; RLS lets a
  user see only their own row. Sources page shows the connection.
- **Meet import** (`src/lib/connectors/{meet,names}.ts`,
  `/api/connectors/google/meet[/file]`, `MeetImport.tsx`): lists Meet
  transcript Docs across all drives (Gemini notes excluded), newest first;
  search is Drive full-text and is sorted in the app, since Drive refuses
  `orderBy` with full-text. Picked Docs are exported as .docx and handed to
  the usual `UploadDialog` review; `connector_import` records Drive file →
  transcript so imported Docs show as such.
- **Swimlanes** (`src/lib/flow/`, `src/components/flow/`): Claude draws
  process maps (`flow`, lanes, ordered steps of kind task/wait/decision)
  from Step, Tool, Stakeholder, Pain and Constraint codes; every step cites
  codes. People can add, edit, move and delete lanes and steps, and undo
  the last step edit.
- **Deck** (`src/lib/deck/`, `src/components/deck/`): deck templates are
  `product_template` kind `deck`; Claude writes `deck_slide` rows per
  section (finding, quote or statement layouts, ≤6 bullets), citing themes
  and codes under the memo's rules; a quote slide's quote must be a cited
  code. Rewrite keeps slides people edited. `/api/projects/[id]/deck/pptx`
  builds the .pptx with pptxgenjs (`src/lib/deck/pptx.ts`).
- **Architecture** (`src/lib/arch/`, `src/components/arch/`): Claude draws
  `arch_map`s of systems (`arch_node`: kind, official or workaround),
  flows between them (`arch_flow`: what moves, by hand or automatic) and
  gaps (`arch_gap`), each citing codes. Items that fail the checks land in
  `arch_rejection` ("Needs review"). `layers()` places systems in columns
  by longest path so data reads left to right (cycles broken);
  `ArchDiagram` measures the cards and draws flows as SVG. Picking a system
  lights its flows; picking a gap lights everything sharing its codes.
  All writes go through `save_arch_item` / `delete_arch_item`.

## How Phase 5 is put together

- **Themes are the cross-interview unit.** A code belongs to one transcript,
  so the matrix is theme × interview and saturation counts new themes per
  interview (recording order, keys I1… as on the Themes tab). Confirmed
  themes by default; `?proposed=1` includes proposals, marked as such.
- `corpus_matrix(project, include_proposed)` (SQL) does the counting: one row
  per theme per interview, plus null-theme rows for codes in no counted
  theme. Active codes only; a merged code never counts.
- `src/lib/corpus/derive.ts`: grouping columns by a facet (each label axis,
  then the participant's organization), theme rows, saturation and its note,
  coverage by group (≤2 interviews is "thin"), and the "only <group>" flag
  for a theme whose support sits inside one labelled group.
- `src/lib/corpus/chain.ts`: `reach()` (forward and backward separately, as
  the prototype's `chain()`), and `foldLines()`, which keeps quoted lines
  plus the line before each run and folds the rest.
- **Corpus tab** (`src/components/corpus/`): a server component; the facet and
  the proposals toggle are URL parameters. The matrix itself is a client
  component (`ThemeMatrix`): group names are set at an angle over a coloured
  bar per group, with a ruled gap between groups; a Groups column beside Ivs says
  "Only ‹group›" or "n of m groups"; proposed themes have a dashed ref; a
  theme's name expands in place (with its description), growing only that
  row while the cells keep their size.
- **Corpus views on trial** (for Ryan to judge; each is its own file). All
  share one quotes panel and data through `CorpusContext` (`openPanel` with
  themes, optionally narrowed to interviews or code types); shared pieces
  (expandable theme name, dashed proposed ref, hover tooltip) are in
  `bits.tsx`. (1) Matrix cells open their quotes; (2) "Share of group"
  switch on the matrix; (3) `MemoMap`: themes plotted by interviews (x) and
  groups reached (y; codes when ungrouped), filled = cited, with the strong
  corner and the "rests on little" edges shaded and a "needs a look" list
  beside it; (4) `ThemeChord`: chord diagram, ribbon ends sized by each
  theme's codes in the shared interviews (`chordMatrix` / `chordLayout`),
  with a "most shared" list; (5) `EvidenceMixView`: sortable by kind or
  total, Codes/Share scale, segment hover detail, segment click opens those
  quotes. Rules in `src/lib/corpus/views.ts`, tested.
- **One selection across the corpus charts** (`CorpusContext`: `selected`,
  `toggleSelect`, `select`): a theme, or a pair from a chord. Clicking a theme
  name (matrix, evidence mix), a memo-map dot or list row, or a chord arc
  selects it everywhere; a chord ribbon selects the pair. It stays until
  clicked again, cleared from the bar at the foot of the window, or Escape
  (which closes the quotes panel first). Cells and segments select their
  theme and open their quotes.
- **Themes are listed by number in every corpus chart** (`compareRefs`:
  TH-2 before TH-12). `themeRows()` keeps the order it's given. A click anywhere in
  a matrix or evidence-mix row toggles the selection; only the name cell
  expands (and selects); filled cells and segments open quotes instead. The
  matrix has a Codes column (a theme's codes across every interview).
- **Click-off clears the selection.** `CorpusContext` listens for clicks that
  land on nothing interactive; chart elements that handle their own clicks
  carry `KEEP` (`data-keep-selection`). Buttons, links and form controls
  (sort and mode switches) keep it too.
- **Every number and mark has a hover tooltip** saying what it means
  (`useTip` / `TipBody` in client charts, `HoverTip` for the server-rendered
  cards).
- **Memo map regions are filters**: clicking Strong, In between or Rests on
  little lists that region's themes beside the chart and fades the rest.
- **Chart colours come from `src/lib/palette.ts`** (Ryan's palette:
  `#127A5B #3B6DB3 #C27A22 #8B5AA0 #C0503A`, grey `#8A8F94` for Other; use it
  wherever a chart needs more colours). `muted()` there desaturates series
  out of focus, as the evidence mix does when sorted by a group.
- **Chain tab** (`src/components/chain/`): `ChainStage` loads one interview
  (`?interview=`, `?note=` for the note template, `?memo=` for the memo
  template) and resolves citations of merged codes to the code they were
  merged into. `ChainBoard` measures the rendered cards (`data-node`) with a
  ResizeObserver and draws the edges as SVG. Edges: line → code, code → note
  item, code → theme, theme → paragraph, code → paragraph. Memo paragraphs
  that cite nothing from the interview are hidden and counted.
- Board layout: five column cards (navy header bands), each scrolling on its
  own inside a board of fixed height; edges are re-measured on every column
  scroll, and an edge whose card is scrolled out of view is pinned to that
  column's edge and dashed. Picking a node scrolls every other column to its
  part of the chain (centred if it fits, else first card near the top).
  **Fit** shares the page width (minimum column widths, then scroll);
  **Spread** uses fixed wide columns and scrolls sideways, with stage chips,
  edge fades and arrow buttons as scroll cues. The choice is kept in
  localStorage (`chain-density`). Full screen mode; Esc leaves. The chain tab
  lifts the page's 1400px cap. Edges between neighbouring columns draw over
  the cards; edges that skip a column draw behind them.

## How Phase 4 is put together

- **Themes** (`src/lib/themes/`, `src/components/themes/`,
  `/api/projects/[id]/themes[/propose]`): per project. Claude proposes;
  proposals count only once a person confirms them. Re-proposing replaces
  unconfirmed proposals and keeps confirmed themes and any theme a memo cites.
- **Memo templates** share the Templates page with note templates
  (`/templates?kind=memo`); `/api/templates` takes `kind: "note" | "memo"`.
  Tables: `product_template` (kind `report`) and `product_section`.
- **The memo** (`src/lib/memo/`, `src/components/memo/`,
  `/api/projects/[id]/memo`, `/api/memos/[id]/items`,
  `/api/memos/[id]/markdown`, `/projects/[id]/memo/print`): paragraphs are
  `product_item` rows citing themes and/or codes. Claude is held to stricter
  rules than people (confirmed themes only; themes only in sections that fill
  from themes; codes of the section's types or within a cited theme). The
  app's gate mirrors the database; the database has the final word.
- `src/lib/memo/load.ts` is the one loader for the view, the Markdown export
  and the print page.

## Patterns every Claude pass follows

A `*_run` table (model, tokens, cost, outcome); a `*_rejection` review queue
("Needs review"); an app-side gate that mirrors the database's rules;
definer functions for all writes, with direct writes closed by RLS; edits
logged to `edit` with before/after and revertible; deferred triggers that
require at least one citation; evidence that can't be deleted while cited.
Section keys go to Claude as `S1..Sn` through a zod enum, with a forgiving
gate — this fixed the Sierra note bug in Phase 3.

## Checking the database

Database behaviour was checked with a PGlite harness (`check*.mjs`) that
lived in a session scratchpad and is **not** in the repo. To re-check, load
`supabase/schema.sql` into PGlite (with `auth.uid()` stubbed) and exercise
the functions, or ask Ryan to test against Supabase. Unit tests:
`npx vitest run`. Before handing over: `npx tsc --noEmit`, `npx eslint src`,
`npm run build`.

## Standing rules

- Never commit `fixtures/private/*` (real client transcripts) or
  `.env.local`; never print secrets.
- Ask before spending money on Claude runs.
- Commit, push or merge only when Ryan asks.
- New migrations go in `supabase/migrations/`, and `supabase/schema.sql` is
  kept as the whole current database. Ryan applies migrations himself in the
  Supabase SQL editor.
