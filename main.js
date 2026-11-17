import './styles.css';
import './creative-classroom.css';
import {
  configured, supabase, SUBJECTS, META, el, button,
  safeNote, safeHttpUrl, youtubeId, ordered, isActiveFolder,
  allAncestors, check, message,
} from './lib.js';
import { mountTeaching } from './teaching.js';
import { exportWord, printDocument } from './export.js';
import { createDocumentEditor } from './editor.js';

const root = document.getElementById('app');
const state = {
  user: null, teacher: false, folders: [], materials: [],
  folderId: null, trash: false, search: '', loading: true,
};
let toastTimeout;

function toast(text, error = false) {
  document.querySelector('.toast')?.remove();
  const node = el('div', `toast ${error ? 'toast-error' : ''}`, text);
  document.body.append(node);
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => node.remove(), 6000);
}
function fail(error) { console.error(error); toast(message(error), true); }
async function perform(operation, success) {
  try { await operation(); if (success) toast(success); await loadData(); renderLibrary(); }
  catch (error) { fail(error); }
}
function activeFolders() { return state.folders.filter((item) => isActiveFolder(item, state.folders)); }
function activeMaterials() {
  const allowed = new Set(activeFolders().map((folder) => folder.id));
  return state.materials.filter((item) => !item.deleted_at && allowed.has(item.folder_id));
}
function currentFolder() { return activeFolders().find((folder) => folder.id === state.folderId); }
function children(parentId) { return ordered(activeFolders().filter((folder) => folder.parent_id === parentId)); }
function folderPath(folder) { return allAncestors(folder, state.folders).map((item) => item.name).join(' / '); }
function nextPosition(rows) { return Math.max(0, ...rows.map((x) => x.sort_order || 0)) + 10; }
/** Stable classroom colours follow the subject, including nested lesson folders. */
function folderTone(folder) {
  const subject = allAncestors(folder, state.folders)[0] || folder;
  const label = subject.name.toLowerCase();
  if (/^(bm|bahasa melayu)\b/.test(label)) return /\b6\b|tahun 6/.test(label) ? 'lavender' : 'peach';
  if (/^(pj|pk|pjpk|pendidikan jasmani|pendidikan kesihatan)\b/.test(label)) return /\b3\b|tahun 3/.test(label) ? 'yellow' : 'mint';
  const tones = ['mint', 'lavender', 'peach', 'yellow'];
  const hash = Array.from(subject.name).reduce((sum, letter) => sum + letter.codePointAt(0), 0);
  return tones[hash % tones.length];
}

const QUICK_RECENT = 'teaching-hub-recent-v1';
const QUICK_PINNED = 'teaching-hub-pinned-v1';
function readFolderIds(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string').slice(0, 12) : [];
  } catch { return []; }
}
function writeFolderIds(key, ids) {
  try { localStorage.setItem(key, JSON.stringify(ids.slice(0, 12))); }
  catch { /* Bookmarks are optional if storage is unavailable. */ }
}
function visitFolder(id) {
  writeFolderIds(QUICK_RECENT, [id, ...readFolderIds(QUICK_RECENT).filter((old) => old !== id)]);
}
function togglePinned(id) {
  const stored = readFolderIds(QUICK_PINNED);
  const pinned = stored.includes(id);
  writeFolderIds(QUICK_PINNED, pinned ? stored.filter((x) => x !== id) : [id, ...stored]);
  renderLibrary();
}
function renderQuickAccess(main) {
  const visible = new Map(activeFolders().map((folder) => [folder.id, folder]));
  const addSection = (title, ids) => {
    const chosen = ids.map((id) => visible.get(id)).filter(Boolean)
      .filter((folder) => activeMaterials().some((m) => m.folder_id === folder.id))
      .slice(0, 5);
    if (!chosen.length) return;
    const section = el('section', 'quick-section');
    section.append(el('h2', 'section-title', title));
    const list = el('div', 'quick-grid');
    chosen.forEach((folder) => {
      const open = button('', () => openFolder(folder.id), `quick-card tone-${folderTone(folder)}`);
      open.append(el('span', 'quick-icon', '📂'));
      const copy = el('span', 'quick-copy');
      copy.append(el('strong', '', folder.name), el('small', '', folderPath(folder)));
      open.append(copy, el('span', 'quick-chevron', '›'));
      list.append(open);
    });
    section.append(list);
    main.append(section);
  };
  addSection('★ Pinned lessons', readFolderIds(QUICK_PINNED));
  addSection('↺ Recently used', readFolderIds(QUICK_RECENT));
}


async function loadData() {
  const [folders, materials] = await Promise.all([
    supabase.from('folders').select('*').order('sort_order'),
    supabase.from('materials').select('*').order('sort_order'),
  ]);
  state.folders = await check(folders);
  state.materials = await check(materials);
}
async function bootstrapSubjects() {
  if (!state.teacher || state.folders.some((folder) => folder.owner_id === state.user.id)) return;
  await check(await supabase.from('folders').insert(SUBJECTS.map((name, i) => ({
    name, owner_id: state.user.id, sort_order: (i + 1) * 10, is_public: true,
  }))));
  await loadData();
}
async function initialize() {
  if (!configured) { renderSetup(); return; }
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error && error.name !== 'AuthSessionMissingError') throw error;
    state.user = user;
    if (user) {
      const permission = await supabase.rpc('is_teacher');
      state.teacher = Boolean(await check(permission));
    } else state.teacher = false;
    await loadData();
    await bootstrapSubjects();
    state.loading = false;
    const sharedFolder = new URLSearchParams(location.search).get('lesson');
    if (sharedFolder) {
      const folder = activeFolders().find((item) => item.id === sharedFolder);
      if (folder && activeMaterials().some((item) => item.folder_id === folder.id)) {
        state.folderId = folder.id;
        startLesson(folder);
        return;
      }
    }
    renderLibrary();
  } catch (error) {
    state.loading = false;
    root.replaceChildren();
    const panel = el('section', 'startup-error');
    panel.append(el('h1', '', 'Could not open your teaching library'),
      el('p', '', message(error)),
      el('p', '', 'Check that the Supabase SQL schema has been installed and your Vercel environment variables are correct.'),
      button('Try again', initialize, 'button primary'));
    root.append(panel);
  }
}

