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
3. **Allow the sign-in redirects.** In Authentication → URL Configuration,
   set the Site URL to `http://localhost:3000` and add
   `http://localhost:3000/auth/callback` and
   `http://localhost:3000/auth/confirm` (where invitation links land) to the
   Redirect URLs.
4. **Apply the schema.** Paste `supabase/schema.sql` into the Supabase SQL
   editor and run it. It creates every table, the append-only trigger on
   `transcript_line`, and the row-level security policies. Every policy keys
   on a seat row, not on being signed in, and every row's author must be the
   person writing it.
5. **Only invited people can sign up.** In Authentication → Hooks, add a
   *Before User Created* hook of type Postgres and choose
   `public.hook_require_invitation`. Supabase then refuses to create an
   account for any address without an open invitation (or a seat), whatever
   its domain — without it, anyone holding the public anon key can create an
   (empty, seatless) account straight against the Auth API. Leave the
   project's own sign-ups switched on: the hook is what decides, and invited
   people can still set a password from *Forgot your password?* on
   `/sign-in` if the email goes astray.
   On a brand-new project, turn this on *after* step 6: your own first
   sign-in has no invitation to let it through.
6. **Give yourself a seat.** Sign in once at `/sign-in` with your
   own address to create the auth user, then insert the
   matching seat:

   ```sql
   insert into seat (user_id, name, initials, email, role, title)
   select id, 'Your Name', 'YN', email, 'owner', 'Lead researcher'
   from auth.users where email = 'you@harringtondata.com';
   ```

   Authentication and membership are deliberately separate: a valid sign-in with
   no seat row gets told it has no invitation, not let in. This first seat has
   to be inserted from the SQL editor; after that, everyone comes in by
   invitation — see *Who can get in* below.
7. **Check the access rules.** In the SQL editor, run as a single statement
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
8. **Add your Anthropic key** to `ANTHROPIC_API_KEY`. Needed from phase 2 on.

## Who can get in

Only invited people, whatever their email address. Decided 2026-09-30;
the rules live in migration `20260930g_invitations.sql`.

- **Everyone sees only the projects they're on.** A workspace owner sees
  and manages every project without being on it.
- **Project roles**: *owner* (also manages members and invitations),
  *editor*, *viewer*, *client*. A client sees the memo, deck, process flows
  and architecture, the confirmed themes, and the quotes those cite —
  attributed by title, never by name — and no transcripts, notes or people.
  A project owner can switch one client to *everything, read-only*.
- **Workspace roles** (owner, editor, viewer) are for Harrington's own
  people. They add Sources, People, Organizations and the template library;
  an editor can also start clients and projects (and owns what they start).
  Someone from outside has no workspace role.
- **Inviting**: workspace owners from **Members** in the header (Harrington
  colleagues, with a workspace role); project owners from a project's
  **Members** tab (anyone, to that project). An address that already has a
  seat is added at once; anyone else gets an email whose link lands on
  `/auth/confirm` and is accepted on arrival. Invitations last 14 days and
  can be sent again, withdrawn, or handed over as a link (**Copy link**).
- **Removing**: from a project's Members tab, or from the workspace on
  Members (every project at once). What they made stays, under their name.

Invitation emails need `SUPABASE_SERVICE_ROLE_KEY` (server only), and go
through Supabase's sender until the next section is done — a few emails an
hour, from a Supabase address. **Copy link** works without either. Set
`SITE_URL` to the deployed address once there is one, so links in emails
point there rather than at whichever host sent them.

### Signing in: email and password

Decided 2026-10-01 (magic links weren't working well): people sign in with
their email and a password. An invitation's link (emailed, or from **Copy
link**) lands on `/auth/confirm`, which asks for a click before using it —
so an email scanner that opens every link can't spend it — and then on
`/account/password` to choose one. **Forgot your password?** on the sign-in
page sends a link to the same place; use it once yourself if you signed up
before passwords. The account menu has **Change password**.

Supabase's default emails spend their link the moment anything opens it.
To get the click-first protection for emailed links too, in Authentication
→ Emails → Templates point both of these at `/auth/confirm` instead of
`{{ .ConfirmationURL }}`:

- *Invite user*: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/account/password`
- *Reset password*: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/account/password`

### Your account, settings and the access log

- **Your account** (account menu): name, initials and title — the name
  also goes on the shared Harrington Tools account — your password,
  *Sign out of other devices*, and what you can get at.
