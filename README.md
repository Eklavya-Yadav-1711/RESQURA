# 🚨 RESQORA — Working Emergency Response App
### *"When seconds matter, your neighbors become your first responders."*

> Production note: the original project was built around a laptop, SQLite and
> a local `uploads/` folder. The Supabase production schema and private media
> bucket setup now live in [`supabase/README.md`](supabase/README.md). The
> app API address is configured with `EXPO_PUBLIC_API_URL`, not a hard-coded
> Wi-Fi IP address.

---

## What This Is

A **production-oriented** community emergency response app. Phones can work over
mobile data through the deployed Supabase Edge API:
- Register and login with real accounts
- See real nearby users based on GPS range
- Trigger a real SOS that alerts the other phone instantly
- **Share live location + an editable help message + one photo or short video** with everyone within **2 km**
- Chat privately with the SOS sender and responders in an SOS-scoped group chat
- Share a read-only browser link with people who do not have the app
- Responder navigates to victim with live distance tracking
- Victim sees responders updating in real-time
- End SOS and revoke all access

### What an SOS carries

| Part | Value |
|------|-------|
| Location | Live GPS coordinates, updated while the SOS is active |
| Message | Editable before sending; default is `"I am here. Please come and help me."`; max 300 characters |
| Media | One optional photo or video; photos max 5 MB, videos max 30 seconds and 20 MB |
| Radius | 2 km — everyone inside it is alerted |
| Chat | Private SOS group chat; messages max 500 characters and visible to participants while active |

---

## Project Structure

```
resqora-full/
├── server/          ← Node.js backend (run on your laptop)
│   ├── index.js     ← Main server + Socket.io + REST API
│   ├── database.js  ← SQLite setup + all queries + range logic
│   ├── storage.js   ← SOS photo storage on disk (served from /uploads)
│   ├── push.js      ← Expo push alerts for in-range users who are offline
│   ├── auth.js      ← JWT middleware
│   ├── uploads/     ← Legacy local media (production uses Supabase Storage)
│   └── package.json
│
└── app/             ← Expo React Native app (run on both phones)
    ├── app/
    │   ├── _layout.jsx       ← Root layout, fonts, auth gate
    │   ├── login.jsx         ← Sign in
    │   ├── register.jsx      ← Create account
    │   ├── (tabs)/           ← Home / History / Profile
    │   ├── sos-trigger.jsx   ← Hold to arm → countdown → send (one screen)
    │   ├── sos-active.jsx    ← Victim's live map, responders, photo, end SOS
    │   ├── responder-nav.jsx ← Responder's live map + route to the victim
    │   └── sos-ended.jsx     ← Sharing stopped
    ├── components/
    │   ├── ui.jsx            ← Shared Card / Button / Pill / Field / Avatar
    │   ├── LiveMap.jsx       ← Real map card + full-screen map
    │   ├── mapHtml.js        ← Leaflet page rendered inside the WebView
    │   └── Logo.jsx
    ├── services/
    │   ├── api.js            ← REST + Socket.io client
    │   ├── photo.js          ← Camera / gallery photo and video picker
    │   ├── notifications.js  ← Push registration (needs Firebase, see below)
    │   └── format.js         ← Distance, time and date formatting
    ├── components/SOSChat.jsx ← Active SOS group chat
    └── theme.js              ← Design tokens (colour, type, spacing, radii)
```

---

## The Map

Both SOS screens show a **real OpenStreetMap map** — victim, responders, the
line between them and the live distance. It is Leaflet rendered inside a
WebView, so there is **no Google API key, no billing account and nothing to
configure**; it works in Expo Go and in a standalone build alike.

- Tiles: CARTO dark (OSM data), falling back to standard OSM tiles
- The inline map is gesture-free so it never fights the page scroll — tap the
  corner button for a full-screen interactive map
- No tiles (offline / blocked CDN)? It degrades to plain coordinates
- "Open directions" hands off to the phone's own maps app for turn-by-turn

---

## STEP 1 — Find Your Laptop's IP Address

This is the most important step. Both phones connect to your laptop.

**Windows:**
```
ipconfig
```
Look for `IPv4 Address` under your WiFi adapter. Example: `192.168.1.42`

**Mac/Linux:**
```
ifconfig
```
Look for `inet` under `en0`. Example: `192.168.1.42`

---

## STEP 2 — Set Your IP in the App

For production, `EXPO_PUBLIC_API_URL` points to:

```text
https://zwvpqwudjvceusdcrdgv.supabase.co/functions/v1/api
```

For legacy local testing only, add `EXPO_PUBLIC_API_URL` to `app/.env`:

```js
EXPO_PUBLIC_API_URL=http://192.168.1.42:3000
```

