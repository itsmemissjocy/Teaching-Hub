import { createClient } from '@supabase/supabase-js';
import DOMPurify from 'dompurify';

export const configured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
export const supabase = configured
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
  : null;

export const SUBJECTS = ['BM Tahun 5', 'BM Tahun 6', 'PJPK Tahun 1', 'PJPK Tahun 3'];
export const META = {
  folder: { icon: 'folder', label: 'Folder' },
  note: { icon: 'file-text', label: 'Text note' },
  pdf: { icon: 'file-up', label: 'PDF' },
  youtube: { icon: 'play-square', label: 'YouTube' },
  link: { icon: 'external-link', label: 'Website' },
};

export function el(tag, className = '', content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

export function button(label, handler, className = 'button') {
  const result = el('button', className, label);
  result.type = 'button';
  if (handler) result.addEventListener('click', handler);
  return result;
}

export function safeNote(html = '') {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p','div','br','strong','b','em','i','u','h1','h2','h3','ul','ol','li','blockquote'],
    ALLOWED_ATTR: [],
  });
}

export function safeHttpUrl(value) {
  const address = new URL(String(value || '').trim());
  if (address.protocol !== 'https:') throw new Error('Use a secure HTTPS website link.');
  return address.href;
}

export function youtubeId(value) {
  const address = new URL(safeHttpUrl(value));
  const host = address.hostname.toLowerCase();
  let id = '';
  if (host === 'youtu.be' || host === 'www.youtu.be') id = address.pathname.split('/')[1];
  else if (['youtube.com','www.youtube.com','m.youtube.com'].includes(host)) {
    if (address.pathname === '/watch') id = address.searchParams.get('v');
    else if (/^\/(shorts|embed|live)\//.test(address.pathname)) id = address.pathname.split('/')[2];
  }
  if (!/^[\w-]{11}$/.test(id || '')) throw new Error('Please enter a valid YouTube video URL.');
  return id;
}

export function ordered(items) {
  return [...items].sort((a, b) => (a.sort_order - b.sort_order) || a.created_at?.localeCompare(b.created_at || '') || 0);
}

export function isActiveFolder(folder, folders) {
  if (!folder || folder.deleted_at) return false;
  const visited = new Set([folder.id]);
  let current = folder;
  while (current.parent_id) {
    if (visited.has(current.parent_id)) return false;
    visited.add(current.parent_id);
    current = folders.find((item) => item.id === current.parent_id);
    if (!current || current.deleted_at) return false;
  }
  return true;
}

export function allAncestors(folder, folders) {
  const result = [];
  const seen = new Set();
  let current = folder;
  while (current && !seen.has(current.id)) {
    result.unshift(current);
    seen.add(current.id);
    current = folders.find((item) => item.id === current.parent_id);
  }
  return result;
}

export async function check(result) {
  if (result.error) throw result.error;
  return result.data;
}

export function message(error) {
  return error?.message || String(error || 'Something went wrong.');
}