- **Workspace settings** (owners, account menu): how long invitations last;
  two-factor sign-in; and *This server*, a check of how this deployment is
  set up.
- **Members** shows when each person last signed in and an **Activity**
  log: every invitation, acceptance, role change and removal, written by
  the database itself (migration `20261001a`). A project's owners see their
  project's on its Members tab.
- **Two-factor sign-in** has its rail in place but is off: the database can
  require it per role (`workspace_setting.mfa_required_for`) and then shows
  nothing to a session without it. What's left is the screen to set up an
  authenticator app (Supabase MFA, TOTP); until then it isn't switchable,
  since it would lock those people out.

## Before adding teammates: your own email sender

Sign-in is by emailed link, and Supabase's built-in sender is only meant for
testing: it sends a handful of emails an hour, from a Supabase address. Before
anyone else relies on signing in, send from Harrington's own domain:

1. **Pick a transactional email provider** (Resend, Postmark, Amazon SES and
   SendGrid all work) and add `harringtondata.com` as a sending domain there.
2. **Add the DNS records it gives you** (SPF, DKIM, and usually a return-path
   or DMARC record) wherever the domain's DNS is hosted, and wait for the
   provider to show the domain as verified.
3. **Point Supabase at it.** Authentication → SMTP Settings → enable custom
   SMTP, then enter the provider's host, port, username and password, a
   sender address such as `tools@harringtondata.com`, and a sender name such
   as *Harrington Tools*.
4. **Raise the email rate limit** under Authentication → Rate Limits; the
   default assumes the built-in sender.
5. **Test it**: sign out, request a link, and check it arrives from the new
   address and isn't in spam.

## Connecting Google Meet

Meet saves each transcript as a Google Doc in the organizer's Google Drive.
The app reads them from there, read-only. Set this up once, signed in to
Google with your Workspace (harringtondata.com) account:

