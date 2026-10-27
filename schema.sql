-- My Teaching Hub: run in Supabase SQL Editor before using the app.
-- Database policies enforce teacher-only writes; the smartboard only reads
-- folders explicitly made public by the teacher.
create extension if not exists pgcrypto;

create table if not exists public.teacher_access (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.teacher_access enable row level security;
revoke all on public.teacher_access from anon, authenticated;

create or replace function public.is_teacher() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.teacher_access where user_id = (select auth.uid()));
$$;
revoke all on function public.is_teacher() from public;
grant execute on function public.is_teacher() to anon, authenticated;

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id uuid references public.folders(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  sort_order integer not null default 0,
  is_public boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint no_self_parent check (parent_id is distinct from id)
);
create index if not exists folders_owner_parent_idx on public.folders(owner_id, parent_id);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  folder_id uuid not null references public.folders(id) on delete cascade,
  kind text not null check (kind in ('note','pdf','youtube','link')),
  title text not null check (length(trim(title)) between 1 and 180),
  content text not null default '',
  url text not null default '',
  storage_path text,
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists materials_folder_order_idx on public.materials(folder_id, sort_order);

-- A public lesson must also have public, non-deleted ancestor folders.
create or replace function public.folder_is_public(folder_uuid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with recursive ancestry as (
    select id, parent_id, is_public, deleted_at, array[id] as visited
    from public.folders where id = folder_uuid
    union all
    select f.id, f.parent_id, f.is_public, f.deleted_at, a.visited || f.id
    from public.folders f join ancestry a on f.id = a.parent_id
    where not (f.id = any(a.visited))
  )
  select coalesce(bool_and(is_public and deleted_at is null), false) from ancestry;
$$;
revoke all on function public.folder_is_public(uuid) from public;
grant execute on function public.folder_is_public(uuid) to anon, authenticated;

alter table public.folders enable row level security;
alter table public.materials enable row level security;
grant select on public.folders, public.materials to anon, authenticated;
grant insert, update, delete on public.folders, public.materials to authenticated;

drop policy if exists folders_read on public.folders;
create policy folders_read on public.folders for select to anon, authenticated
using ((owner_id = (select auth.uid()) and (select public.is_teacher()))
  or (deleted_at is null and public.folder_is_public(id)));
drop policy if exists folders_add on public.folders;
create policy folders_add on public.folders for insert to authenticated
with check (owner_id = (select auth.uid()) and (select public.is_teacher()));
drop policy if exists folders_edit on public.folders;
create policy folders_edit on public.folders for update to authenticated
using (owner_id = (select auth.uid()) and (select public.is_teacher()))
with check (owner_id = (select auth.uid()) and (select public.is_teacher()));
drop policy if exists folders_remove on public.folders;
create policy folders_remove on public.folders for delete to authenticated
using (owner_id = (select auth.uid()) and (select public.is_teacher()));

drop policy if exists materials_read on public.materials;
create policy materials_read on public.materials for select to anon, authenticated
using ((owner_id = (select auth.uid()) and (select public.is_teacher()))
  or (deleted_at is null and public.folder_is_public(folder_id)));
drop policy if exists materials_add on public.materials;
create policy materials_add on public.materials for insert to authenticated
with check (owner_id = (select auth.uid()) and (select public.is_teacher())
  and exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = (select auth.uid())));
drop policy if exists materials_edit on public.materials;
create policy materials_edit on public.materials for update to authenticated
using (owner_id = (select auth.uid()) and (select public.is_teacher()))
with check (owner_id = (select auth.uid()) and (select public.is_teacher())
  and exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = (select auth.uid())));
drop policy if exists materials_remove on public.materials;
create policy materials_remove on public.materials for delete to authenticated
using (owner_id = (select auth.uid()) and (select public.is_teacher()));

-- Uploaded PDFs are intentionally public. Never upload confidential data.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('teaching-pdfs', 'teaching-pdfs', true, 26214400, array['application/pdf'])
on conflict (id) do nothing;
drop policy if exists teaching_pdfs_upload on storage.objects;
create policy teaching_pdfs_upload on storage.objects for insert to authenticated
with check (bucket_id = 'teaching-pdfs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.is_teacher()));
drop policy if exists teaching_pdfs_remove on storage.objects;
create policy teaching_pdfs_remove on storage.objects for delete to authenticated
using (bucket_id = 'teaching-pdfs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.is_teacher()));

-- After creating your own user under Authentication > Users, run this
-- separately with YOUR email to allow that account to manage the library:
-- insert into public.teacher_access(user_id)
-- select id from auth.users where email = 'your-email@example.com'
-- on conflict (user_id) do nothing;