function renderSetup() {
  const panel = el('section', 'startup-error');
  panel.append(el('div', 'brand-symbol', '✳'), el('h1', '', 'My Teaching Hub'),
    el('p', '', 'The website is built, but it still needs your Supabase connection.'),
    el('p', '', 'Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in Vercel Project Settings, then deploy again. Run supabase/schema.sql in the Supabase SQL Editor first.'));
  root.replaceChildren(panel);
}

function menu(actions) {
  const wrap = el('details', 'item-menu');
  const summary = el('summary', '', '⋯');
  summary.setAttribute('aria-label', 'More actions');
  const list = el('div', 'menu-options');
  actions.forEach(([label, action, danger]) => list.append(button(label, () => {
    wrap.open = false; action();
  }, `menu-option ${danger ? 'danger-text' : ''}`)));
  wrap.append(summary, list);
  return wrap;
}

function renderLibrary() {
  if (!configured) return renderSetup();
  root.replaceChildren();
  const outer = el('div', 'library-shell');
  const header = el('header', 'library-header');
  const brand = button('✿  My Teaching Hub', () => { state.folderId = null; state.trash = false; state.search = ''; renderLibrary(); }, 'brand');
  const headerActions = el('div', 'header-actions');
  if (state.teacher) {
    headerActions.append(el('span', 'teacher-pill', 'Editing unlocked'));
    headerActions.append(button('Set / change PIN', showPinSetup, 'button quiet'));
    headerActions.append(button('Recycle Bin', () => { state.trash = true; renderLibrary(); }, 'button quiet'));
    headerActions.append(button('🔒 Lock editing', async () => {
      await supabase.auth.signOut(); state.user = null; state.teacher = false;
      state.folderId = null; await loadData(); renderLibrary();
    }, 'button quiet'));
  } else {
    headerActions.append(el('span', 'viewer-pill', 'View & annotate freely'));
    headerActions.append(button('🔓 Unlock editing', showLogin, 'button outline'));
  }
  header.append(brand, headerActions);
  const content = el('div', 'library-layout');
  const sidebar = el('aside', 'library-sidebar');
  sidebar.append(el('div', 'sidebar-label', 'YOUR SUBJECTS'));
  sidebar.append(button('⌂  All subjects', () => { state.folderId = null; state.trash = false; state.search = ''; renderLibrary(); }, `sidebar-link ${!state.folderId && !state.trash ? 'on' : ''}`));
  children(null).forEach((folder) => sidebar.append(button(`▣  ${folder.name}`, () => openFolder(folder.id), `sidebar-link tone-${folderTone(folder)} ${allAncestors(currentFolder(), state.folders).some((f) => f.id === folder.id) ? 'on' : ''}`)));
  if (state.teacher) sidebar.append(button('＋  New subject', () => createFolder(null), 'sidebar-link create-link'));
  const main = el('main', 'library-main');
  if (state.trash) renderTrash(main);
  else if (state.search) renderSearch(main);
  else renderFolder(main);
  content.append(sidebar, main);
  const footer = el('footer', 'library-site-footer', 'Prepared on your tablet. Ready for your smartboard.');
  outer.append(header, content, footer);
  root.append(outer);
}

function openFolder(id) {
  state.folderId = id;
  state.trash = false; state.search = '';
  history.replaceState(null, '', location.pathname);
  renderLibrary();
}

