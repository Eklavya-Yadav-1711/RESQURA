-- RESQORA production schema for Supabase Postgres.
-- Run this file once in Supabase Dashboard → SQL Editor, or with the Supabase
-- CLI. It deliberately uses bigint IDs so the existing mobile/API payloads
-- remain compatible with the current SQLite implementation.

create extension if not exists pgcrypto;

create table if not exists public.users (
  id bigint generated always as identity primary key,
  name text not null check (char_length(trim(name)) between 1 and 80),
  phone text not null unique check (char_length(trim(phone)) between 6 and 30),
  password text not null,
  push_token text,
  is_online boolean not null default false,
  latitude double precision,
  longitude double precision,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint users_latitude_check check (latitude is null or latitude between -90 and 90),
  constraint users_longitude_check check (longitude is null or longitude between -180 and 180)
);

create table if not exists public.sos_sessions (
  id bigint generated always as identity primary key,
  victim_id bigint not null references public.users(id) on delete cascade,
  victim_lat double precision not null check (victim_lat between -90 and 90),
  victim_lon double precision not null check (victim_lon between -180 and 180),
  message text not null default 'I am here. Please come and help me.' check (char_length(message) <= 300),
  image_url text,
  image_mime_type text,
  image_name text,
  status text not null default 'active' check (status in ('active', 'ended')),
  range_km numeric(5,2) not null default 2 check (range_km > 0 and range_km <= 10),
  share_token text unique,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.sos_responders (
  id bigint generated always as identity primary key,
  sos_id bigint not null references public.sos_sessions(id) on delete cascade,
  responder_id bigint not null references public.users(id) on delete cascade,
  status text not null default 'alerted' check (status in ('alerted', 'responding', 'arrived', 'withdrawn')),
  responded_at timestamptz,
  arrived_at timestamptz,
  unique (sos_id, responder_id)
);

create table if not exists public.emergency_contacts (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  phone text not null check (char_length(trim(phone)) between 6 and 30),
  created_at timestamptz not null default now(),
  unique (user_id, phone)
);

create table if not exists public.safety_timers (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  note text,
  status text not null default 'running' check (status in ('running', 'checked_in', 'cancelled', 'expired')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  warned boolean not null default false,
  triggered_sos_id bigint references public.sos_sessions(id) on delete set null
);

create index if not exists sos_sessions_victim_status_idx on public.sos_sessions (victim_id, status);
create index if not exists sos_sessions_active_idx on public.sos_sessions (status, started_at desc);
create index if not exists sos_responders_responder_status_idx on public.sos_responders (responder_id, status);
create index if not exists emergency_contacts_user_idx on public.emergency_contacts (user_id);
create index if not exists safety_timers_status_expiry_idx on public.safety_timers (status, expires_at);
create index if not exists users_last_seen_idx on public.users (last_seen desc);

-- The API owns all data access using the service-role key. RLS remains on to
-- prevent accidental browser/mobile access through the public Supabase keys.
alter table public.users enable row level security;
alter table public.sos_sessions enable row level security;
alter table public.sos_responders enable row level security;
alter table public.emergency_contacts enable row level security;
alter table public.safety_timers enable row level security;

-- Keep the foreground responder popup responsive when the app is open.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sos_sessions'
  ) then
    alter publication supabase_realtime add table public.sos_sessions;
  end if;
end
$$;

-- Private SOS-photo bucket. The backend uploads and signs/serves objects;
-- clients must never receive the service-role key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sos-media',
  'sos-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No Storage policies are created intentionally. The service role bypasses
-- RLS; anon/authenticated browser clients have no direct bucket access.

-- Expire safety timers every minute and turn each expiry into an SOS.
create extension if not exists pg_cron with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'resqora-timer-expiry';
select cron.schedule('resqora-timer-expiry', '* * * * *', $$
  with expired as (
    update public.safety_timers
    set status = 'expired'
    where status = 'running' and expires_at <= now()
    returning id, user_id, note
  ), raised as (
    insert into public.sos_sessions (victim_id, victim_lat, victim_lon, message, range_km, status)
    select e.user_id, coalesce(u.latitude, 0), coalesce(u.longitude, 0),
           coalesce(nullif(e.note, ''), 'My safety timer expired. Please check on me.'), 2, 'active'
    from expired e
    left join public.users u on u.id = e.user_id
    returning id, victim_id, victim_lat, victim_lon, range_km
  )
  insert into public.sos_responders (sos_id, responder_id, status)
  select r.id, u.id, 'alerted'
  from raised r
  join public.users u on u.id <> r.victim_id
    and u.latitude is not null and u.longitude is not null
    and 6371 * acos(least(1, greatest(-1,
      cos(radians(r.victim_lat)) * cos(radians(u.latitude))
      * cos(radians(u.longitude) - radians(r.victim_lon))
      + sin(radians(r.victim_lat)) * sin(radians(u.latitude))
    ))) <= r.range_km
  on conflict (sos_id, responder_id) do nothing;
$$);
