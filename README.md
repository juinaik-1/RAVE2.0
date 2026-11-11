# Nook Watch Party

Nook is a React/Vite watch-party app with Supabase rooms, synchronized playback, chat, voice, Google sign-in, private Drive streaming, and an authorized video-conversion queue.

## Local setup

1. Install frontend packages: `npm install`.
2. Copy `.env.example` to `.env` and set the Supabase, Google frontend, and optional TURN values.
3. Install backend packages: `npm install --prefix server`.
4. Copy `server/.env.example` to `server/.env`. Configure Google OAuth, the allowlist, and three independently generated secrets as described below.
5. Install `ffmpeg`, `ffprobe`, and `yt-dlp` on the backend host and make sure they are on `PATH`.
6. Start both apps with `npm run dev`. The Vite app runs at `http://localhost:5173`, and the API runs at `http://localhost:3001`.

The backend refuses to start when required secrets or configuration are missing or weak. `FRONTEND_ORIGINS` is an exact comma-separated origin list; no wildcard or Vercel-domain rule is used. `.env`, `server/.env`, `DATA_DIR`, and `DOWNLOAD_DIR` must not be committed.

## Environment

Frontend values go in the repository `.env`:

```env
VITE_API_URL=http://localhost:3001
VITE_GOOGLE_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=your-restricted-picker-api-key
VITE_GOOGLE_APP_ID=your-google-cloud-project-number
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_TURN_URL=turn:relay.metered.ca:80
VITE_TURN_USERNAME=your-turn-username
VITE_TURN_CREDENTIAL=your-turn-credential
```

Server values go in `server/.env`; see [server/.env.example](./server/.env.example). Set `PUBLIC_BASE_URL` to the public API origin in production. It is the origin used to construct signed stream URLs, not a localhost URL. Set `FRONTEND_ORIGINS` to the exact production frontend origin(s). `DATA_DIR` holds encrypted refresh tokens and stream records. `DOWNLOAD_DIR` holds conversion input/output files.

`MAX_SOURCE_GB` limits URL and Drive conversion downloads. `MAX_QUEUE_SIZE` counts only queued and active jobs; one conversion runs at a time. Drive streams expire after 12 hours. Converted-file streams expire after `FILE_TTL_HOURS`. The cleanup task runs every ten minutes.

The Convert page accepts a video picked from My Drive or a URL supported by `yt-dlp`. Drive files are identified by their actual media contents, not only their filename or MIME type, so formats such as MKV and AVI can be analyzed and converted when ffmpeg supports their codecs. Google-native documents and folders are not media inputs.

Generate three independent values (run the command once per variable; do not reuse them):

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Use the first two outputs for `SESSION_SECRET` and `STREAM_SECRET`. For `TOKEN_ENCRYPTION_KEY`, use a fresh 32-byte output encoded as base64:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Never put server secrets in Vercel or any `VITE_*` variable. The browser receives a 12-hour application JWT and short-lived stream URLs only; Google refresh tokens stay encrypted in `DATA_DIR`.

## Google Cloud configuration

1. **Create/select a Cloud project.** Enable **Google Drive API** and **Google Picker API** in APIs & Services → Library.
2. **Configure OAuth consent and branding.** In Google Auth Platform → Branding, set the app name, logo, support email, authorized domain, homepage, and Privacy policy URL to `https://YOUR-FRONTEND-DOMAIN/privacy`. Nook provides the policy at `/privacy`; deploy it on your verified HTTPS domain before entering the URL. Google owns the consent-screen layout and disclosures; Nook cannot replace or restyle Google's account/permission screen. In Audience, choose the intended audience; while in Testing, add each allowed Google account as a test user. In Data Access, add the `https://www.googleapis.com/auth/drive.readonly` scope. This read-only scope lets Nook retrieve Drive files you pick; it cannot edit or delete them. Google classifies it as restricted. Public production apps may need Google verification and a security assessment before users outside the test-user list can authorize it.
3. **Create a Web application OAuth client.** Under Authorized JavaScript origins, add each exact browser origin, such as `http://localhost:5173` and `https://your-Nook-domain.example`. Under Authorized redirect URIs, add the API callback, such as `http://localhost:3001/api/auth/google/callback` and `https://api.your-Nook-domain.example/api/auth/google/callback`. Put its client ID in both `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID`; keep the client secret only in `server/.env`.
4. **Create a restricted API key for Picker.** Restrict its application to HTTP referrers and list only the exact frontend origins. Under API restrictions, restrict it to **Google Picker API**. Put this public, referrer-restricted key in `VITE_GOOGLE_API_KEY`.
5. **Set the Picker App ID.** Copy the Cloud project number (not the project name or OAuth client ID) to `VITE_GOOGLE_APP_ID`. This is required for shared-drive Picker support.
6. **Configure the allowlist.** Put the exact lowercase email addresses allowed to sign in in server `ALLOWED_EMAILS`, comma-separated. OAuth consent test-user status and the Nook allowlist are both required during Testing.
7. **Set the server callback.** `GOOGLE_REDIRECT_URI` must exactly match the authorized redirect URI. Drive authorization uses one-time state and PKCE, with the `drive.readonly` scope and offline access. After changing from the previous `drive.file` permission, each user must click **Reconnect Drive** and approve the new read-only permission. Existing refresh tokens do not gain broader access automatically. The Picker shows videos and files owned by the signed-in user in My Drive; it excludes items shared with the user and Shared drives.

