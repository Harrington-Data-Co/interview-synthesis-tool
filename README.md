# Interview Synthesis

Transcripts to coded notes to client deliverables, for Harrington Data Co.

Every finding keeps its source line: a transcript is ingested once and never
altered, and everything built on top of it — codes, interview notes, themes, the
client deliverable — traces back to the line someone actually said it on.

The design comes from the Claude Design prototype *Transcript to discovery
system*, kept at `reference/Discovery Workspace.dc.html`. That file is the
specification; when a view here needs building, read the corresponding section
of the prototype first.

## Running it

Node 22 and npm are required. If `node` is not on your PATH, this repo was set
up against a user-local install at `~/.local/node/current/bin`, which
`~/.zshrc` adds for you — open a new terminal.

```sh
npm install
cp .env.local.example .env.local   # then fill it in, see below
npm run dev                        # http://localhost:3000
```

Without `.env.local` the app still runs and tells you what is missing, so you
can see the sign-in screen before there is a database.

## First-time setup

1. **Create a Supabase project** at supabase.com. Any region; the free tier is
   fine for now.
2. **Copy the keys.** In the project's Settings → API, take the project URL and
   the `anon` public key into `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Take the `service_role` key into
   `SUPABASE_SERVICE_ROLE_KEY` — it is server-only and must never reach the
   browser.
3. **Allow the magic-link redirect.** In Authentication → URL Configuration,
   set the Site URL to `http://localhost:3000` and add
   `http://localhost:3000/auth/callback` to the Redirect URLs.
4. **Apply the schema.** Paste `supabase/schema.sql` into the Supabase SQL
   editor and run it. It creates every table, the append-only trigger on
   `transcript_line`, and the row-level security policies. Every policy keys
   on a seat row, not on being signed in: the domain check lives only in the
   sign-in form, and anyone can create a Supabase account against the Auth API
   directly.
5. **Give yourself a seat.** Sign in once at `/sign-in` with your
   `@harringtondata.com` address to create the auth user, then insert the
   matching seat:

   ```sql
   insert into seat (user_id, name, initials, email, role, title)
   select id, 'Your Name', 'YN', email, 'owner', 'Lead researcher'
   from auth.users where email = 'you@harringtondata.com';
   ```

   Authentication and membership are deliberately separate: a valid sign-in with
   no seat row gets told it has no seat, not let in. This first seat has to be
   inserted from the SQL editor; after that, only owners can add seats.
6. **Check the access rules.** In the SQL editor, run as a single statement
   (the editor only shows the last result, so keep the checks in one row):

   ```sql
   begin;
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<user id>","role":"authenticated"}';
   select auth.uid() as uid, has_seat(),
          (select count(*) from seat) as seats;
   rollback;
   ```

   With your own id from `auth.users`, `has_seat` is true and `seats` counts
   every seat. With a made-up id such as
   `00000000-0000-0000-0000-000000000000`, `has_seat` is false and `seats` is 0.
7. **Add your Anthropic key** to `ANTHROPIC_API_KEY`. Needed from phase 2 on.

## Updating an existing database

`supabase/schema.sql` always describes the whole current database, so a new
project only ever runs that. A database built from an earlier version runs the
files in `supabase/migrations/` that came after it, oldest first, in the SQL
editor. Each file says which version it starts from.

## Layout

```
src/app/sign-in/        the door
src/app/auth/callback/  magic-link landing
src/app/(app)/          everything behind the seat check
  sources/              stage 00 — the transcript library
  templates/            note templates, product templates, label axes
  study/                stages 01–04
src/lib/supabase/       browser, server and session-refresh clients
src/lib/seat.ts         who is signed in, and what they may change
supabase/schema.sql     the data model
reference/              the Claude Design prototype, as specification
```

`src/app/globals.css` is the Harrington brand stylesheet, ported unchanged from
the prototype's `harrington/tools.css`. Add to it; don't restyle it.

## Build phases

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold, brand, auth, seats, app shell | **done** |
| 1 | Upload and parse transcripts; the transcript view | next |
| 2 | Coding — Claude first pass, then the human layer | |
| 3 | Interview notes from templates | |
| 4 | Themes and the findings memo | |
| 5 | The chain board and corpus views | |
| 6 | Connectors, remaining product shapes, multi-tenancy | |

The full plan is at `docs/PLAN.md`.
