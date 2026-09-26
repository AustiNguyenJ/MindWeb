-- Run this once in your Supabase project's SQL editor.
--
-- Adds the table the app uses to persist each signed-in user's global
-- quick-access toolbar config (which block types are on the bar, their
-- hotkeys) to the cloud backend, so it survives a reload instead of
-- resetting to the default every time.
--
-- Safe to run even if some cloud users already have boards/notebooks --
-- this is a new, separate table and touches nothing existing. Until it's
-- run, toolbar-config saves/loads to the cloud backend just fail silently
-- (logged to the console) and fall back to the in-memory default, same as
-- before this migration existed.

create table if not exists public.user_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  toolbar_config jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "user_settings: owner can select" on public.user_settings
  for select using (auth.uid() = owner_id);

create policy "user_settings: owner can insert" on public.user_settings
  for insert with check (auth.uid() = owner_id);

create policy "user_settings: owner can update" on public.user_settings
  for update using (auth.uid() = owner_id);
