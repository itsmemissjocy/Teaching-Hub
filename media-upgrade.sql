-- Teaching Hub media upgrade. Run once in Supabase SQL Editor.
-- This enables images and audio while keeping all original files protected
-- from unauthenticated editing. Only approved teachers can upload.
-- Media in the public bucket must be classroom-safe (no pupil/private data).

begin;

alter table public.materials drop constraint if exists materials_kind_check;
alter table public.materials add constraint materials_kind_check
  check (kind in ('note', 'pdf', 'image', 'audio', 'youtube', 'link'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'teaching-media', 'teaching-media', true, 26214400,
  array[
    'image/jpeg','image/png','image/webp','image/gif',
    'audio/mpeg','audio/mp4','audio/x-m4a','audio/wav',
    'audio/x-wav','audio/ogg','audio/webm','audio/aac'
  ]
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists teaching_media_upload on storage.objects;
create policy teaching_media_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'teaching-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_teacher())
  );

drop policy if exists teaching_media_remove on storage.objects;
create policy teaching_media_remove on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'teaching-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_teacher())
  );

commit;