function renderFolder(main) {
  const current = currentFolder();
  const breadcrumb = el('nav', 'breadcrumbs');
  breadcrumb.append(button('All subjects', () => openFolder(null), 'crumb'));
  if (current) allAncestors(current, state.folders).forEach((folder) => {
    breadcrumb.append(el('span', 'crumb-separator', '/'));
    breadcrumb.append(button(folder.name, () => openFolder(folder.id), 'crumb'));
  });
  main.append(breadcrumb);
  const hero = el('div', 'folder-hero');
  const heroText = el('div');
  heroText.append(el('div', 'eyebrow', current ? 'TEACHING COLLECTION' : 'WELCOME TO YOUR LIBRARY'));
  heroText.append(el('h1', '', current?.name || 'Your teaching materials, all together.'));
  heroText.append(el('p', 'subtext', current
    ? 'Keep your notes, PDFs, videos and learning links together in teaching order.'
    : 'Choose a subject to open its lessons. No searching on the smartboard.'));
  hero.append(heroText);
  const heroActions = el('div', 'hero-actions');
  if (state.teacher) {
    heroActions.append(button('＋ New folder', () => createFolder(current?.id || null), 'button outline'));
    if (current) {
      heroActions.append(button('＋ Add material', () => showMaterialEditor(current.id), 'button primary'));
      heroActions.append(menu([
        ['Rename folder', () => renameFolder(current)],
        ['Move folder', () => showMoveFolder(current)],
        ['Duplicate lesson folder', () => duplicateLessonFolder(current)],
        [current.is_public ? 'Unpublish from classroom' : 'Publish to classroom', () => togglePublish(current)],
        ['Move to Recycle Bin', () => trashRow('folders', current), true],
      ]));
    }
  }
  if (current) {
    const lessonItems = ordered(activeMaterials().filter((material) => material.folder_id === current.id));
    if (lessonItems.length) heroActions.append(button('▶ Start lesson', () => startLesson(current), 'button primary start-button'));
    const pinned = readFolderIds(QUICK_PINNED).includes(current.id);
    const pin = button(pinned ? '★ Unpin lesson' : '☆ Pin lesson', () => togglePinned(current.id), 'button outline');
    pin.title = 'Pin this lesson on this device for fast access';
    heroActions.append(pin);
    if (current.is_public) heroActions.append(button('Copy lesson link', () => copyLessonLink(current), 'button quiet'));
  }
  hero.append(heroActions);
  main.append(hero);

  const searchRow = el('div', 'search-row');
  const search = el('input', 'search-input');
  search.type = 'search'; search.placeholder = 'Search your materials…';
  search.setAttribute('aria-label','Search materials');
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && search.value.trim()) { state.search = search.value.trim(); renderLibrary(); }
  });
  searchRow.append(search);
  if (current && state.teacher) searchRow.append(el('span', `publication-label ${current.is_public ? 'published' : ''}`, current.is_public ? '● Published' : '○ Private'));
  const searchButton = button('Search', () => {
    if (search.value.trim()) { state.search = search.value.trim(); renderLibrary(); }
  }, 'button outline');
  searchRow.append(searchButton);
  main.append(searchRow);
  if (!current) renderQuickAccess(main);

  const folders = children(current?.id || null);
  if (folders.length) {
    main.append(el('h2', 'section-title', current ? 'Folders inside this collection' : 'Subjects'));
    const grid = el('div', 'folder-grid');
    folders.forEach((folder) => {
      const card = el('div', `folder-card tone-${folderTone(folder)}`);
      const open = button('', () => openFolder(folder.id), 'folder-card-open');
      open.append(el('span', 'folder-icon', current ? '📁' : '📚'), el('span', 'folder-card-name', folder.name));
      open.append(el('span', 'folder-count', `${children(folder.id).length} folders · ${activeMaterials().filter((m) => m.folder_id === folder.id).length} materials`));
      card.append(open);
      if (state.teacher) card.append(menu([
        ['Rename', () => renameFolder(folder)],
        ['Move', () => showMoveFolder(folder)],
        ['Duplicate folder', () => duplicateLessonFolder(folder)],
        [folder.is_public ? 'Unpublish' : 'Publish', () => togglePublish(folder)],
        ['Move to Recycle Bin', () => trashRow('folders', folder), true],
      ]));
      grid.append(card);
    });
    main.append(grid);
  }
  const materials = current ? ordered(activeMaterials().filter((item) => item.folder_id === current.id)) : [];
  if (current) {
    const heading = el('div', 'material-heading');
    heading.append(el('h2', 'section-title', 'Lesson materials'));
    heading.append(el('span', 'muted', `${materials.length} items · in teaching order`));
    main.append(heading);
    if (!materials.length) {
      const empty = el('section', 'empty-state');
      empty.append(el('div', 'empty-icon', '✎'), el('h3', '', 'Your lesson starts here'),
        el('p', '', state.teacher ? 'Add a note, PDF, YouTube video or learning link to this folder.' : 'No published teaching materials in this folder yet.'));
      if (state.teacher) empty.append(button('＋ Add first material', () => showMaterialEditor(current.id), 'button primary'));
      main.append(empty);
    } else {
      const list = el('div', 'material-list');
      const itemsForOrder = materials;
      materials.forEach((material, index) => {
        const row = el('div', 'material-row');
        const open = button('', () => startLesson(current, material.id), 'material-open');
        open.append(el('span', `material-icon kind-${material.kind}`, material.kind === 'note' ? '≡' : material.kind === 'pdf' ? 'PDF' : material.kind === 'image' ? '▧' : material.kind === 'audio' ? '♪' : material.kind === 'youtube' ? '▶' : '↗'));
        const text = el('span', 'material-copy');
        text.append(el('span', 'material-name', material.title), el('span', 'material-type', META[material.kind].label));
        open.append(text);
        row.append(open);
        if (state.teacher) {
          const handle = el('span', 'drag-handle', '⋮⋮');
          handle.draggable = true;
          handle.title = 'Drag to change the teaching order (or use the arrow buttons)';
          handle.setAttribute('aria-label', handle.title);
          handle.addEventListener('dragstart', (event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/x-teachinghub-material-order', String(index));
            row.classList.add('is-dragging');
          });
          handle.addEventListener('dragend', () => row.classList.remove('is-dragging'));
          row.addEventListener('dragover', (event) => {
            if (!Array.from(event.dataTransfer.types).includes('application/x-teachinghub-material-order')) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            row.classList.add('drag-over');
          });
          row.addEventListener('dragleave', (event) => {
            if (!row.contains(event.relatedTarget)) row.classList.remove('drag-over');
          });
          row.addEventListener('drop', (event) => {
            event.preventDefault();
            row.classList.remove('drag-over');
            const from = Number(event.dataTransfer.getData('application/x-teachinghub-material-order'));
            if (Number.isInteger(from)) moveMaterial(itemsForOrder, from, index);
          });
          row.prepend(handle);
          const order = el('div', 'reorder-actions');
          const up = button('↑', () => reorder(materials, index, -1), 'mini-button'); up.disabled = index === 0; up.title = 'Move up';
          const down = button('↓', () => reorder(materials, index, 1), 'mini-button'); down.disabled = index === materials.length - 1; down.title = 'Move down';
          order.append(up, down); row.append(order);
          const actions = [
            ['Edit original', () => showMaterialEditor(current.id, material)],
          ];
          if (material.kind === 'note') actions.push(
            ['Download Word (.docx)', () => exportWord(material.title, material.content).catch(fail)],
            ['Print / Save PDF', () => {
              try { printDocument(material.title, material.content); } catch (error) { fail(error); }
            }],
          );
          actions.push(
            ['Move', () => showMoveMaterial(material)],
            ['Duplicate', () => duplicateMaterial(material)],
            ['Move to Recycle Bin', () => trashRow('materials', material), true],
          );
          row.append(menu(actions));
        }
        // Exporting a document is read-only and available without signing in.
        if (!state.teacher && material.kind === 'note') {
          row.append(menu([
            ['Download Word (.docx)', () => exportWord(material.title, material.content).catch(fail)],
            ['Print / Save PDF', () => {
              try { printDocument(material.title, material.content); } catch (error) { fail(error); }
            }],
          ]));
        }
        list.append(row);
      });
      main.append(list);
    }
  }
}

