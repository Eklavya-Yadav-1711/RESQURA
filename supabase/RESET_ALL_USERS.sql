-- Run this ONCE in the RESQORA project's Supabase Dashboard → SQL Editor.
-- It permanently deletes every app account, related emergency data, uploaded
-- SOS media, and Supabase Auth user in this project.

begin;

delete from storage.objects where bucket_id = 'sos-media';

truncate table public.sos_responders,
               public.emergency_contacts,
               public.safety_timers,
               public.sos_sessions,
               public.users
  restart identity cascade;

delete from auth.users;

commit;
