# RESQORA Supabase setup

This folder makes Supabase responsible for the production database and the
private SOS-photo bucket. The mobile app still talks only to the RESQORA API;
that prevents a downloaded app from exposing other people's locations or the
Supabase service-role key.

## Do this in Supabase

1. Create a new Supabase project in the closest region.
2. Open **SQL Editor** and run `migrations/20261020_resqora_initial.sql`.
3. In **Project Settings → API**, copy the project URL and the **service_role**
   key. Keep the service-role key only on the backend host.
4. Add those values to the backend host's environment using the names in
   `server/.env.example`.

The migration creates these records: users, SOS sessions, responders,
emergency contacts and safety timers. It also creates a private `sos-media`
bucket capped at 5 MB and restricted to image files.

## Deployment layout

```
RESQORA mobile app
        │ HTTPS + Socket.IO
        ▼
Deployed RESQORA API ─────► Supabase Postgres + private SOS media bucket
        │
        └──────────────────► Expo push service / OpenStreetMap
```

Supabase is the database and file-storage layer; it does not run this long-lived
Socket.IO API itself. Deploy `server/` to a Node host that supports WebSockets
(for example Render, Railway, Fly.io, or your own VPS) and set
`EXPO_PUBLIC_API_URL` to that HTTPS address for app builds.

## Credentials still needed

When you are ready to connect the live project, provide these *privately in the
environment settings*, not in source control:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- a long random `JWT_SECRET`
- the public HTTPS URL chosen for the Node API (`PUBLIC_BASE_URL`)

Do not send the Supabase database password, and never place the service-role
key in the Expo app configuration.