For production, this is your deployed HTTPS API address. Copy
`app/.env.example` to `app/.env`; do not add database credentials to the app.

---

## STEP 3 — Start the Backend Server

```bash
cd server
npm install
npm start
```

You should see:
```
╔══════════════════════════════════════╗
║         RESQORA SERVER LIVE          ║
║                                      ║
║  Local:   http://localhost:3000      ║
║  Network: http://YOUR_IP:3000        ║
╚══════════════════════════════════════╝
```

**Test it's working:**
Open your browser and go to `http://YOUR_IP:3000`
You should see: `{"status":"RESQORA server running","port":3000}`

---

## STEP 4 — Start the Expo App

```bash
cd app
npm install
npx expo start
```

---

## STEP 5 — Install on Both Phones

1. Install **Expo Go** from App Store / Play Store on both phones
2. Make sure both phones are on **the same WiFi as your laptop**
3. Scan the QR code from `npx expo start`

**If QR scan fails (college/hostel WiFi):**
- In Expo Go → tap "Enter URL manually"
- Type: `exp://YOUR_LAPTOP_IP:8081`
- Example: `exp://192.168.1.42:8081`

---

## STEP 6 — Test With Two Phones

### Phone 1 (Victim):
1. Open app → Register with name, phone, password
2. Allow location permission when asked
3. You should see "YOU ARE SAFE" home screen
4. Your real GPS coordinates will show

### Phone 2 (Responder):
1. Open app → Register with a different name/phone
2. Allow location permission
3. You should appear in Phone 1's "NEARBY RESPONDERS" list (if within 2km)

### Triggering SOS:
1. On Phone 1 → tap SOS → hold the button for 3 seconds
2. Edit the message if needed. Optionally tap "Add photo or video" (camera or gallery), then "Send now" or let
   the 5-second countdown finish
3. **Phone 2 gets the alert instantly** — victim name, distance, the custom
   message and media, over a red sheet with sound and vibration
4. Phone 2 taps "I'm on my way" → live map with the route and distance
5. Phone 1 watches Phone 2 move closer on its own map
6. Phone 2 taps "I've arrived", or Phone 1 taps "I'm safe — end SOS"
7. Both phones land on the resolved screen and location sharing stops
8. While active, both phones can use **SOS group chat** to share offers and
   requests such as “I have a rope” or “I am bringing towels”

---

## How Range Detection Works

When SOS is triggered:
1. Server gets victim's GPS coordinates
2. Runs Haversine distance formula against all online users
3. Only users within 2km get the alert
4. Socket.io emits `sos_alert` event directly to those users' sockets

```
Server haversine check:
distance = 6371 * 2 * atan2(sqrt(a), sqrt(1-a))  [in km]

If distance <= 2km → user gets SOS alert
```

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | – | Health check + live counters |
| GET | `/config` | – | Default message, 2 km radius, image limits |
| GET | `/stats` | – | Online users + active SOS count |
| POST | `/auth/register` | – | Register new user |
| POST | `/auth/login` | – | Login |
| GET | `/user/me` | ✓ | Get profile |
| POST | `/user/push-token` | ✓ | Save Expo push token |
| POST | `/user/location` | ✓ | Update location over REST |
| GET | `/nearby?lat=&lon=&range=` | ✓ | Get nearby online users |
| POST | `/sos/trigger` | ✓ | Trigger SOS (location + message + image) |
| GET | `/sos/active` | ✓ | Get your active SOS |
| GET | `/sos/:id` | ✓ | Full SOS details (victim, message, photo, responders) |
| POST | `/sos/:id/image` | ✓ | Attach or replace the photo mid-emergency |
| GET | `/sos/:id/messages` | ✓ | Read the active SOS group chat |
| POST | `/sos/:id/messages` | ✓ | Send a message to active SOS participants |
| POST | `/sos/:id/respond` | ✓ | Respond to SOS |
| POST | `/sos/:id/arrived` | ✓ | Mark as arrived |
| POST | `/sos/:id/end` | ✓ | End SOS |
| GET | `/history` | ✓ | Past SOS events with photos + responders |
| GET | `/profile/stats` | ✓ | SOS sent, times helped, member since |
| GET | `/uploads/:file` | – | SOS photo files |
| GET | `/t/:token` | – | Public live-tracking page for one SOS |
| GET | `/t/:token/data` | – | Live JSON, responders, media and read-only chat for the tracking page |
| GET | `/contacts` | ✓ | Your emergency contacts |
| POST | `/contacts` | ✓ | Add a contact (max 5) |
| DELETE | `/contacts/:id` | ✓ | Remove a contact |
| GET | `/nearby/help?lat=&lon=&radius=` | ✓ | Nearest police/hospitals + hotlines (OSM) |
| GET | `/timer` | ✓ | Your running safety timer, if any |
| POST | `/timer/start` | ✓ | Start one (minutes, optional note) |
| POST | `/timer/checkin` | ✓ | "I'm safe" — stops the timer |
| POST | `/timer/extend` | ✓ | Push the deadline back |
| POST | `/timer/cancel` | ✓ | Cancel without checking in |
| POST | `/sos/mine/clear` | ✓ | Close any SOS still stuck open |
| POST | `/sos/:id/withdraw` | ✓ | "I can't make it" — stop responding |
| GET | `/sos/incoming` | ✓ | Live alerts near you that still need someone |

