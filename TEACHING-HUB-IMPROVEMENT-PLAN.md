# My Teaching Hub — product audit, design direction and implementation log
**Production URL:** https://msjocy-th.vercel.app/  
**Repository:** https://github.com/itsmemissjocy/Teaching-Hub  
**Audience:** Malaysian SJKC primary teacher; desktop/tablet preparation, Chromium smartboard delivery.

## Product decision

The website is a **classroom lesson workspace**, not a general-purpose document repository or pupil-management system. The daily task is: find a subject → open today's lesson → move between teaching materials → annotate freely → close the lesson. Preparing and permanently editing originals remains locked behind the approved teacher account.

## Existing foundations (inspected directly in the repository)

- Vite/JavaScript frontend with Supabase Auth, RLS-backed `folders` and `materials` tables, and public storage buckets for classroom-safe files.
- Two modes: anonymous viewing/annotation versus authenticated editing, including PDF upload, note editing, folder management and Recycle Bin.
- Text notes with formatting, Word/PDF export; PDFs with PDF.js rendering, annotation canvas, zoom; images, audio, video and external links.
- PIN/password unlock uses a Vercel server endpoint and existing Supabase Auth; server environment variable `EDITOR_EMAIL` is still needed.
- Temporary annotation strokes remain in browser memory. They **do not modify the saved document, image or PDF** and are lost on refresh.

## Audit: highest-priority issues and decisions

### P0 — data integrity / critical classroom functionality

1. **Protect originals**. Keep teacher-only RLS write policies. Never publish an anonymous write policy, service-role key or hardcoded PIN. Existing approach preserved.
2. **Browser/stylus QA**. Canvas strokes and pinch gestures must be verified on the actual smartboard (especially pen-down followed by two-finger pinch, long PDFs and high zoom). Build success is not a substitute for device testing.
3. **Do not lose documents**. The original editor warned on modal close but had no usable refresh recovery. This release adds session-scoped text drafts, optional restore, Ctrl/Cmd+S and unsaved-change warning on reload. Saved Supabase documents remain the source of truth.
4. **Public content privacy**. PDF and media buckets are public. Never publish identifying pupil photos, grades or confidential records; publication settings do not privatize already-uploaded public bucket objects.
5. **Editor correctness**. The current rich text editor still relies on legacy `document.execCommand`. A robust table/image/formatting editor should be migrated as a tested standalone project, not patched by broad unsafe HTML insertion.

### P1 — time savings & teaching flow

**Implemented in this release:**
- **Recent lessons** on the All Subjects page; remembered on the current device only.
- **Pinned lessons** for one-tap access; pins are local to the current browser and do not change Supabase records.
- **Cross-folder search** of folder names, material titles and note text, with a touchscreen Search button and folder paths.
- **Collapsible vertical annotation toolbar** for a larger viewing area.
- **Fit Width**, **Fit Page**, **Reset Zoom** and improved focal-point zoom for document-only scaling.
- **Clear Page** acts on the currently viewed page rather than the last marked page.
- **Classroom shortcuts:** Ctrl/Cmd+Z undo, Ctrl/Cmd+Y redo, Esc hand/scroll, Alt+Left/Right switch materials.
- **Drag-to-reorder** materials on desktop, keeping ↑/↓ arrows for touchscreen use.
- **Duplicate lesson folder**, including nested folders/materials. A new duplicate is initially private; published files are referenced rather than re-uploaded.

**Next engineering iteration (not yet implemented):**
- **Implemented in the document-editor v2 release:** migrated editing from legacy browser formatting commands to Tiptap/ProseMirror, with headings, font family/size, alignment, indentation, tables, inline HTTPS or uploaded pictures, and structured undo/redo. Existing notes stay in the materials.content HTML field. Saving still requires protected teacher authorization.
- Improve accessibility and material previews, particularly on narrow screens.
- Add a reliable version history for original documents before expanding automatic cloud autosave.
- Consider reusable lesson templates and teacher-controlled playlist collections across multiple folders.

