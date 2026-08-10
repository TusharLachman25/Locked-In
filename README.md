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

## Running it

```bash
npm install
cp .env.example .env    # then fill it in
npx expo start
```

Then scan the QR with Expo Go, press `w` for web, or `a` for an Android
emulator. Push notifications and a few other native features only work in real
builds, not in Expo Go.

`.env` is gitignored and holds three values — your own Supabase project URL and
anon key, and a Gemini API key:

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_GEMINI_API_KEY=
```

The `EXPO_PUBLIC_` prefix means Expo inlines these at build time, on native and
web alike, so every value here ends up inside the shipped client. That is fine
for the anon key by design — but it means the key is only ever as safe as the
row-level security behind it, which is why every table carries policies rather
than treating the key as a secret.

For builds, EAS reads its own environment variables rather than your local
`.env`; the web build reads Vercel's. A variable has to be added in all three
places.

---

## The schema

The schema lives in the Supabase project rather than in this repository — it was
built in the SQL editor as the app was written, which is the honest description
of how a five-week project actually went. Two rules held it together once the
first APK was on people's phones:

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
