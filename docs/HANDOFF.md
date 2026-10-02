# Handoff — where things stand

Updated end of day 2026-10-01. Read this first, then `docs/BACKLOG.md`
(the suggested order is at its end) and, for older background,
`docs/PLAN.md`.

## Where we are

- **`main` has everything; there are no open branches.** Last commits:
  `28eee22` (settings, identity and access; usage dashboard), then two
  backlog notes. Working tree clean, pushed to
  `Harrington-Data-Co/interview-synthesis-tool`.
- **Database: every migration is applied** in Supabase, through
  `20261001a_settings_and_access` and `20261001b_usage` (checked against
  the live project 2026-10-01). `supabase/schema.sql` describes the whole
  database and loads clean on its own.
- **Supabase settings done:** the sign-up hook is
  `public.hook_require_invitation`; sign-in is email + password. Not yet
  done: custom SMTP, the two email templates (README → *Signing in*), and
  any production addresses.
- **Running locally** at http://localhost:3000 (no base path), against
  the one Supabase project. Ryan signs in with a password.
- **Checks:** lint, `npx tsc --noEmit`, 153 unit tests (`npx vitest run`),
  `npm run build`, and 238 database checks (`scripts/db-checks/`, below)
  all pass. **The newest screens have mostly not been seen signed in by
  Claude** (the Chrome extension wasn't connected); Ryan has looked at
  Settings → Members and Usage.

## Next session, first: working practices (agreed 2026-10-01)

Ryan asked how we compare with best practice; these come before the deploy.
About an hour of Claude's time, each as its own pull request:

1. **CI**: a GitHub Actions workflow running lint, `tsc`, unit tests, the
   database checks (`scripts/db-checks/run.mjs`) and a build on every push
   and pull request; **Dependabot** for dependency alerts.
2. **`CLAUDE.md`**: the standing rules every session should load (the
   *Gotchas learned* and *Standing rules* below, the suite's UI
   conventions, migrations-are-frozen, pull requests not direct merges).
3. **README → "Before going live: security"** checklist: Anthropic spend
   (already capped: Ryan's key runs on prepaid credit with auto-reload
   off, topped up by hand — note it, and decide the balance for client
   work); a separate production Supabase project
   with backups; Supabase's own password minimum (10+) and leaked-password
   protection (the app's 10-character rule is only in its own form);
   two-factor for owners soon after launch; data retention and the
   Anthropic account's terms for client material.
4. **From now on: pull requests** instead of Claude merging into `main`;
   `/code-review` on anything sizable, `/security-review` on anything
   touching access, data or money; and screens seen working signed in
   before UI work counts as done (connect the Chrome extension, or add a
   local test account and a few browser tests).

Small fix to fold in: when that prepaid credit runs out, Anthropic answers
400 ("credit balance is too low"), and `src/lib/claude/respond.ts` shows
"Claude returned an error (400). Try again." — trying again won't help.
Recognize it and say the credit needs topping up (and show it on the
failed run in Usage).

Known: `npm audit` reports 2 high-severity issues in `pptxgenjs` (via
`image-size`; denial-of-service in image parsing, low real risk here). The
Deck rebuild is likely to replace that library.

## Then: go live at tools.harringtondata.com

Decided 2026-10-01: the Harrington Tools **hub** is the domain's root and
this tool lives at **/interview-synthesis**; one shared sign-in, roles per
tool; hosted on **Vercel**. Until a hub exists the root redirects to the
tool (`next.config.ts`), so **a landing page is not needed to go live**
(Claude's recommendation; see the backlog note on the hub).

Steps (README → *Deploying to tools.harringtondata.com* has the detail):

1. **Custom SMTP** — the one real blocker before inviting clients. Needs
   from Ryan: where harringtondata.com's DNS is hosted, and which provider
   (Resend, Postmark, Amazon SES, SendGrid). README → *Before adding
   teammates*.
2. **Decide: one Supabase project or two.** Sharing today's is simplest
   (local work then touches live data); a separate production project is
   `schema.sql` + *First-time setup*.
3. **Vercel project**: import the repo; environment variables from
   `.env.local.example`, with `SITE_URL=https://tools.harringtondata.com`
   and `NEXT_PUBLIC_BASE_PATH=/interview-synthesis`, and the same
   `CONNECTOR_TOKEN_KEY` as local if the database is shared. Check the
   plan allows 300-second functions (the Claude passes declare it).
4. **Domain**: add `tools.harringtondata.com` in Vercel; add its CNAME at
   the DNS host.
5. **Register production addresses**: Supabase Site URL and Redirect URLs;
   Google OAuth redirect URI. **Settings → Setup** on the live site lists
   the exact ones.
6. **Email templates** (optional but recommended): Invite user and Reset
   password pointed at `/auth/confirm` (README → *Signing in*).
7. **Smoke test**: sign in; Settings → Setup all green; invite a second
   address as a client; run one coding pass; check Usage records it.

## Then: Ryan's priority order (2026-10-01)

1. Rebuild the Deck (R12: reveal.js in the browser; export to Google
   Slides, PowerPoint, PDF).
2. Client view (deliverables without the read-only editing chrome).
3. Architecture and maps (undo for edits; crowded maps).
4. The flaky corpus check.
5. Active and archived projects.
6. Mobile-friendly views.
7. Model selection for the AI passes.
8. Two-factor sign-in (screens only; the database rail is built).
9. Project owners see their own project's usage.

Each has a section in `docs/BACKLOG.md`.

## What was built 2026-09-30 → 2026-10-01

- **Invitation-only access and project roles** (migration `20260930g`):
  everyone sees only their projects (workspace owners see all); project
  roles owner / editor / viewer / client; clients see deliverables and the
  quotes they cite, by title (or everything read-only, if an owner
  allows); invite from Settings → Members or a project's Members tab.
- **Email and password sign-in** instead of magic links; invite and reset
  links land on `/auth/confirm` (a click before the link is spent, against
  email scanners), then `/account/password`.
- **Your account** (`/account`): profile (name also on the shared
  sign-in), password, sign out of other devices, your access.
- **Settings** (account menu, owners): **Members** (last sign-in; add
  people to projects in place; invitation lifetime), **Usage**, **Access
  log**, **Setup** (deployment check).
- **Usage** (`/settings/usage`): spend figures; spend per day/week; by
  client, project, person and pass; *What each project cost to build*
  (column groups Interviews / Artifacts / Altogether); a **drawer** on
  anything clicked; a **Runs** view on the shared table engine.
- **Deployment groundwork**: base path, security headers, server dates in
  `NEXT_PUBLIC_TIME_ZONE` (default America/New_York), README guide.

## Decisions from 2026-10-01 (don't re-ask)

- Access is **per project for everyone**; workspace owners see all.
  Workspace owners and project owners invite. Invitations last 14 days by
  default (Settings → Members). Clients default to **deliverables only**.
- **Email + password**, not magic links.
- **Suite layout**: hub at tools.harringtondata.com, each tool at a path;
  shared identity, roles per tool; Vercel.
- **Settings live under the account menu**, not the header.
- **Usage is owners-only** for now; no budget alerts.
- **UI language for the whole suite** (also saved to Claude's memory):
  tables sort/group/filter from their headers on the shared engine;
  clicking something opens the shared side drawer; the same brand styles.
- **Two-factor**: later, but the rails are built
  (`workspace_setting.mfa_required_for`, empty).

## Gotchas learned

- **Server → client boundary.** A server component can only hand plain
  data to a client component: not functions (Usage's `hrefFor` crashed),
  and not values imported from a `"use client"` file (the role lists
  crashed the Members tab; they now live in `members/roles.ts`).
- **Spacing tokens** are `--space-1/2/3/4/6/8`; there is no `--space-5`
  (cards lost their padding). Older code writes `var(--space-5, 20px)`.
- **Base path.** `Link`, `router.push` and `redirect()` add
  `/interview-synthesis` themselves; plain `fetch()`, `<a href>`,
  `window.location` and form actions must go through `withBase()`
  (`src/lib/basePath.ts`).
- **Migrations Ryan has applied are frozen**: add to a new file (as
  `20261001b` did) rather than editing one he's run.

## How access, settings and usage are put together

- **Reads**: every table's `<table>_read` policy asks which projects the
  reader belongs to (`my_projects()`, `my_full_projects()`,
  `my_transcripts()`; clients' quotes through `my_evidence_codes()`).
- **Writes**: the definer functions keep a coarse `can_edit()`; one
  `aaa_guard_project` trigger per project table checks the row's project
  (`guard_project_write()`), so no writing function needs its own check.
  Cross-project workspace operations (merging people or organizations)
  call `begin_workspace_op()`.
- **Two-factor rail**: `current_seat_role()`, `has_seat()` and
  `my_memberships()` also ask `mfa_satisfied()`; `mfa_required_now()`
  tells the app, which shows a "required" screen.
- **Access log**: triggers on `invitation`, `seat` and `project_member`
  write `access_event`.
- **Usage**: `usage_runs()` unions the six `*_run` tables (owners only);
  `src/lib/usage.ts` does the sums (tested); the page is
  `src/app/(app)/settings/usage/page.tsx`, its drawer
  `src/components/usage/UsageDrawer.tsx`.
- **App side**: `src/lib/seat.ts` (`currentSeat` accepts invitations on
  first sign-in; `projectAccess` per project), `src/lib/invite.ts`
  (emails and copyable links), `src/lib/supabase/admin.ts` (service role,
  invitations only), `src/components/members/`.

## Decisions from 2026-09-30 (don't re-ask)

- **Client short codes are optional**, a through-line key Ryan uses to
  match clients across all his tools. Never required; **URLs use the
  client's name**, not the code.
- **Chain is not a process step.** Project tabs read Interviews → Themes →
  Memo, with Chain set apart as a check on the whole process; outputs
  (Deck, Swimlanes, Architecture, Corpus) are separate.
- **Interviewers are people too.** A speaker's part in the call is
  **Part** (interviewer / participant / other); their job is **Title**.
- **Design for client access**: who may see a person goes through
  `can_see_person()`; permissions for inline editing come with project
  roles.
- **Organizations nest arbitrarily deep** (State of Delaware › Department
  › Division › Unit), each with an optional **kind** and **short name**.
- Tables share one engine (`src/components/table/`); drawers share one
  frame (`src/components/Drawer.tsx`); selections share one pill
  (`src/components/SelectionBar.tsx`). Keep new tables, drawers and
  selections on these.

## How people and organizations are put together

- **person** (name; current organization and title) behind each
  `transcript_speaker` (`person_id`, plus `title` as of that call; the
  speaker's organization is also as of that call). `display_name` follows
  the person's name by trigger, so older views show people without
  changes. Current organization/title follow the person's latest interview
  whenever a speaker of theirs changes.
- **Who's speaking** (`SpeakersEditor` in `src/components/pickers.tsx`):
  As written, Person (typed; matches known people, else a new person),
  Part, Organization, Title. The upload preview pre-fills from the last
  time an export name was seen or a known person's name. Two export names
  for one person: pick the same person on both rows.
- **People page** (`/people`, `src/components/people/`): shared table
  engine with columns Name (+ possible-duplicate section), Organization
  (+ top organization + one section per kind), Title, Part, Clients,
  Interviews, Latest; inline organization and title; row click opens the
  drawer (Information, Projects); merge from the selection pill.
  `/people?person=<id>` opens a drawer.
- **Organizations page** (`/organizations`): the tree (Show levels,
  search by name, short name, kind), drawer to rename, set short name and
  kind, move ("Sits under"), add a sub-organization, delete when unused;
  merge from the pill; New organization; Add from outline (indented lines,
  `(SHORT)` and `[Kind]`, reuses what exists).
- **Grouping by kind**: `kindColumns()` (`src/components/table/`) adds a
  column per kind in use to the People and Interviews tables; the corpus
  gets a facet per kind.
- **Quote attribution** is by the title of whoever spoke the quoted line
  (`code_speakers()`); swimlanes and architecture use participants'
  titles per interview.
- Database rules: `supabase/migrations/20260930a–c`; all writes to people
  and organizations go through definer functions that log to `edit`.

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
  `/api/memos/[id]/markdown`, `/clients/<client>/<project>/memo/print`): paragraphs are
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

`scripts/db-checks/` loads `supabase/schema.sql` into an in-memory Postgres
(PGlite, with Supabase's auth stubbed) and runs 238 checks: who sees and
changes what (`access.mjs`), every writing path for a partner editor
(`writing-paths.mjs`), and settings, the two-factor rail, the access log
and usage (`settings.mjs`). Once: `npm install --no-save
@electric-sql/pglite`; then `node scripts/db-checks/run.mjs`. Add checks
there when the database changes. Unit tests:
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
