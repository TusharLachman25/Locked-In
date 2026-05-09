# Locked In

Squad-based workout tracking app. Instagram-style stories, leaderboards, social features.
Built with Expo (React Native) + Supabase. Deploys to Android via EAS, web via Vercel.

---

## Stack

- **Frontend**: Expo SDK 54, React Native 0.81, react-native-web
- **Backend**: Supabase (Postgres + Auth + Storage + Realtime + RLS)
- **Build**: EAS Build for Android APK
- **Web hosting**: Vercel
- **Push notifications**: Expo Push Service via `pg_net` triggers

---

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/TusharLachman25/locked-in.git
cd locked-in
npm install
```

### 2. Get the secrets from Tushar

Ask Tushar (in person / DM) for:
- Supabase URL
- Supabase anon key
- Gemini API key (for AI screenshot extraction)
- Supabase database password (only if doing DB migrations directly)
- Expo account access (so you can run EAS builds)

### 3. Set up your local `.env` file

Create a `.env` file in the project root (this file is gitignored — never commit it):

```
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<paste from Tushar>
EXPO_PUBLIC_GEMINI_API_KEY=<paste from Tushar>
```

### 4. Run the dev server

```bash
npx expo start
```

Then either:
- Scan the QR with **Expo Go** on your phone (fastest for UI changes)
- Press `w` to open the web version
- Press `a` to launch on an Android emulator (if you have Android Studio set up)

> **Note**: Push notifications and a few other native features only work in actual builds, not Expo Go.

### 5. Verify Expo CLI access

To trigger production builds, you need access to the Expo project:

```bash
npx expo login   # Use the credentials Tushar shares
eas whoami       # Should show the team account
```

---

## Database setup

The Supabase project is shared. You'll have access through:

1. **Supabase dashboard**: https://supabase.com/dashboard/project/YOUR_PROJECT_REF (Tushar will invite you)
2. **SQL Editor**: where most schema changes happen

The `*.sql` migration files in this repo are the source of truth for the schema. They've already been run in the live DB. **Don't re-run a migration unless you know it's safe** (most are idempotent, but check first).

If you need to make a schema change:
1. Write a new `.sql` file describing the change
2. Run it in the SQL Editor
3. Commit the SQL file so the change is tracked in git

---

## Building the Android APK

This requires being added to the Expo project (Tushar does this once).

```bash
# Production build → uploads to Expo's servers, gives you a download link
eas build --platform android --profile production

# Faster preview build with debugging info
eas build --platform android --profile preview
```

Builds take 10-15 minutes. You'll get a URL to download the APK.

### Environment variables on EAS

The app reads Supabase keys from EAS environment variables — NOT from your local `.env`. The local `.env` is only for `expo start` during dev.

If env vars need to be added or changed:
1. Go to https://expo.dev/accounts/<account>/projects/locked-in/environment-variables
2. Add or edit the variable
3. Set it for `production` (and `preview` if you want preview builds to use it)
4. Trigger a new build — env vars are baked in at build time

---

## Deploying the web version

The web version auto-deploys to Vercel when you push to `main`. No manual step required.

Web env vars are in Vercel project settings → Environment Variables. Same names as local `.env` (the `EXPO_PUBLIC_` prefix).

---

## Project structure

```
/
├── App.tsx                # Root: routing, auth, push setup, deep-linking
├── Auth.tsx               # Sign up / sign in
├── Feed.tsx               # Home: leaderboard, story strip, story modal
├── Profile.tsx            # User profile + edit + post detail (own + others)
├── CreatePost.tsx         # Workout posting flow
├── Search.tsx             # Find friends
├── Inbox.tsx              # Chat list
├── ChatRoom.tsx           # Single chat
├── Notifications.tsx      # Notifications feed (in-app)
├── supabase.ts            # Supabase client + push helper
├── social.ts              # Likes / comments / views / share
├── notificationsApi.ts    # In-app notification fetch + preferences
├── ThemeContext.tsx       # Dark/light theme provider
├── *.sql                  # Database migrations (run order matters)
├── app.json               # Expo config
├── eas.json               # EAS build config
└── vercel.json            # Vercel SPA rewrite config
```

---

## Common tasks

**Adding a new screen**: create `MyScreen.tsx`, register in `App.tsx`'s `<Stack.Navigator>`.

**Adding a new database table**: write a `.sql` file with `CREATE TABLE`, RLS policies, and any triggers; run in SQL Editor; commit.

**Adding a new env var**: add to local `.env`, to Vercel, and to EAS.

**Schema changes**: prefer additive changes (new columns) over destructive (renames, drops). Old APKs in users' hands won't know about new columns and will ignore them; renames/drops will break old builds.

---

## Things to watch out for

- **expo-file-system/legacy** is used for now (works in SDK 54, removed in SDK 55+ — migrate before then).
- **iOS push notifications** aren't tested; may need additional config when you target iOS.
- **Web push** is intentionally NOT implemented (too fragile on iOS Safari).
- **Realtime subscriptions** require tables to be added to the `supabase_realtime` publication; if a new table needs realtime, add it to a migration.
- **Expo CLI version** matters — keep it on whatever version EAS uses; mismatches cause confusing errors.

---

## Questions

DM Tushar.