### P2 — polish / convenience (planned)
- Optional PDF thumbnail strip and page jump.
- Consistent SVG icons across the library and teaching controls.
- Upload progress, clear media previews and sensible recovery from interrupted uploads.
- More refined mobile layout for long lesson titles and many media tabs.

### P3 — optional later (planned)
- Offline/cached lesson reading, after reviewing privacy and Supabase limitations.
- Optional **Export a separate annotated copy** (never overwrite original PDFs).
- Teacher-defined playlist sharing and per-device preferences.
- Dedicated accessibility and keyboard-navigation testing.

## Design system

- Calm, professional cream/green base with restrained mint, lavender, peach and butter-yellow accents.
- High-contrast text and large targets for classroom touchscreens.
- Minimal distractions in Teaching Mode; collapse tools when presenting a slide or image.
- Avoid unnecessary animation, tiny icon-only controls and popups.
- Preserve the original aspect ratio of teaching media.

## Acceptance test checklist (requires a real browser)

1. Open https://msjocy-th.vercel.app/ in a private browser. Confirm public materials open **without a PIN**, but original Edit/Delete actions are absent.
2. Open a multipage PDF in Teaching Mode, annotate pages 1 and 2, clear page 2 and confirm page 1 stays marked. Undo and redo.
3. Switch to another material and back. Annotations should remain until refresh; refresh should clear temporary ink.
4. Test pen, highlighter and eraser with mouse, stylus and fingers; test two-finger pinch while Pen is selected. Confirm only the material zooms.
5. Collapse the annotation toolbar and expand it. Test Fit Width, Fit Page and Reset Zoom for PDF, note and image.
6. Use a protected editor session to save a temporary note. Refresh while editing to test session draft restore; then save and confirm it opens again from Supabase.
7. Search a phrase contained inside a note; pin the lesson; confirm it appears on the All Subjects page. Open it from Recently used.
8. Drag materials into a new order on desktop. Check Previous/Next in Teaching Mode, then reorder with ↑/↓ on a touchscreen.
9. Duplicate a temporary lesson folder. Confirm the copy is private, the original remains unchanged, and publishing the copy exposes only the intended classroom material.
10. Add a classroom-safe image and audio recording, then view/play them. These features **require the earlier `media-upgrade.sql` migration**.
11. Use the PIN unlock to test protected editing only after configuring `EDITOR_EMAIL` on Vercel and setting the password in Supabase Auth.
12. Confirm slow Internet handling, large-PDF performance, and whether the smartboard browser allows fullscreen.

## Scope & operational notes

- This release does **not** modify Supabase tables, RLS policies, authentication secrets or existing lesson records.
- No new paid service was introduced.
- Prior setup requirements (`EDITOR_EMAIL` and `media-upgrade.sql`) remain if they were not completed.
- GitHub/Vercel automated build success verifies bundling, but does **not** prove all touchscreen interactions or backend writes on live classroom equipment.

## Document editor v2 — deployment and verification

- Uses Tiptap 3.31.3 with a refreshed, committed npm lockfile. No added paid services or database migration.
- Existing content is parsed as sanitized HTML. The app does **not** bulk rewrite documents. Editing and saving legacy notes can normalize formatting; test on a duplicated lesson first.
- Insert tables, add/delete rows and columns, align text, choose fonts and sizes, and use Tab/Shift+Tab indentation. Structured undo/redo remains in the editor.
- Uploaded images inside notes need the pre-existing media-upgrade.sql Supabase migration and teaching-media bucket; public HTTPS image URLs require no upload.
- Print / Save PDF is the closest representation of complex tables/images. Word export uses an HTML-to-Word converter and may render complex layouts differently.
- Draft recovery remains session-only and does not replace clicking Save material. Unsaved inline images are scheduled for cleanup on cancel.
- The classroom note annotation canvas is resized and redrawn after inline images finish loading.
- Real browser and smartboard QA is required, especially for large pasted notes, complex tables, touch input, ink alignment, uploads and exports. Vercel build success is not runtime QA.