function renderSearch(main) {
  main.append(button('← Back to library', () => { state.search = ''; renderLibrary(); }, 'button quiet'));
  main.append(el('h1', '', `Results for “${state.search}”`));
  const query = state.search.trim().toLocaleLowerCase();
  const folderResults = activeFolders().filter((folder) =>
    folder.name.toLocaleLowerCase().includes(query));
  const materialResults = activeMaterials().filter((item) => {
    if (item.title.toLocaleLowerCase().includes(query)) return true;
    if (item.kind !== 'note') return false;
    const sample = el('div');
    sample.innerHTML = safeNote(item.content || '');
    return (sample.textContent || '').toLocaleLowerCase().includes(query);
  });
  if (!folderResults.length && !materialResults.length) {
    main.append(el('p', 'empty-state', 'No matching lessons or materials found.'));
    return;
  }
  const list = el('div', 'material-list');
  if (folderResults.length) {
    list.append(el('h2', 'section-title', `Folders (${folderResults.length})`));
    folderResults.forEach((folder) => {
      const row = button('', () => openFolder(folder.id), 'search-result');
      row.append(el('span', 'search-main', `▣  ${folder.name}`),
        el('span', 'search-context', folderPath(folder)));
      list.append(row);
    });
  }
  if (materialResults.length) {
    list.append(el('h2', 'section-title', `Materials (${materialResults.length})`));
    materialResults.forEach((item) => {
      const folder = activeFolders().find((f) => f.id === item.folder_id);
      if (!folder) return;
      const row = button('', () => {
        state.search = ''; state.folderId = item.folder_id; startLesson(folder, item.id);
      }, 'search-result');
      row.append(el('span', 'search-main', `${META[item.kind]?.label || 'Material'} · ${item.title}`),
        el('span', 'search-context', folderPath(folder)));
      list.append(row);
    });
  }
  main.append(list);
}

function renderTrash(main) {
  main.append(button('← Back to library', () => { state.trash = false; renderLibrary(); }, 'button quiet'));
  main.append(el('h1', '', 'Recycle Bin'));
  main.append(el('p', 'subtext', 'Items here can be restored. Permanent deletion cannot be undone.'));
  const rows = [
    ...state.folders.filter((f) => f.deleted_at).map((f) => ({ ...f, table: 'folders' })),
    ...state.materials.filter((m) => m.deleted_at).map((m) => ({ ...m, table: 'materials' })),
  ].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
  if (!rows.length) { main.append(el('p', 'empty-state', 'Your Recycle Bin is empty.')); return; }
  const list = el('div', 'material-list');
  rows.forEach((row) => {
    const item = el('div', 'trash-row');
    item.append(el('span', 'material-name', `${row.table === 'folders' ? '▣' : '≡'} ${row.name || row.title}`));
    item.append(button('Restore', () => perform(async () => {
      if (row.table === 'folders' && row.parent_id) {
        const parent = state.folders.find((f) => f.id === row.parent_id);
        if (parent?.deleted_at) throw new Error('Restore the parent folder first.');
      }
      if (row.table === 'materials') {
        const folder = state.folders.find((f) => f.id === row.folder_id);
        if (folder?.deleted_at) throw new Error('Restore its folder first.');
      }
      await check(await supabase.from(row.table).update({ deleted_at: null }).eq('id',row.id));
    }, 'Item restored'), 'button outline'));
    item.append(button('Delete permanently', () => {
      if (!window.confirm(`Permanently delete “${row.name || row.title}”${row.table === 'folders' ? ' and everything inside it' : ''}? This cannot be undone.`)) return;
      perform(async () => {
        await check(await supabase.from(row.table).delete().eq('id',row.id));
      }, 'Permanently deleted');
    }, 'button danger-outline'));
    list.append(item);
  });
  main.append(list);
}

function modal(title) {
  const overlay = el('div', 'modal-cover');
  const dialog = el('section', 'modal');
  dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-modal','true');
  const head = el('div', 'modal-header');
  head.append(el('h2', '', title));
  const close = button('×', null, 'close-modal');
  close.onclick = () => overlay.remove();
  close.setAttribute('aria-label', 'Close');
  head.append(close);
  dialog.append(head); overlay.append(dialog);
  document.body.append(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  return { overlay, dialog, close };
}
function formLine(label, control) {
  const field = el('label', 'form-field');
  field.append(el('span', '', label), control);
  return field;
}

function showLogin() {
  const { overlay, dialog } = modal('Unlock editing with your PIN');
  dialog.append(el('p', 'modal-description',
    'Viewing, annotating, and clearing markings never need a PIN. Enter your editor passcode only when changing original materials. Use at least 8 characters.'));
  const pinInput = el('input', 'text-field');
  pinInput.type = 'password'; pinInput.inputMode = 'numeric';
  pinInput.autocomplete = 'current-password'; pinInput.minLength = 8;
  pinInput.placeholder = 'Editor PIN or passcode';
  const feedback = el('p', 'save-status', '');
  const submit = button('Unlock editing', async () => {
    const pin = pinInput.value;
    if (pin.length < 8) {
      feedback.textContent = 'Use a PIN of at least 8 digits, or a longer passphrase.';
      return;
    }
    submit.disabled = true; feedback.textContent = 'Checking passcode…';
    try {
      const response = await fetch('/api/editor-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ pin }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not unlock editing.');
      await check(await supabase.auth.setSession({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
      }));
      pinInput.value = '';
      overlay.remove();
      await initialize();
    } catch (error) {
      feedback.textContent = message(error);
      submit.disabled = false;
    }
  }, 'button primary full');
  pinInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit.click();
  });
  dialog.append(formLine('Editing passcode', pinInput), feedback, submit,
    button('First-time setup or forgot PIN?', () => { overlay.remove(); showPinRecovery(); }, 'button quiet full'),
    el('p', 'field-hint', 'For everyday editing, the PIN replaces email links. Configure EDITOR_EMAIL in Vercel once. The PIN itself is never saved in website code.'));
}

