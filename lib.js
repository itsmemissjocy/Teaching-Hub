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
  image: { icon: 'image', label: 'Picture' },
  audio: { icon: 'music', label: 'Audio recording' },
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
  // Convert both legacy Teaching Hub notes and new editor markup to safe HTML.
  // Never trust HTML from a pasted document, URL or saved database field.
  const fragment = DOMPurify.sanitize(String(html || ''), {
    ALLOWED_TAGS: [
      'p','div','br','span','strong','b','em','i','u','s','strike','h1','h2','h3',
      'ul','ol','li','blockquote','table','thead','tbody','tfoot','tr','td','th',
      'img','a','hr',
    ],
    ALLOWED_ATTR: [
      'style','align','src','alt','title','href','colspan','rowspan',
    ],
    RETURN_DOM_FRAGMENT: true,
  });
  const blocks = new Set([
    'P','DIV','H1','H2','H3','UL','OL','LI','BLOCKQUOTE','TD','TH',
  ]);
  const safeLength = (value, max = 240) => {
    const match = /^([0-9]+(?:\.[0-9]+)?)(px|pt|em)$/i.exec((value || '').trim());
    if (!match) return null;
    const unit = match[2].toLowerCase();
    const number = Number(match[1]) * (unit === 'pt' ? 4/3 : unit === 'em' ? 16 : 1);
    return Number.isFinite(number) ? Math.min(max, Math.round(number)) + 'px' : null;
  };
  const safeFamily = (value) => {
    const text = (value || '').toLowerCase();
    if (text.includes('century gothic')) return '"Century Gothic", Arial, sans-serif';
    if (text.includes('times new roman')) return '"Times New Roman", Times, serif';
    if (text.startsWith('georgia')) return 'Georgia, serif';
    if (text.startsWith('arial')) return 'Arial, Helvetica, sans-serif';
    return '';
  };
  for (const node of [...fragment.querySelectorAll('*')]) {
    const tag = node.tagName;
    if (tag === 'IMG' || tag === 'A') {
      const field = tag === 'IMG' ? 'src' : 'href';
      try {
        const url = new URL(node.getAttribute(field) || '');
        if (url.protocol !== 'https:') throw new Error('Unsupported URL scheme.');
        node.setAttribute(field, url.href);
      } catch {
        if (tag === 'IMG') { node.remove(); continue; }
        node.removeAttribute('href');
      }
      if (tag === 'IMG') {
        node.setAttribute('loading', 'lazy');
      } else if (node.hasAttribute('href')) {
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
    if (tag === 'TD' || tag === 'TH') {
      for (const attr of ['colspan','rowspan']) {
        const value = Number(node.getAttribute(attr));
        if (!Number.isInteger(value) || value < 1 || value > 20) node.removeAttribute(attr);
      }
    }
    const alignment = (node.style.textAlign || node.getAttribute('align') || '').toLowerCase().trim();
    const margin = node.style.marginLeft;
    const indent = node.style.textIndent;
    const fontFamily = node.style.fontFamily;
    const fontSize = node.style.fontSize;
    const color = node.style.color;
    node.removeAttribute('style');
    node.removeAttribute('align');
    if (blocks.has(tag)) {
      if (['left','right','center','justify'].includes(alignment)) node.style.textAlign = alignment;
      const marginPx = safeLength(margin);
      const indentPx = safeLength(indent);
      if (marginPx) node.style.marginLeft = marginPx;
      if (indentPx) node.style.textIndent = indentPx;
    }
    if (tag === 'SPAN') {
      if (safeFamily(fontFamily)) node.style.fontFamily = safeFamily(fontFamily);
      const size = safeLength(fontSize, 64);
      if (size && parseInt(size, 10) >= 8) node.style.fontSize = size;
      // Keep a very small, explicit palette rather than arbitrary pasted CSS.
      if (/^#[0-9a-f]{6}$/i.test(color)) node.style.color = color;
    }
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
