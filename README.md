# Locked In

A squad-based workout tracker my friends actually installed.

Training alone is easy to skip, so the accountability is built in. Locked In is
part workout log, part social feed: you post a session, your squad sees it, and
the leaderboard keeps everyone honest. Shipped as a real Android APK through EAS
Build, with a web version on Vercel from the same source.

Around 5,000 lines of TypeScript across twelve modules — feed, profile, posting,
search, inbox, chat, notifications, auth — on Expo SDK 54 and Supabase.

---

## The parts worth reading

**One screenshot logs a session.** Manual entry is where a fitness app dies, so
the primary path is a photograph. Upload the summary screen from Strava, Apple
Fitness or Samsung Health and Gemini vision returns activity, distance,
duration, pace and calories as structured fields. The image posts as-is; the
stats land in the database behind it. `CreatePost.tsx`

**The database sends the notifications, not the app.** A Postgres trigger calls
the Expo Push Service through `pg_net`, so a like or a comment notifies whether
or not anyone has the app open. Notifications are aggregated on the way out —
"and 3 others liked your workout" is one row, not four. `notificationsApi.ts`

**Web push is deliberately not implemented.** It is fragile enough on iOS Safari
that shipping it would have meant supporting something that quietly fails for
half the squad. The web build gets everything else.

**Points reward the effort a minute actually costs**, which is the only way a
gym session and a 10k can sit in the same table: running 13/km, swim 7/100m,
competitive football 1.1/min, badminton 0.95, padel 0.85, gym 0.75. The week
resets at 00:00 UTC — worth saying out loud to a squad spread across four time
zones, because that is Monday 10am in Melbourne and Sunday 8pm in Toronto.

**Twelve activities, each with its own form.** A run asks for distance and pace,
a gym session asks for duration and a focus. Picking the activity changes which
fields are required, because a swim measured in minutes is not a swim.

**Stories with read receipts.** A session posts as a story that expires. Your
own gets a viewer list instead of a comment box — the thing that makes skipping
a week uncomfortable.

---

## Stack

| | |
|---|---|
| Frontend | Expo SDK 54, React Native 0.81, react-native-web |
| Backend | Supabase — Postgres, Auth, Storage, Realtime, row-level security |
| AI | Gemini vision, for screenshot extraction |
| Push | Expo Push Service, called from Postgres via `pg_net` |
| Android | EAS Build → APK |
| Web | Vercel, auto-deploying on push to `master` |

---

## Running it yourself

