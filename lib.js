import { createClient } from '@supabase/supabase-js';
import DOMPurify from 'dompurify';

export const configured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
export const supabase = configured
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
  : null;

export const SUBJECTS = ['BM Tahun 5', 'BM Tahun 6', 'PJPK Tahun 1', 'PJPK Tahun 3'];
export const META = {
  folder: { icon: 'folder', label: 'Folder' },
  note: { icon: 'file-text', label: 'Editable document' },
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
  // Keep only the text alignment and indentation needed by our document editor.
  // DOMPurify deliberately does not sanitize CSS itself, so we strip every
  // incoming style from an inert fragment before inserting it into the page.
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p','div','br','strong','b','em','i','u','h1','h2','h3','ul','ol','li','blockquote'],
    ALLOWED_ATTR: ['style', 'align'],
    RETURN_DOM_FRAGMENT: true,
  });
  const blockTags = new Set(['P','DIV','H1','H2','H3','UL','OL','LI','BLOCKQUOTE']);
  for (const node of fragment.querySelectorAll('*')) {
    const alignment = (node.style.textAlign || node.getAttribute('align') || '').toLowerCase().trim();
    const marginLeft = node.style.marginLeft;
    const textIndent = node.style.textIndent;
    node.removeAttribute('style');
    node.removeAttribute('align');
    if (!blockTags.has(node.tagName)) continue;
    if (['left','center','right','justify'].includes(alignment)) node.style.textAlign = alignment;
    const safeLength = (value) => {
      const match = /^([0-9]+(?:\.[0-9]+)?)(px|pt|em)$/i.exec(value.trim());
      if (!match) return null;
      const px = Number(match[1]) * (match[2].toLowerCase() === 'pt' ? 4 / 3 : match[2].toLowerCase() === 'em' ? 16 : 1);
      return `${Math.min(240, Math.round(px))}px`;
    };
    if (safeLength(marginLeft)) node.style.marginLeft = safeLength(marginLeft);
    if (safeLength(textIndent)) node.style.textIndent = safeLength(textIndent);
  }
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
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