### POST /sos/trigger

```jsonc
{
  "lat": 28.6139,
  "lon": 77.2090,
  "message": "I am stuck near the lake; I have no rope.", // optional, default available
  "range": 2,                                        // optional, defaults to 2 km
  "image": {                                         // optional, one photo or video
    "dataUri": "data:image/jpeg;base64,...",
    "mimeType": "image/jpeg",
    "fileName": "scene.jpg",
    "mediaType": "image"
  }
}
```

The production API stores media in the private Supabase `sos-media` bucket and
returns short-lived signed URLs. Base64 is not stored in the database.
Limits: 5 MB per image; 30 seconds and 20 MB per video; supported video types
are MP4, MOV and 3GP.

## Socket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `authenticate` | client→server | Register user on socket |
| `location_update` | client→server | Send GPS update |
| `responder_location_update` | client→server | Responder sends location |
| `sos_alert` | server→client | New SOS in your range |
| `responder_coming` | server→victim | Responder confirmed |
| `responder_location` | server→victim | Responder GPS update |
| `victim_location_update` | server→responder | Victim GPS update |
| `sos_image` | server→responders | Photo attached/replaced during an SOS |
| `responder_left` | server→victim | Someone withdrew — stop counting on them |
| `timer_warning` | server→client | Your safety timer expires in 2 minutes |
| `timer_expired` | server→client | It expired and an SOS went out for you |
| `sos_started` | server→all | A new SOS began (for live stats) |
| `sos_updated` | server→all | Responder list changed |
| `sos_resume` | server→client | You reconnected with an SOS still active |
| `sos_ended` | server→all | SOS resolved |
| `online_count` | server→all | Live online user count |

---

## Database (local development)

Auto-created as `server/database.db` on first run. Three tables:

- **users** — id, name, phone, hashed password, push_token, is_online, lat, lon
- **sos_sessions** — id, victim_id, lat, lon, message, image_url, image_mime_type,
  image_name, status, range_km, timestamps
- **sos_responders** — sos_id, responder_id, status (alerted/responding/arrived/declined)
- **emergency_contacts** — user_id, name, phone (max 5 per user)
- **safety_timers** — user_id, note, status, expires_at, triggered_sos_id
- **sos_messages** — active SOS chat messages, sender and timestamp

Photos live on disk in `server/uploads/`, not in the database.

## Production database and uploads (Supabase)

The production-ready Supabase schema is in
[`supabase/migrations/20261020_resqora_initial.sql`](supabase/migrations/20261020_resqora_initial.sql)
and the later migrations in [`supabase/migrations/`](supabase/migrations/).
These add video media support, the SOS chat table, and the PostgREST schema
reload required for the chat API.
It creates the application tables, indexes, database access protections and a
private, 5 MB SOS-media bucket. Follow [`supabase/README.md`](supabase/README.md)
to create the project and connect a deployed Node API.

The Supabase **service-role key belongs only in the Edge Function environment**.
Never add it to `app/.env`, `app.json`, source control or an Expo build. The
mobile app uses the HTTPS Supabase Edge API; the legacy `server/` folder is
retained as reference code and is not the production mobile backend.

### Server environment variables (all optional)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP port |
| `JWT_SECRET` | dev fallback | Token signing secret — set this in production |
| `DB_PATH` | `server/database.db` | SQLite file location |
| `UPLOAD_DIR` | `server/uploads` | Where SOS photos are written |
| `PUBLIC_BASE_URL` | request host | Base URL used to build photo links (set to your ngrok/domain) |
| `MAX_IMAGE_BYTES` | `5242880` | Per-photo size limit |
| `STALE_SOS_HOURS` | `6` | An SOS left open this long is auto-resolved |
| `PUSH_ENABLED` | `true` | Set `false` to skip Expo push notifications |

---

## Push Notifications (needs Firebase)

Everything is already wired: the server sends Expo push messages to in-range
users who have no live socket, and the app registers a push token on launch.
Two things are missing, both on the Android credential side.

1. **Firebase project** (free, no card): console → add an Android app with
   package `com.resqora.app` → download `google-services.json` into `app/` and
   add to `app.json`:
   ```json
   "android": { "googleServicesFile": "./google-services.json" }
   ```