There is no APK to download. Every build inlines the credentials of whoever
built it — including a billable Gemini key, as
[Known limits](#known-limits) explains — so the only sane way to hand this over
is the source plus your own keys.

You will need [Node.js](https://nodejs.org) 18 or newer, a free
[Supabase](https://supabase.com) account, and a
[Google AI Studio](https://aistudio.google.com/apikey) key for the screenshot
extraction.

### 1. Get the code

```bash
git clone https://github.com/TusharLachman25/Locked-In.git
cd Locked-In
npm install
```

### 2. Create a Supabase project

Sign in to Supabase, click **New project**, set a name, a database password and
your nearest region. Provisioning takes a minute or two; the free tier is
enough for a squad.

### 3. Apply the schema

Open **SQL Editor** in your new project, paste in the whole of
[`supabase/schema.sql`](supabase/schema.sql), and run it. That is 12 tables,
their foreign keys and indexes, 12 functions, the 6 triggers that fire push
through `pg_net`, row-level security with 36 policies, and the three tables that
belong to the `supabase_realtime` publication.

It is ordered to run top to bottom in one go: tables first, then foreign keys as
separate `alter table` statements so that the alphabetical order tables happen
to be created in cannot matter, then functions before the triggers that call
them, then the policies.

The file is generated rather than hand-written —
[`scripts/dump-schema.mjs`](scripts/dump-schema.mjs) reads the live project
through the Supabase Management API and asks Postgres itself for the definitions
via `pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_triggerdef` and
`pg_get_functiondef`. To regenerate it against your own project:

```bash
node scripts/dump-schema.mjs <token-file> <project-ref> > supabase/schema.sql
```

It has been replayed into an empty database rather than eyeballed.
[`scripts/validate-schema.mjs`](scripts/validate-schema.mjs) stands up a real
Postgres in-process with [PGlite](https://pglite.dev), stubs the pieces Supabase
provides that a bare Postgres does not — the `auth` schema, `net.http_post`, the
`anon`/`authenticated` roles, the `supabase_realtime` publication — and runs the
dump statement by statement:

```bash
npm install --no-save @electric-sql/pglite
node scripts/validate-schema.mjs supabase/schema.sql
```

All 110 statements apply cleanly, and the rebuilt database comes back with the
same 12 tables, 22 foreign keys, 36 policies, 6 triggers and 3 realtime tables
as the project it was dumped from. That check is the only reason this file is
worth trusting: the first draft put foreign keys inline and emitted `to {public}`
for every policy, and both would have failed on the reader's first attempt.

### 4. Fill in your keys

```bash
cp .env.example .env
```

Three values, all from consoles you control:

```
EXPO_PUBLIC_SUPABASE_URL=        # Project Settings → API → Project URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=   # Project Settings → API → anon / public key
EXPO_PUBLIC_GEMINI_API_KEY=      # aistudio.google.com/apikey
```

Never put the Supabase `service_role` key here — it bypasses row-level security,
and everything in this file is compiled into the client.

The `EXPO_PUBLIC_` prefix means Expo inlines these at build time, on native and
web alike, so every value here ends up inside the shipped client. That is fine
for the anon key by design — it is only ever as safe as the row-level security
behind it, which is why every table carries policies rather than treating the
key as a secret. It is *not* fine for the Gemini key, which is why you should
restrict yours in Google Cloud Console to your own Android package name and
signing certificate before building anything you intend to hand out.

For builds, EAS reads its own environment variables rather than your local
`.env`; the web build reads Vercel's. A variable has to be added in all three
places.

### 5. Run it

```bash
npx expo start
```

Scan the QR with [Expo Go](https://expo.dev/go), press `w` for web, or `a` for
an Android emulator. Push notifications and a few other native features only
work in real builds, not in Expo Go.

### 6. Optional — build your own APK

```bash
npx eas-cli login
npx eas-cli build --platform android --profile preview
```

EAS uploads only git-tracked files and `.env` is gitignored, so set the three
variables in your EAS project's environment before building — otherwise
`supabase.ts` throws `Missing Supabase env vars` on launch.

---

## The schema

The schema was built in the SQL editor as the app was written, rather than as
checked-in migrations — which is the honest description of how a five-week
project actually went. It is now exported to
[`supabase/schema.sql`](supabase/schema.sql), but that export is a snapshot
taken afterwards, not a migration history: it will recreate the database as it
stands and tells you nothing about how it got there.

Two rules held it together once the first APK was on people's phones:

**Changes are additive.** Old APKs are already installed and will ignore a new
column, but a rename or a drop breaks them. So nothing gets renamed once it has
shipped.

**Realtime is opt-in per table** through the `supabase_realtime` publication, so
a new table has to be added deliberately rather than silently broadcasting.

---

## Layout

```
App.tsx              root — routing, auth, push registration, deep links
Auth.tsx             sign up / sign in
Feed.tsx             leaderboard, story strip, story modal
Profile.tsx          profile, edit, post detail
CreatePost.tsx       posting: screenshot extraction and the manual forms
Search.tsx           finding people
Inbox.tsx            chat list
ChatRoom.tsx         a single conversation
Notifications.tsx    in-app notification feed
supabase.ts          client + push helper
social.ts            likes, comments, views, share
notificationsApi.ts  notification fetch and per-kind preferences
ThemeContext.tsx     dark/light provider
```

---

## Known limits

**The Gemini key is called from the client, and it should not be.** Screenshot
extraction hits `generativelanguage.googleapis.com` directly from
`CreatePost.tsx` with `EXPO_PUBLIC_GEMINI_API_KEY`, which means the key is
inlined into the APK — and unlike the Supabase anon key, nothing sits behind it
the way row-level security sits behind Supabase. Anyone who unpacks the build
has a billable key. It shipped that way because the squad was six people I know
and the alternative was a whole server; the correct fix is a Supabase edge
function holding the key and the app calling that, which is how the same problem
is solved in my other projects.

- `expo-file-system/legacy` is still in use — it works on SDK 54 and is removed
  in SDK 55, so it needs migrating before that upgrade.
- iOS push is untested. The app is distributed as an Android APK.
- Web push is not implemented, by the decision above.

---

## Screens

A full walkthrough — the leaderboard re-ranking, a session logged from a watch
screenshot, stories, the group chat — is on the project page:
**[tusharlachman.dev/work/locked-in](https://tusharlachman.dev/work/locked-in)**