function showPinRecovery() {
  const { dialog } = modal('Set up or recover your PIN');
  dialog.append(el('p', 'modal-description',
    'This is a one-time account recovery step, not your everyday login. Enter your approved teacher email to receive a secure reset link.'));
  const email = el('input', 'text-field');
  email.type = 'email'; email.autocomplete = 'email'; email.placeholder = 'Approved teacher email';
  const feedback = el('p', 'save-status');
  const submit = button('Send PIN setup / reset link', async () => {
    if (!email.validity.valid) { feedback.textContent = 'Enter a valid email address.'; return; }
    submit.disabled = true;
    feedback.textContent = 'Sending…';
    try {
      await check(await supabase.auth.resetPasswordForEmail(email.value.trim(), {
        redirectTo: `${location.origin}${location.pathname}`,
      }));
      feedback.textContent = 'Check your email once. Open the link on this device to set your new PIN.';
    } catch (error) {
      feedback.textContent = message(error);
      submit.disabled = false;
    }
  }, 'button primary full');
  dialog.append(formLine('Recovery email', email), feedback, submit);
}

function showPinSetup() {
  if (!state.teacher) return;
  const { dialog } = modal('Set or change your editing PIN');
  dialog.append(el('p', 'modal-description',
    'Use at least 8 digits (10 or more recommended), or a longer passphrase. This is saved securely in Supabase Auth, not in website code. Do not use a short 4-digit PIN.'));
  const first = el('input', 'text-field');
  first.type = 'password'; first.inputMode = 'numeric';
  first.autocomplete = 'new-password'; first.minLength = 8; first.maxLength = 128;
  const second = el('input', 'text-field');
  second.type = 'password'; second.inputMode = 'numeric'; second.autocomplete = 'new-password';
  const feedback = el('p', 'save-status');
  const save = button('Save editing PIN', async () => {
    if (first.value.length < 8 || first.value.length > 128) {
      feedback.textContent = 'PIN must be at least 8 characters long.'; return;
    }
    if (first.value !== second.value) {
      feedback.textContent = 'The two passcodes do not match.'; return;
    }
    save.disabled = true; feedback.textContent = 'Saving securely…';
    try {
      await check(await supabase.auth.updateUser({ password: first.value }));
      first.value = ''; second.value = '';
      feedback.textContent = 'PIN set in Supabase. Add EDITOR_EMAIL as a private Vercel environment variable before testing PIN unlock on a new device.';
      toast('Editing passcode saved.');
    } catch (error) {
      feedback.textContent = message(error);
    } finally { save.disabled = false; }
  }, 'button primary full');
  dialog.append(formLine('New PIN or passcode', first),
    formLine('Repeat PIN or passcode', second), feedback, save);
}

async function createFolder(parentId) {
  if (!state.teacher) return;
  const name = window.prompt(parentId ? 'New folder name (for your lesson or topic):' : 'New subject name:');
  if (!name?.trim()) return;
  const rows = state.folders.filter((folder) => folder.parent_id === parentId);
  await perform(async () => {
    await check(await supabase.from('folders').insert({
      owner_id: state.user.id, parent_id: parentId,
      name: name.trim(), sort_order: nextPosition(rows), is_public: true,
    }));
  }, 'Folder created');
}
function renameFolder(folder) {
  const name = window.prompt('Rename folder:', folder.name);
  if (!name?.trim() || name.trim() === folder.name) return;
  perform(async () => { await check(await supabase.from('folders').update({name:name.trim()}).eq('id',folder.id)); }, 'Folder renamed');
}
function trashRow(table, row) {
  perform(async () => {
    await check(await supabase.from(table).update({ deleted_at: new Date().toISOString() }).eq('id', row.id));
    if (table === 'folders' && state.folderId === row.id) state.folderId = row.parent_id;
  }, 'Moved to Recycle Bin. You can restore it later.');
}

