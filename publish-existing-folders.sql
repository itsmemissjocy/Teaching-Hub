-- Teaching Hub: publish existing ACTIVE folders for login-free viewing.
-- This does NOT grant edit, upload, update, or delete permissions to visitors.
-- Your existing Supabase RLS teacher-only write policies remain in force.
--
-- PRIVACY WARNING: this makes all active (non-deleted) folders, including
-- previously private ones, viewable by anyone who opens your website.
-- Check first that they contain no student names/IDs, grades,
-- confidential school information, or personal documents.
-- Files in the teaching-pdfs bucket are already publicly accessible.
--
-- Execute ONCE in Supabase > SQL Editor after reviewing the warning.
-- This operation does not delete any folders or materials.

BEGIN;

UPDATE public.folders
SET is_public = TRUE
WHERE deleted_at IS NULL
  AND is_public = FALSE;

COMMIT;
