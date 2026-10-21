create table if not exists public.sos_messages (
  id bigint generated always as identity primary key,
  sos_id bigint not null references public.sos_sessions(id) on delete cascade,
  sender_id bigint not null references public.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists sos_messages_room_idx
  on public.sos_messages (sos_id, created_at);

alter table public.sos_messages enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sos_messages'
  ) then
    alter publication supabase_realtime add table public.sos_messages;
  end if;
end
$$;

notify pgrst, 'reload schema';
