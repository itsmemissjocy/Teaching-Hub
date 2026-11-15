# Teaching Hub: PIN unlock, pictures, audio and pinch zoom

## What changed

- The website remains open for **viewing and temporary annotation** with no sign-in.
- **Unlock editing** now asks for a PIN/passcode instead of a magic email sign-in link.
- The PIN is checked by a Vercel server endpoint against **Supabase Auth**. Existing Supabase Row Level Security continues to protect original materials.
- Approved editors can upload images (JPG, PNG, WebP, GIF) and audio files (MP3, M4A, WAV, OGG, WebM, AAC), each up to 25 MB, or use direct public HTTPS links.
- Teaching Mode shows pictures with the usual annotation tools and audio with a player.
- Two-finger pinch zoom and the Zoom buttons resize the **open PDF, image or document only**, not the entire website.
- Temporary pen/highlighter marks can be erased, undone or cleared by anyone, without changing original content.

## Required one-time setup

### 1. Set your PIN (requires your existing approved account)

**If you are still signed in on a device:**
1. Open Teaching Hub on that device. You should see **Editing unlocked**.
2. Select **Set / change PIN**, enter an 8+-character PIN or passcode twice, then save.
3. Do not select **Lock editing** until after you complete the Vercel setting below.

**If you have already signed out:** select **Unlock editing → First-time setup or forgot PIN?** and request a one-time recovery link to the approved teacher email. After following it, Teaching Hub will offer the PIN setup form. This email is used only for setup/recovery, **not** regular editing.

A longer PIN is safer than 4–6 digits. Supabase Auth stores the password and rate-limits login attempts; the PIN itself must never be inserted in JavaScript, the repository, or Vercel variables.

### 2. Configure Vercel

1. Open your existing Teaching Hub project in Vercel.
2. Go to **Settings → Environment Variables**.
3. Add **EDITOR_EMAIL** = the *same email already approved in Supabase `teacher_access`*.
4. Mark it for **Production** (and Preview if you want preview deploys to work).
5. Save and **Redeploy** the production version so the serverless endpoint receives the new variable.

Use exactly `EDITOR_EMAIL`, with no `VITE_` prefix. It remains on the server and is not printed into the website's JavaScript. Keep your existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never use the Supabase secret/service-role key here.

### 3. Enable image and audio uploads

1. Open [media-upgrade.sql](media-upgrade.sql) in this repository and copy the full query.
2. In **Supabase → SQL Editor → New query**, paste and run it once.
3. The migration expands the `materials.kind` options, creates the public `teaching-media` storage bucket and restricts uploads to the approved teacher.
4. It does not remove existing folders, PDFs, notes or videos.

If older active lesson folders are still invisible without login, run [publish-existing-folders.sql](publish-existing-folders.sql) *only after reviewing them for private information*. It makes all active folders public **to read**, not to edit.

### 4. Test on both devices

- On a device with no session, open a published lesson and use Pen, Highlight, Eraser, Undo, Redo and Clear Page. Try zooming a PDF/image/note with two fingers.
- Unlock editing on your own device using only the new PIN.
- Add an image and an audio recording to a lesson, then open them in Teaching Mode.
- Lock editing and verify that Add/Edit/Delete actions disappear but annotation controls stay available.

## Privacy and practical limits

The `teaching-media` and `teaching-pdfs` buckets are **public**: anyone who has a file URL can access it. Only upload classroom-safe materials. Never upload private student records, grades, student-identifying photos or confidential school documents.

Annotations are temporary browser-session ink; refreshing closes them. The picture viewer uses an ink overlay and does not modify the original image. The audio player is for playback (there is no drawn annotation surface for sound).

For **PIN recovery**, an email link is still available as a fallback; you do not need to use email for normal editing.
