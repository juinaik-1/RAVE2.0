# Rave Watch Party

A React + Vite watch-party app with synchronized video playback, real-time chat, presence, and mesh voice chat for small rooms.

## Features

- Create or join a room by code
- Share a room link with friends
- Synced video playback across the room
- Host-only playback and video controls toggle
- Real-time text chat with persistent message history
- Presence list and join/leave notices
- Voice chat over PeerJS (mesh topology) with Google STUN and optional TURN
- Dark theme design for desktop and mobile
- Static deployment on Vercel, Netlify, or Cloudflare Pages

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create an environment file:

   ```bash
   cp .env.example .env
   ```

3. Add your Supabase values to `.env` and optional TURN values.

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open the local Vite URL in the browser (typically `http://localhost:5173`).

## Required environment variables

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_TURN_URL=turn:relay.metered.ca:80
VITE_TURN_USERNAME=your-turn-username
VITE_TURN_CREDENTIAL=your-turn-credential
```

The TURN variables are optional. Google STUN is included automatically.

## Supabase setup

### 1) Create a free project

1. Go to https://supabase.com and sign in.
2. Click "New project".
3. Pick a project name and database password.
4. Choose a region close to your users.
5. Wait for the project to finish provisioning.

### 2) Get the project URL and anon key

1. Open the Supabase dashboard.
2. Go to Project Settings > API.
3. Copy the Project URL and the anon public key.
4. Put them into `.env` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

### 3) Create the messages table

Run this in the Supabase SQL editor:

```sql
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id text not null,
  name text not null default 'Guest',
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_room_created_at_idx
  on public.messages (room_id, created_at);
```

If `gen_random_uuid()` is not available in your project, use:

```sql
create extension if not exists pgcrypto;
```

### 4) Enable Realtime for the table

1. In Supabase, open the Realtime section.
2. Enable Realtime for the `messages` table.
3. Also enable `Presence` and `Broadcast` for the room channel patterns used by the app.

### 5) Add RLS policies

```sql
alter table public.messages enable row level security;

create policy "Anonymous can view room messages"
  on public.messages for select
  using (true);

create policy "Anonymous can insert room messages"
  on public.messages for insert
  with check (true);
```

> Note: Supabase free projects pause after roughly one week of inactivity. Re-activating is automatic when traffic resumes.

## Production deployment

### Vercel

1. Push this project to GitHub.
2. In Vercel, click "Add Project" and import the repository.
3. Set the framework as Vite.
4. Add the environment variables from `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_TURN_URL`
   - `VITE_TURN_USERNAME`
   - `VITE_TURN_CREDENTIAL`
5. Deploy.

The app is static and works with the provided `vercel.json` SPA rewrite.

### Netlify

1. Push the project to GitHub.
2. In Netlify, import the repo.
3. Set the build command to `npm run build`.
4. Set the publish directory to `dist`.
5. Add the same environment variables.
6. Deploy.

The `public/_redirects` file contains the SPA rewrite for Netlify.

### Cloudflare Pages

1. Push to GitHub.
2. Connect the repo in Cloudflare Pages.
3. Use the build command `npm run build`.
4. Use output directory `dist`.
5. Add environment variables.
6. Deploy.

## TURN server setup

The app uses Google STUN by default. If your users are behind restrictive NAT or corporate firewalls, add a TURN server for WebRTC relay.

A simple free option is Metered Open Relay:

1. Sign up at https://www.metered.ca/
2. Create an Open Relay account.
3. Copy the TURN URL, username, and credential.
4. Put them into `.env`:
   - `VITE_TURN_URL`
   - `VITE_TURN_USERNAME`
   - `VITE_TURN_CREDENTIAL`

This is optional, but helps with networking reliability.

## Browser requirements

- HTTPS is required for microphone access in the browser.
- Vercel, Netlify, and Cloudflare Pages all provide HTTPS automatically in production.
- For local development, `localhost` is trusted for microphone access.

## Testing checklist

Use two browser tabs or two browser windows to verify the core behavior:

1. Create a room in tab 1 and join with a different name in tab 2.
2. Paste a YouTube link into the room and confirm both tabs sync to the same playback state.
3. Send messages in both tabs and verify chat appears for every participant.
4. Click Join voice in both tabs and confirm the voice streams connect and audio plays.
5. Change host-only controls and confirm only the host can control playback.
6. Test leave and rejoin flow for presence and chat notices.

## Troubleshooting

### Voice not connecting

- Make sure the site is served over HTTPS in production.
- Grant microphone permission in the browser.
- Try a TURN server in `.env` if your network blocks direct peer connections.
- Check the browser console for PeerJS or WebRTC errors.

### Google Drive video not playing

- Google Drive links may fail for large files because of Google download restrictions.
- Prefer YouTube for the most reliable playback.
- Confirm the URL was converted correctly to the Google Drive download endpoint.

### Supabase paused or not responding

- Free projects may pause after inactivity.
- Re-open the Supabase dashboard and re-trigger activity.
- Check that Realtime is enabled and that the `messages` table exists.
- Confirm the environment variables are correct.

## Build and preview

```bash
npm run build
npm run preview
```

This generates a static `dist` folder that can be deployed anywhere that supports SPA hosting.
