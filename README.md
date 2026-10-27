# My Teaching Hub — cloud teaching library

A working **starter application** for preparing lessons on a tablet and opening them on a smartboard without signing in. Supports nested folders, mixed lesson materials (text notes, uploaded PDFs, YouTube videos, website links), reorder, edit/delete, public lesson links, PDF/notes annotation, and full-screen teaching mode.

## 1. Create your Supabase project

1. Go to https://supabase.com/dashboard and create a free project (or choose an existing one).
2. Open **SQL Editor** and run the entire `supabase/schema.sql` file.
3. Open **Authentication → Providers → Email**. Enable email sign-in / magic links. For a personal library, disable public sign-ups after your teacher account is created, or restrict allowed users using your Supabase configuration.
4. Under **Authentication → URL Configuration**, add your eventual website URL as **Site URL** and as an **Additional Redirect URL**. During local testing add `http://localhost:5173`.
5. In **Project Settings → API / Connect**, copy the **Project URL** and **publishable (anon) key**. NEVER copy a service_role or secret key into the website.

## 2. Run locally

Install Node.js 20.19+ or 22+. Then:

```bash
npm install
cp .env.example .env
# Edit .env and paste your project URL and publishable key
npm run dev
```

Open http://localhost:5173. Enter your email to receive a magic sign-in link. The email link must return to a URL listed in Supabase Authentication redirects.

## 3. Deploy to Vercel

1. Put the project in a **private GitHub repository** (do not commit `.env`).
2. At https://vercel.com/new import the repository.
3. Vercel should detect Vite; use build command `npm run build`, output directory `dist`.
4. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel Project Settings.
5. Deploy and copy the website address.
6. Add the deployed URL to Supabase **Authentication → URL Configuration** (Site URL and Redirect URLs).
7. Open the site on your tablet and sign in with your email. Create subject folders, nested lesson folders, and materials.
8. Inside a lesson folder, select **Publish as classroom lesson**, then **Copy classroom link**. Bookmark that URL on the smartboard. No login is required on that URL.

## 4. Prepare lessons

- Create a top-level subject folder (BM Tahun 5, etc.) and a lesson subfolder.
- Add **Text note**: type or paste content, then save. Notes are stored in Supabase and can be opened on another device.
- Add **PDF**: upload a PDF directly (recommended) or paste a public direct PDF URL. Direct uploads go to a public Supabase Storage bucket.
- Add **YouTube**: paste a watch, Shorts, or youtu.be link; it plays in an embedded player if the video permits embedding. Otherwise use Open on YouTube.
- Add **Website link**: paste a Wayground, Wordwall, Google Forms or other HTTPS link. Open it in a separate browser tab.
- Use the ↑ and ↓ buttons to arrange teaching order.
- Click **Start lesson** or open the published classroom link on the smartboard. Tap material tabs to switch.
- Use Scroll / Pen / Highlight / Erase and Undo / Redo on PDFs and notes. Annotations remain in memory while the page is open; they are **not synced or saved across devices**.

## Important privacy and technical limitations

- **Publishing a lesson makes its text notes and material URLs publicly readable by anyone with the link.** Do not publish student personal information, grades, confidential documents, or private notes.
- **The `teaching-pdfs` storage bucket is public.** An uploaded PDF has a public URL even before its lesson is published. Do not upload sensitive files. For private PDFs, you would need a private bucket and signed URLs / a different access architecture.
- **Google Drive sharing links often cannot be loaded inside PDF.js** because of browser CORS and redirect rules. Keep the originals in Google Drive and upload a PDF copy into this app for dependable classroom annotations. This project does not automatically sync Drive files.
- Teacher sign-in is via Supabase email magic link. Supabase row-level security prevents unauthenticated visitors from editing/deleting permanent library records. Each signed-in user owns only their own content. You should restrict account registration for a personal deployment.
- Deletion is **permanent** in this version (with confirmation), including deletion of a folder's nested content. There is **no recycle bin yet**. Uploaded PDF files may remain in storage after deleting a library record; remove unused files separately in Supabase Storage.
- The PDF renderer currently renders all pages sequentially, so very large PDFs can be slow on older smartboards. Future improvement: lazy-render visible pages.
- The stroke eraser removes whole strokes that intersect the eraser path; it does not split strokes into segments. Annotations on text notes are anchored to the displayed page, so editing/reflowing the note after marking it can change alignment.
- This is a starter application. **Test on the actual smartboard browser** before relying on it in class. Browser full-screen, stylus events, YouTube playback and PDF loading can vary by device.
- This project is not yet deployed or connected to your accounts. The app cannot store anything until Supabase is configured and SQL has been applied.

## Security design

- `anon`/publishable key in browser: safe when combined with strict RLS; **never use service_role**.
- Teacher-only writes to `folders` and `materials`, enforced in database policies.
- Anonymous read only for explicitly published lesson folders and their materials.
- Published lesson URLs are shareable and intentionally readable without authentication.
- For enhanced protection, consider a non-public classroom PIN with server-side validation, or a read-only signed link that expires.
