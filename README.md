# My Teaching Hub

A Vite + Supabase web app for one teacher preparing lessons on a tablet and opening them on classroom smartboards. Public classroom viewing uses **one website address and no sign-in**; permanent editing requires an approved teacher account.

## What works in this starter

- Default subjects: BM Tahun 5, BM Tahun 6, PJPK Tahun 1, PJPK Tahun 3.
- Nested folders. Each lesson folder can hold **mixed** materials in saved teaching order: rich-text notes, uploaded PDFs, YouTube videos and external HTTPS links (Wayground, Wordwall, etc.).
- Teacher can add, edit, rename, move, duplicate and soft-delete materials; folders can be renamed, moved, published and moved to the Recycle Bin. Restore or permanently delete from the Recycle Bin.
- Notes are saved to Supabase; PDF copies upload to a public Supabase Storage bucket.
- Classroom view shows only published folders and their materials. Each folder supports **Start lesson**, direct material tabs and Previous/Next controls.
- PDF.js viewer with scroll/hand, pen, highlighter, whole-stroke eraser, undo/redo, zoom, page clearing, and lazy page rendering. Notes have a temporary annotation overlay. Ink persists **only within the current open browser session**, not across devices.
- YouTube embeds when the video allows it; fallback **Open on YouTube**. External learning sites open in a new tab for reliability.
- Tablet-friendly library and landscape smartboard Teaching Mode; browser full-screen when supported.

## Setup in this order (before final deployment)

### 1. Prepare the database

1. In [Supabase Dashboard](https://supabase.com/dashboard), open your existing project.
2. Go to **SQL Editor**, open `supabase/schema.sql` from this project and run its contents **once**. It creates folders, materials, the public PDF bucket and the required Row Level Security rules.
3. Go to **Authentication → Users** and create/invite **your own teacher account** using your email. Do not use a student's email.
4. Return to **SQL Editor** and run this SQL, replacing the email with the exact address used for that account:

   ```sql
   insert into public.teacher_access(user_id)
   select id from auth.users where email = 'YOUR_TEACHER_EMAIL@example.com'
   on conflict (user_id) do nothing;
   ```

   Only accounts in this allowlist can write to the database or upload PDFs. The website uses email magic-link sign-in with automatic new-account creation disabled.

5. In **Authentication → URL Configuration**, configure your eventual Vercel address as **Site URL** and **Additional Redirect URL**. For local testing, allow `http://localhost:5173` as an additional redirect URL.

### 2. Set environment variables

In Vercel **Project → Settings → Environment Variables**, add both variables for Production, Preview and Development:

| Key | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://YOUR_PROJECT.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Your `sb_publishable_...` key |

These are Vite names, **not** Next.js `NEXT_PUBLIC_...` names. Never add the Supabase `sb_secret_...` or `service_role` key to this browser project. The publishable key is designed to be public; the SQL policies enforce actual permissions.

### 3. Upload and deploy the full project

Upload **all** files and directories from this package into your existing [Teaching-Hub repository](https://github.com/itsmemissjocy/Teaching-Hub), preserving this structure:

```
Teaching-Hub/
  index.html
  package.json
  package-lock.json
  .env.example
  .gitignore
  README.md
  src/
    main.js
    lib.js
    teaching.js
    styles.css
  supabase/
    schema.sql
```

Do not upload `.env`, `node_modules`, `dist`, or your real credentials. Uploading only the original five starter files causes `npm run build` to fail because `src/main.js` is missing.

Vercel settings for the existing GitHub repository:

- Framework: **Vite** (or Other if Vite isn't detected).
- Build command: `npm run build`.
- Output directory: `dist`.
- Install command: default `npm install` / `npm ci`.

Pushing to the connected production branch normally triggers a new deployment automatically. You can use the resulting free `*.vercel.app` address on all smartboards; you do not need a custom domain.

### 4. Test the real setup

1. Open the website on your tablet, choose **Teacher sign in**, and request an email sign-in link with your approved account.
2. Confirm the four subject folders appear. Open **BM Tahun 5**, create a subfolder and add a text note.
3. Add a PDF, a YouTube link and a Wayground/Wordwall link to the **same** lesson folder. Use ↑ / ↓ to arrange their teaching order.
4. From the lesson folder menu, choose **Publish to classroom**. This also publishes any necessary ancestor subject folders. Never publish sensitive notes.
5. On a **different browser/device without signing in**, open the same Vercel homepage. Select subject → lesson folder → **Start lesson**.
6. Switch between materials, draw on a PDF and return to the same PDF; verify ink stays in place. Switch to hand mode to scroll. Try zoom and the eraser.
7. Sign in again on your tablet and test moving something to the Recycle Bin and restoring it. Verify the public smartboard has **no** edit/delete controls.

For local development:

```bash
npm install
cp .env.example .env
# Add URL and publishable key to .env, then:
npm run dev
npm run build
```

## Security and current limitations

- **Published lesson content is intentionally public** to anyone who can reach the website. Never store pupil personal data, grades, private school records, or other confidential content in published folders.
- **The PDF bucket is public** and files have publicly accessible URLs **even before** a lesson is published. Only upload classroom-safe PDFs. A private bucket with signed viewing URLs would be required for confidential materials.
- Supabase teacher access is enforced by SQL policies and an explicit teacher allowlist. Hiding edit buttons alone is not security. You must run the schema and allowlist setup before relying on access control.
- YouTube embedding depends on each video's restrictions. Most other websites do not allow embedding; they open in a separate tab.
- Google Drive sharing URLs are **not** generally direct PDF URLs. Keep original documents in Drive and upload classroom-safe PDF copies to this hub for dependable annotation. Automatic Google Drive sync is **not** implemented.
- PDF pages are rendered lazily when near the viewport, but old rendered pages are not unloaded from memory. Test very long PDFs on the actual smartboard.
- Pen/eraser marks are temporary **browser-session** state. They are not saved to Supabase, and closing/reloading the page loses ink. The eraser removes an entire intersecting stroke rather than splitting it.
- Text-note ink sits on a stable 820-pixel document page. Editing text or changing the smartboard layout may shift its relationship to the text. Do not edit a note while it is being annotated.
- Deleting an uploaded-PDF record does **not** automatically delete its underlying Storage object. If you want to reclaim storage space, remove unused objects from the `teaching-pdfs` bucket in Supabase after confirming no duplicate entry uses the same PDF.
- This build has passed `npm run build` locally. It has **not** yet been connected to your actual Supabase account or tested on your smartboard browser. Treat those acceptance tests as necessary before live classroom use.

## Troubleshooting

- **Vercel says `npm run build` exited with 1:** Look under **Deployments → failed deployment → Build Logs** for the first real error. Confirm `src/main.js` exists in GitHub.
- **Missing configuration:** Check both `VITE_...` environment variables and redeploy after changing them.
- **Cannot load library / table does not exist:** Run `supabase/schema.sql` in Supabase SQL Editor.
- **I can sign in but cannot edit:** Ensure your user exists in `public.teacher_access`. The dashboard-auth user and allowlist email must match.
- **No classroom folders appear:** Teacher needs to publish them. An anonymous viewer can only read a folder when it and its ancestor folders are published.
- **PDF says loading failed:** Test with a PDF uploaded directly to the hub; Google Drive / external hosting might block direct PDF fetching.