1. In the [Google Cloud console](https://console.cloud.google.com), create a
   project (for example *Interview Synthesis*) under the harringtondata.com
   organization.
2. **APIs & Services → Library**: enable the **Google Drive API**.
3. **Google Auth Platform → Get started** (the OAuth consent screen): app
   name, support email, audience **Internal**.
4. **Data Access**: add the scope
   `https://www.googleapis.com/auth/drive.readonly`.
5. **Clients → Create client**, type **Web application**, with the
   authorized redirect URI
   `http://localhost:3000/api/connectors/google/callback` (add the deployed
   URL's `/api/connectors/google/callback` too when there is one).
6. Add to `.env.local`: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from
   the client, and `CONNECTOR_TOKEN_KEY` (32 random bytes, base64:
   `openssl rand -base64 32`), which encrypts the stored refresh token.
   Changing that key disconnects everyone.
7. Apply migration `20260929e_google_connector.sql`, restart the dev
   server, and use **Connect Google Drive** on the Sources page.

## Deploying to tools.harringtondata.com

Decided 2026-10-01: **tools.harringtondata.com** is the Harrington Tools
hub, and each tool lives at a path under it — this one at
**/interview-synthesis**. Every tool shares one sign-in (one Supabase Auth
project, one cookie for the domain); each keeps its own members and roles.
Hosted on **Vercel**. Until the hub exists, the domain's root redirects
here (`next.config.ts`).

1. **Apply the migrations** the database doesn't have yet (see *Updating an
   existing database*), and check the sign-up hook is on.
2. **Create the Vercel project.** vercel.com → Add New → Project → import
   `Harrington-Data-Co/interview-synthesis-tool`. Framework: Next.js;
   everything else as it comes. Every push to `main` then deploys, and
   every branch gets a preview address.
3. **Environment variables** (Project → Settings → Environment Variables,
   for Production), the same names as `.env.local.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY` — from Supabase.
   - `ANTHROPIC_API_KEY`.
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `CONNECTOR_TOKEN_KEY`
     — **the same value as your `.env.local`** while both use one
     database, or Drive connections made locally stop working.
   - `SITE_URL` = `https://tools.harringtondata.com`
   - `NEXT_PUBLIC_BASE_PATH` = `/interview-synthesis`
   - `NEXT_PUBLIC_TIME_ZONE` only if not `America/New_York`.

   `NEXT_PUBLIC_*` values are built into the app, so redeploy after
   changing one.
4. **Long requests.** The Claude passes declare up to 300 seconds
   (`maxDuration` on their routes). Check the Vercel plan allows functions
   that long (Settings → Functions); a pass cut off at a lower limit fails
   with a timeout, and its run shows as failed.
5. **The domain.** Project → Settings → Domains → add
   `tools.harringtondata.com`. Vercel shows a CNAME record (usually
   `cname.vercel-dns.com`); add it wherever harringtondata.com's DNS is
   hosted, and wait for Vercel to show it as valid. HTTPS is automatic.
6. **Supabase → Authentication → URL Configuration.**
   - Site URL: `https://tools.harringtondata.com/interview-synthesis`
   - Redirect URLs: add `https://tools.harringtondata.com/interview-synthesis/auth/confirm`
     and `…/auth/callback`; keep the localhost ones for local work.

   The email templates (*Signing in*, above) use `{{ .SiteURL }}`, so they
   follow.
7. **Google Cloud → the OAuth client → Authorized redirect URIs**: add
   `https://tools.harringtondata.com/interview-synthesis/api/connectors/google/callback`.
8. **Email from Harrington's domain** — the next section. Before inviting
   anyone outside.
9. **Check it.** Sign in at `https://tools.harringtondata.com`, open
   **Workspace settings** from the account menu: *This server* lists
   what's set and what isn't, and the addresses to register.

**One database or two?** Local work and production can share one Supabase
project (simplest while you're the only one using it: everything you do
locally is real), or production can have its own (run `schema.sql` on a
new project, set it up as in *First-time setup*, and give Vercel its keys).
Moving to two later is a fresh project plus copying the data across.

**When the hub exists**, it takes over the domain in its own Vercel
project and forwards `/interview-synthesis/*` to this one with a rewrite;
this app doesn't change, since it already lives under its path. Its
redirect from the root (`next.config.ts`) then goes.

To try the path locally, set `NEXT_PUBLIC_BASE_PATH=/interview-synthesis`
in `.env.local`, restart, and use http://localhost:3000/interview-synthesis
(registering the localhost addresses with that path too).

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
  sources/              the library: Unassigned queue, clients and projects
  projects/[id]/        a project's interviews, labels and organizations;
                        ?view=themes is stage 04, its themes;
                        ?view=memo is the findings memo; memo/print prints it
  transcripts/[id]/     stage 01 — one transcript and its source record;
                        ?stage=coding is stage 02, its codes;
                        ?stage=notes is stage 03, its interview notes
  templates/            note and memo templates: the library and project copies
  study/                stages 02–04
src/app/api/            ingest, projects, labels, organizations, transcripts
src/lib/parsers/        Teams/Zoom .vtt, .srt, Google Meet .docx, pasted text
src/lib/ingest/         upload preview and save
src/lib/claude/         the shared Claude call: model, structured output, cost, errors
src/lib/coding/         the coding pass: prompt, quote check, chunking
src/lib/notes/          note generation: prompt, citation check, starter templates
src/lib/themes/         theme proposals: prompt, gate, project evidence
src/lib/memo/           the findings memo: prompt, citation gate, loader, Markdown export
src/lib/supabase/       browser, server and session-refresh clients
src/lib/seat.ts         who is signed in, and what they may see and change
src/lib/invite.ts       invitation emails and copyable links
src/app/(app)/members/  the workspace's people, invitations and activity (owners)
src/app/(app)/account/  your account; settings/ the workspace's (owners)
src/lib/basePath.ts     the path the app sits under (/interview-synthesis)
supabase/schema.sql     the data model; migrations/ updates an existing one
docs/                   the build plan, backlog, and session handoff
fixtures/private/       real transcripts for local checks — never committed
reference/              the Claude Design prototype, as specification
```

`src/app/globals.css` is the Harrington brand stylesheet, ported unchanged from
the prototype's `harrington/tools.css`. Add to it; don't restyle it.

## Build phases

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold, brand, auth, seats, app shell | **done** |
| 1 | Upload and parse transcripts; the transcript view; projects, organizations, labels | **done** |
| 2 | Coding — Claude first pass, then the human layer | **done** (prompt `coding-v1`) |
| 3 | Interview notes from templates | **done** (prompt `note-v2`) |
| 4 | Themes and the findings memo | **done** (prompts `themes-v1`, `memo-v1`) |
| 5 | The chain board and corpus views | **done** (migration `20260929d`) |
| 6 | Google Meet import, swimlanes, decks, architecture (client access moved to the backlog) | **done** (prompts `flow-v1`, `deck-v1`, `arch-v1`) |

The full plan is at `docs/PLAN.md`; follow-ups are in `docs/BACKLOG.md`.
