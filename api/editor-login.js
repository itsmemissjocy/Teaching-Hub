import { createClient } from '@supabase/supabase-js';

// This server-side endpoint keeps the editor email out of the browser.
// It uses Supabase Auth password verification and your existing RLS permissions.
// NEVER use a service-role key here or in the website bundle.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const email = process.env.EDITOR_EMAIL;
  if (!url || !key || !email) {
    return res.status(503).json({ error: 'PIN unlock is not configured. Add EDITOR_EMAIL in Vercel settings.' });
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const pin = body?.pin;
  if (typeof pin !== 'string' || pin.length < 8 || pin.length > 128) {
    return res.status(400).json({ error: 'Enter your editor passcode (at least 8 characters).' });
  }
  try {
    const client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password: pin });
    if (error || !data?.session) return res.status(401).json({ error: 'Incorrect passcode.' });
    const access = await client.rpc('is_teacher');
    if (access.error || access.data !== true) {
      await client.auth.signOut();
      return res.status(403).json({ error: 'This account cannot edit the library.' });
    }
    return res.status(200).json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch {
    return res.status(500).json({ error: 'Could not unlock editing. Try again.' });
  }
}
