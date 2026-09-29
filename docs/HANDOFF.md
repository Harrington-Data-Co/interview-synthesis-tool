# Handoff — where things stand

Updated 2026-09-29, end of session. Read this first, then `docs/PLAN.md`.

## State

- **Branch `phase-4-themes`**, pushed, **not merged into `main`**. Ryan wants
  to hold off on merging; ask before merging.
- `main` holds Phases 0–3 (last merge at `121d568`).
- **Phase 4 (themes and the findings memo) is built and tested by Ryan**:
  migration `supabase/migrations/20260929c_themes_memo.sql` has been applied
  to his Supabase, and themes, the memo, Markdown export and print all
  worked end to end.
- Prompts in use: `coding-v1`, `note-v2`, `themes-v1`, `memo-v1`. Model
  `claude-opus-5-5`, effort `high` (`src/lib/claude/call.ts`).

## Likely next steps

1. Merge `phase-4-themes` into `main` when Ryan says so, and mark Phase 4
   **done** in the README's phase table (it currently says "built, in
   testing").
2. Any Phase 4 follow-ups Ryan raises after using it more.
3. Phase 5 — the chain board and corpus views (saturation, code × interview
   matrix, coverage by label). See `docs/PLAN.md`.
4. Open items in `docs/BACKLOG.md`, including the invitation model with
   project roles (why the sign-up hook was deliberately left off) and soft
   locks.

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