2. **FCM V1 key**: Firebase console → Project settings → Service accounts →
   generate a private key, then `eas credentials` → Android → upload it.

Then build with EAS (`eas build -p android`). Expo Go can never receive remote
push, no matter what you configure — that is an Expo Go limitation, not a bug.

iOS push does not involve Firebase; it needs a paid Apple Developer account
for APNs. Sockets keep working everywhere in the meantime, so anyone with the
app open is alerted regardless.

---

## Reaching People Who Are Not On RESQORA

An alert that reaches nobody is the one real failure mode of a hyperlocal
network, so an SOS does not stop at the 2 km radius.

**Emergency contacts.** Save up to 5 people in Profile. When you raise an SOS
the app opens your messaging app with them and the alert prefilled — one tap to
send. No SMS gateway, no Twilio, no cost.

**A public live-tracking link.** Every SOS gets an unguessable GitHub Pages link
like `https://eklavya-yadav-1711.github.io/RESQURA/?token=...`. Opening it shows
the same read-only emergency view: live map, address, elapsed time, alert and
responder status, custom message, photo/video playback and the SOS group chat.
Visitors cannot send messages or modify the SOS. It stops updating and says so
the moment the emergency ends. Share it by SMS, WhatsApp or the share sheet.

---

## Nearest Police Station

RESQORA calls your neighbours; sometimes you need the state. Both the home
screen and the live SOS screen show the **nearest police stations and
hospitals**, straight from OpenStreetMap through the public Overpass API —
free, no key, no billing account.

Each entry gives the distance, an address where OSM has one, a call button
when a phone number is tagged, and directions that hand off to your maps app.
Above them sits a permanent **Call 112** button (India's single emergency
number, with 100 / 108 / 1091 also returned by the server).

Lookups are cached server-side for an hour on a ~1 km grid, so Overpass is
queried rarely and shared politely, and the app only re-queries after you move
about 100 m. If Overpass is unreachable the card says so and the hotline button
still works — the one thing that must never depend on a third party.

---

## Safety Timer

"I'm walking home, expect me in 20 minutes."

Set a timer on the home screen. Check in before it runs out and nothing
happens. Miss it, and **the server raises a full SOS for you** — same radius,
same responders, same push notifications — using your last known location, with
a message explaining that you did not check in and what you were doing.

The deadline lives on the server, not on the phone. That is the whole point: it
still fires if your phone is taken, switched off, or out of battery. Two
minutes before it expires you get a warning nudge, and you can extend by ten
minutes with one tap.

---

## Pinned Expo versions — do not "fix" these

`expo`, `expo-router` and `expo-constants` are pinned to exact versions
(54.0.34 / 6.0.23 / 18.0.13) and `babel-preset-expo` to 54.0.10.

`npx expo-doctor` will report these as patch-version mismatches. **Leave them
alone.** Upgrading to expo 54.0.37 ships a polyfill containing an untranspiled
`class`, and the Hermes compiler that RN 0.81.5 bundles rejects it:

```
index.js:37271:3: error: invalid statement encountered.
  class TextDecoder {
hermesc.exe ... exited with non-zero code: 2
```

Metro bundles fine, but the bytecode step fails — so `expo export` and any EAS
build break. The pinned set produces a clean 3.4 MB `.hbc`. If you ever do
upgrade, run `npx expo export --platform android` first and confirm it emits a
`.hbc` file before building.

---

## Troubleshooting

**"Connection refused" / app can't reach server:**
- Make sure server is running (`npm start` in `/server`)
- Double-check the IP in `api.js` matches your laptop's actual IP
- Both devices must be on same WiFi network
- Try pinging: open browser on phone, go to `http://YOUR_IP:3000`

**Phone not showing in nearby users:**
- Location permission must be granted on both phones
- Wait a few seconds after opening the app (GPS takes time)
- Make sure you're actually within 1.5km of each other (or test with range = 99)

**SOS not alerting second phone:**
- Both users must be online (socket connected) before SOS is triggered
- Check the server console — it logs when users connect and disconnect

**To test at same location (both phones side by side):**
They'll both show up in each other's nearby list since distance = ~0km

---

## Next Steps (When You Want to Scale)

- Replace SQLite with PostgreSQL + PostGIS for production
- Add Expo push notifications for background alerts
- Integrate real map tiles (React Native Maps or Mapbox)
- Deploy backend to Railway/Render/VPS for internet-wide use
- Add phone OTP verification
- Safe zones, emergency contacts, responder ratings

---

*RESQORA v1.0 — Local Backend Edition*
*Built with Node.js + Socket.io + SQLite + Expo React Native*