function selector(destination, excludingId) {
  const select = el('select', 'text-field');
  const option = (value, label) => { const item = el('option','',label); item.value = value; select.append(item); };
  activeFolders().filter((folder) => {
    if (!excludingId) return true;
    return !allAncestors(folder, state.folders).some((parent) => parent.id === excludingId);
  }).forEach((folder) => option(folder.id, folderPath(folder)));
  if (destination) select.value = destination;
  return select;
}
function showMoveFolder(folder) {
  const { overlay, dialog } = modal(`Move “${folder.name}”`);
  const select = selector(folder.parent_id, folder.id);
  const rootOption = el('option', '', 'Top-level subjects'); rootOption.value = ''; select.prepend(rootOption);
  if (!folder.parent_id) select.value = '';
  dialog.append(formLine('Destination', select), button('Move folder', () => perform(async () => {
    await check(await supabase.from('folders').update({parent_id:select.value || null}).eq('id',folder.id));
    overlay.remove();
  }, 'Folder moved'), 'button primary full'));
}
function showMoveMaterial(material) {
  const { overlay, dialog } = modal(`Move “${material.title}”`);
  const select = selector(material.folder_id);
  dialog.append(formLine('Move into folder', select), button('Move material', () => perform(async () => {
    await check(await supabase.from('materials').update({folder_id:select.value}).eq('id',material.id));
    overlay.remove();
  }, 'Material moved'), 'button primary full'));
}
async function togglePublish(folder) {
  const next = !folder.is_public;
  await perform(async () => {
    const lineage = next ? allAncestors(folder, state.folders) : [folder];
    for (const entry of lineage) {
      await check(await supabase.from('folders').update({ is_public: next }).eq('id',entry.id));
    }
  }, next ? 'Folder published for classroom viewing.' : 'Folder hidden from classroom view.');
}
async function copyLessonLink(folder) {
  const url = `${location.origin}${location.pathname}?lesson=${encodeURIComponent(folder.id)}`;
  try { await navigator.clipboard.writeText(url); toast('Classroom link copied.'); }
  catch { window.prompt('Copy this classroom link:',url); }
}
function startLesson(folder, selectedId) {
  const items = ordered(activeMaterials().filter((item) => item.folder_id === folder.id));
  if (!items.length) return toast('Add materials to this folder first.');
  state.folderId = folder.id;
  visitFolder(folder.id);
  mountTeaching(root, folder, items, selectedId, () => {
    history.replaceState(null, '', location.pathname);
    renderLibrary();
  });
}

function moveMaterial(items, sourceIndex, targetIndex) {
  if (!state.teacher || sourceIndex === targetIndex ||
      sourceIndex < 0 || sourceIndex >= items.length ||
      targetIndex < 0 || targetIndex >= items.length) return;
  const arranged = [...items];
  const [moved] = arranged.splice(sourceIndex, 1);
  arranged.splice(targetIndex, 0, moved);
  perform(async () => {
    for (let i = 0; i < arranged.length; i++) {
      const expectedOrder = (i + 1) * 10;
      if (arranged[i].sort_order !== expectedOrder) {
        await check(await supabase.from('materials')
          .update({ sort_order: expectedOrder }).eq('id', arranged[i].id));
      }
    }
  }, 'Teaching order updated');
}
function reorder(items, index, direction) {
  const other = items[index + direction];
  if (!other) return;
  const first = items[index];
  const a = first.sort_order;
  const b = other.sort_order;
  perform(async () => {
    if (a === b) {
      const reordered = [...items];
      [reordered[index], reordered[index + direction]] = [reordered[index + direction], reordered[index]];
      for (let i = 0; i < reordered.length; i++) await check(await supabase.from('materials').update({sort_order:(i + 1) * 10}).eq('id',reordered[i].id));
    } else {
      await check(await supabase.from('materials').update({sort_order:b}).eq('id',first.id));
      await check(await supabase.from('materials').update({sort_order:a}).eq('id',other.id));
    }
  });
}
async function duplicateLessonFolder(source) {
  if (!state.teacher) return;
  const name = source.name.length > 113 ? source.name.slice(0, 113) : source.name;
  if (!window.confirm(`Copy “${source.name}” and its subfolders/materials? The copy starts private so you can review it before publishing.`)) return;
  let createdRoot = null;
  await perform(async () => {
    const copyBranch = async (folder, parentId, depth) => {
      if (depth > 15) throw new Error('This folder hierarchy is too deep to duplicate safely.');
      const siblingPosition = depth === 0
        ? nextPosition(state.folders.filter((f) => f.parent_id === parentId))
        : folder.sort_order;
      const created = await check(await supabase.from('folders').insert({
        owner_id: state.user.id,
        parent_id: parentId,
        name: depth === 0 ? `${name} (copy)` : folder.name,
        sort_order: siblingPosition,
        is_public: depth === 0 ? false : folder.is_public,
      }).select('id').single());
      if (depth === 0) createdRoot = created.id;
      const originals = ordered(activeMaterials().filter((material) => material.folder_id === folder.id));
      if (originals.length) {
        await check(await supabase.from('materials').insert(originals.map((material) => ({
          owner_id: state.user.id,
          folder_id: created.id,
          kind: material.kind,
          title: material.title,
          content: material.content || '',
          url: material.url || '',
          storage_path: material.storage_path || null,
          sort_order: material.sort_order,
        }))));
      }
      for (const child of children(folder.id)) {
        await copyBranch(child, created.id, depth + 1);
      }
    };
    try {
      await copyBranch(source, source.parent_id, 0);
    } catch (error) {
      // Only undo the freshly-created copy, never the original.
      if (createdRoot) {
        try { await check(await supabase.from('folders').delete().eq('id', createdRoot)); }
        catch { /* The user can remove the incomplete copy from the library. */ }
      }
      throw error;
    }
  }, 'Lesson folder duplicated privately. Review it before publishing.');
}
function duplicateMaterial(item) {
  perform(async () => {
    await check(await supabase.from('materials').insert({
      owner_id:state.user.id, folder_id:item.folder_id,
      kind:item.kind, title:`${item.title} (copy)`, content:item.content,
      url:item.url, storage_path:item.storage_path,
      sort_order:nextPosition(state.materials.filter((m) => m.folder_id === item.folder_id)),
    }));
  }, 'Material duplicated');
}

