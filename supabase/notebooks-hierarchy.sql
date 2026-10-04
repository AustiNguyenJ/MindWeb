-- Run this once in your Supabase project's SQL editor.
--
-- Lets notebooks nest inside other notebooks and keeps an explicit sibling
-- order, so they can be reordered the same way pages already are.
--
-- Safe to run against an existing notebooks table: both columns are
-- nullable/defaulted, so existing rows just become root-level, order-0
-- notebooks until the app writes real values back.
--
-- notebooks.id is text (the app's ids look like "nb_xxxxxxxx", not real
-- uuids), so parent_id has to match that type rather than uuid.

alter table public.notebooks
  add column if not exists parent_id text references public.notebooks(id) on delete set null,
  add column if not exists sort_order integer not null default 0;
