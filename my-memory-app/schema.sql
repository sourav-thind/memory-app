-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles table
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  storj_bucket_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Snaps table
create table public.snaps (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  snap_base_id text not null,
  media_type text not null check (media_type in ('image', 'video')),
  original_timestamp timestamptz,
  storj_main_key text,
  storj_overlay_key text,
  storj_thumbnail_key text,
  has_overlay boolean not null default false,
  latitude double precision,
  longitude double precision,
  caption text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index idx_snaps_user_timestamp on public.snaps (user_id, original_timestamp desc);
create index idx_snaps_base_id on public.snaps (snap_base_id);

-- RLS policies
alter table public.profiles enable row level security;
alter table public.snaps enable row level security;

-- Profiles policies
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Snaps policies
create policy "Users can view own snaps"
  on public.snaps for select
  using (auth.uid() = user_id);

create policy "Users can insert own snaps"
  on public.snaps for insert
  with check (auth.uid() = user_id);

create policy "Users can update own snaps"
  on public.snaps for update
  using (auth.uid() = user_id);

create policy "Users can delete own snaps"
  on public.snaps for delete
  using (auth.uid() = user_id);

-- Trigger to auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function update_updated_at();

create trigger snaps_updated_at
  before update on public.snaps
  for each row execute function update_updated_at();