Google Identity Services signs users in; the server verifies the ID token, verified email, audience, and allowlist before issuing an application session.

Guests can join an existing room by invite link or room code without signing in. Guest access is limited to watching, chat, and voice; guests cannot create rooms, load or control media, connect Drive, or convert videos. Google sign-out clears the local Nook session; it does not revoke the separate Drive authorization. Users can revoke that authorization in Google Account settings.

## Backend VM

Use a maintained Linux VM with enough disk space for both the downloaded source and converted output. Install and keep the media tools updated:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg python3-pip pipx
pipx ensurepath
pipx install yt-dlp
pipx upgrade yt-dlp
ffmpeg -version
ffprobe -version
yt-dlp --version
```

Run the API as a dedicated service account. Keep `DATA_DIR` and `DOWNLOAD_DIR` on a private, persistent filesystem with adequate free space; grant write access only to that account. Set `NODE_ENV=production`, `PUBLIC_BASE_URL=https://api.your-domain.example`, exact `FRONTEND_ORIGINS`, Google credentials, and strong generated secrets. Restart the service after updating `yt-dlp`, `ffmpeg`, or environment values. Conversion accepts only content you own or may legally share.

### Caddy stream proxy

Point the API domain at the VM. Caddy streams reverse-proxy responses; set a negative `flush_interval` on the stream route to disable response buffering and flush immediately:

```caddyfile
api.your-domain.example {
	@videoStream path /api/stream/*
	handle @videoStream {
		reverse_proxy 127.0.0.1:3001 {
			flush_interval -1
		}
	}

	handle {
		reverse_proxy 127.0.0.1:3001
	}
}
```

Do not add a response-buffering layer in front of `/api/stream/*`. Preserve `Range` and `Content-Range` headers for seeking.

## Vercel frontend

Set these project environment variables in Vercel (Production and any exact Preview origins you allow):

- `VITE_API_URL=https://api.your-domain.example`
- `VITE_GOOGLE_CLIENT_ID=...`
- `VITE_GOOGLE_API_KEY=...`
- `VITE_GOOGLE_APP_ID=...`
- Existing `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optional `VITE_TURN_*` values

Add the deployed Vercel frontend origin to the OAuth client’s JavaScript origins, the Picker key’s HTTP-referrer restrictions, and server `FRONTEND_ORIGINS`. Never use a wildcard `.vercel.app` CORS rule. Rebuild/redeploy the frontend after changing Vite environment variables.

## Supabase

Keep the existing Supabase project URL and anon key in the frontend environment. The app uses Supabase Realtime for room presence, chat, and playback-control broadcasts. Configure the existing `messages` table and its read/write policies for room chat in the Supabase SQL editor; do not put a Supabase service-role key in the browser.

## Validation checklist

- [ ] An allowlisted, verified Google email can sign in; a non-allowlisted email is rejected.
- [ ] Connect Drive, pick a video, share it, and play it on a second signed-in account in the same room.
- [ ] Seek in a Drive stream and confirm the media request returns `206 Partial Content`.
- [ ] Change or expire a signed stream URL and confirm the API returns `401`.
- [ ] An HEVC/MKV Drive video is reported as unplayable and offers **Convert**.
- [ ] Convert the video, confirm the output plays in a browser, then share it to a room.
- [ ] Cancel during download and during ffmpeg conversion; confirm the child process stops and temporary files are removed.
- [ ] Complete four jobs sequentially and confirm completed jobs do not fill the queue.
- [ ] Convert a 700 MB source with enough disk space and confirm the result completes.