function showMaterialEditor(folderId, existing = null) {
  const { overlay, dialog, close } = modal(existing ? 'Edit material' : 'Add teaching material');
  dialog.classList.add('material-modal');
  const kind = el('select', 'text-field');
  [['note','Editable document'],['pdf','PDF document'],['image','Picture / image'],['audio','Audio / recording'],['youtube','YouTube video'],['link','Website link']].forEach(([value,label]) => {
    const option = el('option','',label); option.value = value; kind.append(option);
  });
  kind.value = existing?.kind || 'note';
  kind.disabled = Boolean(existing);
  const title = el('input','text-field'); title.type='text'; title.placeholder='e.g. Nota Isi Penting'; title.value=existing?.title || '';
  const dynamic = el('div','dynamic-fields');
  const feedback = el('p','save-status','Not saved yet');
  // Rich text stays in the existing materials.content HTML field.
  // New inline pictures are uploaded only by approved editors.
  const newDocumentImages = new Set();
  const uploadDocumentImage = async (file) => {
    const suffix = file.name.split('.').pop()?.toLowerCase();
    const types = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', webp: 'image/webp',
    };
    if (!types[suffix] || file.size > 10 * 1024 * 1024 ||
        (file.type && file.type !== types[suffix])) {
      throw new Error('Use a JPG, PNG, WebP or GIF image smaller than 10 MB.');
    }
    const path = state.user.id + '/' + crypto.randomUUID() + '.' + suffix;
    await check(await supabase.storage.from('teaching-media')
      .upload(path, file, { contentType: types[suffix], upsert: false }));
    newDocumentImages.add(path);
    return supabase.storage.from('teaching-media').getPublicUrl(path).data.publicUrl;
  };
  const discardNewImages = () => {
    if (!newDocumentImages.size) return;
    const images = [...newDocumentImages];
    newDocumentImages.clear();
    Promise.all(images.map((path) =>
      supabase.storage.from('teaching-media').remove([path])
    )).catch((error) => console.warn('Unsaved image cleanup', error));
  };
  let richEditor = null;
  const docEditor = createDocumentEditor({
    initialHTML: existing?.content || '<p></p>',
    onUploadImage: uploadDocumentImage,
    onChange: () => richEditor?.dispatchEvent(new Event('input', { bubbles: true })),
    onNotice: (notice, failed = false) => {
      feedback.textContent = notice;
      if (failed) toast(notice, true);
    },
  });
  richEditor = docEditor.element;
  const initialDocumentHTML = docEditor.getHTML();
  const draftKey = 'teaching-hub-note-draft:' + state.user.id + ':' + (existing?.id || folderId + ':new');
  let previousDraft = null;
  try { previousDraft = JSON.parse(sessionStorage.getItem(draftKey) || 'null'); }
  catch { /* Draft recovery may be unavailable in private browsing. */ }
  const draftPrompt = el('div', 'draft-prompt');
  if (previousDraft?.kind === 'note' &&
      (previousDraft.html !== initialDocumentHTML || previousDraft.title !== title.value)) {
    const restore = button('↶ Restore unsaved document draft', () => {
      title.value = previousDraft.title || '';
      docEditor.setHTML(previousDraft.html || '<p></p>');
      richEditor.dispatchEvent(new Event('input', { bubbles: true }));
      draftPrompt.replaceChildren(el('span', 'field-hint',
        'Draft restored. Save the document to keep these changes online.'));
    }, 'button outline');
    draftPrompt.append(el('p', 'field-hint',
      'An unsaved document draft from this browser session was found.'), restore);
  }
  const urlInput = el('input','text-field'); urlInput.type='url'; urlInput.placeholder='https://'; urlInput.value=existing?.url || '';
  const fileInput = el('input','file-input'); fileInput.type='file'; fileInput.accept='application/pdf,.pdf';
  const mediaInput = el('input','file-input'); mediaInput.type='file';
  const exportActions = el('div', 'document-export-actions');
  exportActions.append(
    button('Download Word (.docx)', () => {
      exportWord(title.value.trim() || 'Untitled document', docEditor.getHTML()).catch(fail);
    }, 'button quiet'),
    button('Print / Save PDF', () => {
      try { printDocument(title.value.trim() || 'Untitled document', docEditor.getHTML()); }
      catch (error) { fail(error); }
    }, 'button quiet'),
  );
  function switchFields() {
    dynamic.replaceChildren();
    if (kind.value === 'note') dynamic.append(
      el('p', 'field-hint', 'Paste or type here. Use Tab / Shift+Tab to indent or outdent paragraphs. Save material keeps the document online; exporting downloads a separate copy.'),
      richEditor,draftPrompt,exportActions,
    );
    else if (kind.value === 'pdf') {
      dynamic.append(formLine('Upload a PDF (recommended; max 25 MB)',fileInput));
      dynamic.append(el('p','field-hint','Or paste a direct HTTPS PDF URL. Google Drive sharing links often cannot load in the PDF viewer.'));
      dynamic.append(formLine('PDF URL (optional when uploading)',urlInput));
    } else if (kind.value === 'image' || kind.value === 'audio') {
      mediaInput.accept = kind.value === 'image' ? 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif' : 'audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/ogg,audio/webm,audio/aac,.mp3,.m4a,.wav,.ogg,.webm,.aac';
      dynamic.append(formLine(kind.value === 'image' ? 'Upload a picture (max 25 MB)' : 'Upload an audio recording (max 25 MB)', mediaInput));
      dynamic.append(el('p', 'field-hint', 'Or paste a direct public HTTPS media URL. Uploaded media is viewable by anyone using Teaching Hub.'));
      dynamic.append(formLine('Picture / audio URL (optional when uploading)', urlInput));
    } else dynamic.append(formLine(kind.value === 'youtube' ? 'YouTube URL' : 'Website URL',urlInput));
  }
  kind.addEventListener('change',switchFields);
  switchFields();
  let dirty = false;
  let draftTimer = null;
  const saveLocalDraft = () => {
    if (kind.value !== 'note') return;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({
        kind: 'note', title: title.value, html: docEditor.getHTML(),
      }));
    } catch { /* Session draft storage is a convenience, not the primary save. */ }
  };
  const beforeUnload = (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', beforeUnload);
  [title,urlInput,kind,fileInput,mediaInput,richEditor].forEach((field) => field.addEventListener('input', () => {
    dirty = true;
    feedback.textContent = 'Unsaved changes — document draft kept in this tab';
    window.clearTimeout(draftTimer);
    if (kind.value === 'note') draftTimer = window.setTimeout(saveLocalDraft, 350);
  }));
  const dismiss = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    window.clearTimeout(draftTimer);
    window.removeEventListener('beforeunload', beforeUnload);
    try { sessionStorage.removeItem(draftKey); } catch {}
    docEditor.destroy();
    discardNewImages();
    overlay.remove();
  };
  close.onclick = dismiss;
  overlay.onclick = (event) => { if (event.target === overlay) dismiss(); };
  const save = button(existing ? 'Save changes' : 'Save material', async () => {
    if (!title.value.trim()) { feedback.textContent='Please enter a title.'; return; }
    save.disabled=true; feedback.textContent='Saving…';
    let uploadedPath = null;
    let uploadedBucket = null;
    try {
      const data = {
        kind:kind.value, title:title.value.trim(),
        folder_id:folderId, owner_id:state.user.id,
        content:kind.value === 'note' ? docEditor.getHTML() : '',
        url:'', storage_path: existing?.storage_path || null,
      };
      if (kind.value === 'youtube') { youtubeId(urlInput.value); data.url=safeHttpUrl(urlInput.value); }
      if (kind.value === 'link') data.url=safeHttpUrl(urlInput.value);
      if (kind.value === 'pdf') {
        const file = fileInput.files[0];
        if (file) {
          if (!/\.pdf$/i.test(file.name) || file.size > 25 * 1024 * 1024) throw new Error('Choose a PDF no larger than 25 MB.');
          uploadedBucket = 'teaching-pdfs';
          uploadedPath = `${state.user.id}/${crypto.randomUUID()}.pdf`;
          await check(await supabase.storage.from(uploadedBucket).upload(uploadedPath,file,{contentType:'application/pdf'}));
          data.storage_path=uploadedPath;
          data.url=supabase.storage.from('teaching-pdfs').getPublicUrl(uploadedPath).data.publicUrl;
        } else if (urlInput.value.trim()) data.url=safeHttpUrl(urlInput.value);
        else if (existing?.url) data.url=existing.url;
        else throw new Error('Upload a PDF or paste a direct PDF URL.');
      }
      if (kind.value === 'image' || kind.value === 'audio') {
        const file = mediaInput.files[0];
        if (file) {
          const ext = file.name.split('.').pop()?.toLowerCase();
          const permitted = {
            image: { jpg: ['image/jpeg'], jpeg: ['image/jpeg'], png: ['image/png'], webp: ['image/webp'], gif: ['image/gif'] },
            audio: { mp3: ['audio/mpeg'], m4a: ['audio/mp4','audio/x-m4a'], wav: ['audio/wav','audio/x-wav'], ogg: ['audio/ogg'], webm: ['audio/webm'], aac: ['audio/aac'] },
          };
          const types = permitted[kind.value][ext];
          if (!types || (file.type && !types.includes(file.type))) {
            throw new Error('Unsupported media format. Use JPG/PNG/WebP/GIF for pictures or MP3/M4A/WAV/OGG/WebM/AAC for audio.');
          }
          if (file.size > 25 * 1024 * 1024) throw new Error('Maximum media file size is 25 MB.');
          uploadedBucket = 'teaching-media';
          uploadedPath = `${state.user.id}/${crypto.randomUUID()}.${ext}`;
          await check(await supabase.storage.from(uploadedBucket).upload(uploadedPath,file,{contentType: file.type || types[0]}));
          data.storage_path = uploadedPath;
          data.url = supabase.storage.from(uploadedBucket).getPublicUrl(uploadedPath).data.publicUrl;
        } else if (urlInput.value.trim()) data.url = safeHttpUrl(urlInput.value);
        else if (existing?.url) data.url = existing.url;
        else throw new Error('Upload a picture/audio file or paste a direct HTTPS URL.');
      }
      if (existing) await check(await supabase.from('materials').update(data).eq('id',existing.id));
      else await check(await supabase.from('materials').insert({
        ...data, sort_order:nextPosition(state.materials.filter((m) => m.folder_id === folderId)),
      }));
      dirty = false;
      if (kind.value !== 'note') discardNewImages();
      newDocumentImages.clear();
      docEditor.destroy();
      window.clearTimeout(draftTimer);
      window.removeEventListener('beforeunload', beforeUnload);
      try { sessionStorage.removeItem(draftKey); } catch {}
      overlay.remove();
      toast('Saved successfully. Your material is available on other devices.');
      await loadData(); renderLibrary();
    } catch (error) {
      if (uploadedPath) await supabase.storage.from(uploadedBucket || 'teaching-pdfs').remove([uploadedPath]);
      feedback.textContent=`Save failed: ${message(error)}`;
      save.disabled=false;
    }
  },'button primary full');
  richEditor.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!save.disabled) save.click();
    }
  });
  dialog.append(formLine('Material type',kind),formLine('Title',title),dynamic,feedback,save);
}

if (configured) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      window.setTimeout(async () => {
        await initialize();
        if (state.teacher) showPinSetup();
      }, 0);
    } else if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') window.setTimeout(initialize, 0);
  });
}
initialize();
