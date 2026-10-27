import './styles.css';
import {
  configured, supabase, SUBJECTS, META, el, button,
  safeNote, safeHttpUrl, youtubeId, ordered, isActiveFolder,
  allAncestors, check, message,
} from './lib.js';
import { mountTeaching } from './teaching.js';

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
  const brand = button('✳  My Teaching Hub', () => { state.folderId = null; state.trash = false; state.search = ''; renderLibrary(); }, 'brand');
  const headerActions = el('div', 'header-actions');
  if (state.teacher) {
    headerActions.append(el('span', 'teacher-pill', 'Teacher mode'));
    headerActions.append(button('Recycle Bin', () => { state.trash = true; renderLibrary(); }, 'button quiet'));
    headerActions.append(button('Sign out', async () => {
      await supabase.auth.signOut(); state.user = null; state.teacher = false;
      state.folderId = null; await loadData(); renderLibrary();
    }, 'button quiet'));
  } else {
    headerActions.append(el('span', 'viewer-pill', 'Classroom view'));
    headerActions.append(button('Teacher sign in', showLogin, 'button outline'));
  }
  header.append(brand, headerActions);
  const content = el('div', 'library-layout');
  const sidebar = el('aside', 'library-sidebar');
  sidebar.append(el('div', 'sidebar-label', 'YOUR SUBJECTS'));
  sidebar.append(button('⌂  All subjects', () => { state.folderId = null; state.trash = false; state.search = ''; renderLibrary(); }, `sidebar-link ${!state.folderId && !state.trash ? 'on' : ''}`));
  children(null).forEach((folder) => sidebar.append(button(`▣  ${folder.name}`, () => openFolder(folder.id), `sidebar-link ${allAncestors(currentFolder(), state.folders).some((f) => f.id === folder.id) ? 'on' : ''}`)));
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
        [current.is_public ? 'Unpublish from classroom' : 'Publish to classroom', () => togglePublish(current)],
        ['Move to Recycle Bin', () => trashRow('folders', current), true],
      ]));
    }
  }
  if (current) {
    const lessonItems = ordered(activeMaterials().filter((material) => material.folder_id === current.id));
    if (lessonItems.length) heroActions.append(button('▶ Start lesson', () => startLesson(current), 'button primary start-button'));
    if (current.is_public && state.teacher) heroActions.append(button('Copy classroom link', () => copyLessonLink(current), 'button quiet'));
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
  main.append(searchRow);

  const folders = children(current?.id || null);
  if (folders.length) {
    main.append(el('h2', 'section-title', current ? 'Folders inside this collection' : 'Subjects'));
    const grid = el('div', 'folder-grid');
    folders.forEach((folder) => {
      const card = el('div', 'folder-card');
      const open = button('', () => openFolder(folder.id), 'folder-card-open');
      open.append(el('span', 'folder-icon', '▣'), el('span', 'folder-card-name', folder.name));
      open.append(el('span', 'folder-count', `${children(folder.id).length} folders · ${activeMaterials().filter((m) => m.folder_id === folder.id).length} materials`));
      card.append(open);
      if (state.teacher) card.append(menu([
        ['Rename', () => renameFolder(folder)],
        ['Move', () => showMoveFolder(folder)],
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
      materials.forEach((material, index) => {
        const row = el('div', 'material-row');
        const open = button('', () => startLesson(current, material.id), 'material-open');
        open.append(el('span', `material-icon kind-${material.kind}`, material.kind === 'note' ? '≡' : material.kind === 'pdf' ? 'PDF' : material.kind === 'youtube' ? '▶' : '↗'));
        const text = el('span', 'material-copy');
        text.append(el('span', 'material-name', material.title), el('span', 'material-type', META[material.kind].label));
        open.append(text);
        row.append(open);
        if (state.teacher) {
          const order = el('div', 'reorder-actions');
          const up = button('↑', () => reorder(materials, index, -1), 'mini-button'); up.disabled = index === 0; up.title = 'Move up';
          const down = button('↓', () => reorder(materials, index, 1), 'mini-button'); down.disabled = index === materials.length - 1; down.title = 'Move down';
          order.append(up, down); row.append(order);
          row.append(menu([
            ['Edit', () => showMaterialEditor(current.id, material)],
            ['Move', () => showMoveMaterial(material)],
            ['Duplicate', () => duplicateMaterial(material)],
            ['Move to Recycle Bin', () => trashRow('materials', material), true],
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
  const query = state.search.toLocaleLowerCase();
  const results = activeMaterials().filter((item) => item.title.toLocaleLowerCase().includes(query));
  if (!results.length) { main.append(el('p', 'empty-state', 'No matching materials found.')); return; }
  const list = el('div', 'material-list');
  results.forEach((item) => {
    const folder = state.folders.find((f) => f.id === item.folder_id);
    const row = button(`${META[item.kind].label} · ${item.title} — ${folder?.name || 'Folder'}`, () => {
      state.search = ''; state.folderId = item.folder_id; startLesson(folder, item.id);
    }, 'search-result');
    list.append(row);
  });
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
  const { overlay, dialog } = modal('Teacher sign in');
  dialog.append(el('p', 'modal-description', 'Enter the approved teacher email. You will receive a sign-in link; no password is needed.'));
  const email = el('input', 'text-field');
  email.type = 'email'; email.placeholder = 'your@email.com'; email.required = true;
  const feedback = el('p', 'save-status');
  const submit = button('Send sign-in link', async () => {
    if (!email.validity.valid) { feedback.textContent = 'Enter a valid email address.'; return; }
    submit.disabled = true; feedback.textContent = 'Sending…';
    try {
      await check(await supabase.auth.signInWithOtp({
        email: email.value.trim(),
        options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}${location.pathname}` },
      }));
      feedback.textContent = 'Check your inbox and open the sign-in link on this device.';
    } catch (error) { feedback.textContent = message(error); submit.disabled = false; }
  }, 'button primary full');
  dialog.append(formLine('Email', email), feedback, submit);
}

async function createFolder(parentId) {
  if (!state.teacher) return;
  const name = window.prompt(parentId ? 'New folder name (for your lesson or topic):' : 'New subject name:');
  if (!name?.trim()) return;
  const rows = state.folders.filter((folder) => folder.parent_id === parentId);
  await perform(async () => {
    await check(await supabase.from('folders').insert({
      owner_id: state.user.id, parent_id: parentId,
      name: name.trim(), sort_order: nextPosition(rows), is_public: false,
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
  mountTeaching(root, folder, items, selectedId, () => {
    history.replaceState(null, '', location.pathname);
    renderLibrary();
  });
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
  [['note','Text note'],['pdf','PDF document'],['youtube','YouTube video'],['link','Website link']].forEach(([value,label]) => {
    const option = el('option','',label); option.value = value; kind.append(option);
  });
  kind.value = existing?.kind || 'note';
  kind.disabled = Boolean(existing);
  const title = el('input','text-field'); title.type='text'; title.placeholder='e.g. Nota Isi Penting'; title.value=existing?.title || '';
  const dynamic = el('div','dynamic-fields');
  const feedback = el('p','save-status','Not saved yet');
  const richEditor = el('div', 'rich-editor');
  richEditor.contentEditable = 'true';
  richEditor.setAttribute('role','textbox'); richEditor.setAttribute('aria-label','Text note content');
  richEditor.setAttribute('aria-multiline','true');
  richEditor.innerHTML = safeNote(existing?.content || '<p></p>');
  const urlInput = el('input','text-field'); urlInput.type='url'; urlInput.placeholder='https://'; urlInput.value=existing?.url || '';
  const fileInput = el('input','file-input'); fileInput.type='file'; fileInput.accept='application/pdf,.pdf';
  const format = el('div','format-toolbar');
  [['bold','B'],['italic','I'],['insertUnorderedList','• List'],['insertOrderedList','1. List'],['formatBlock','Heading']].forEach(([command,label]) => {
    const control = button(label, () => {
      richEditor.focus();
      document.execCommand(command,false,command === 'formatBlock' ? 'h2' : null);
    }, 'format-button');
    control.addEventListener('pointerdown', (event) => event.preventDefault());
    format.append(control);
  });
  richEditor.addEventListener('paste',(event) => {
    event.preventDefault();
    document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));
  });
  function switchFields() {
    dynamic.replaceChildren();
    if (kind.value === 'note') dynamic.append(format,richEditor);
    else if (kind.value === 'pdf') {
      dynamic.append(formLine('Upload a PDF (recommended; max 25 MB)',fileInput));
      dynamic.append(el('p','field-hint','Or paste a direct HTTPS PDF URL. Google Drive sharing links often cannot load in the PDF viewer.'));
      dynamic.append(formLine('PDF URL (optional when uploading)',urlInput));
    } else dynamic.append(formLine(kind.value === 'youtube' ? 'YouTube URL' : 'Website URL',urlInput));
  }
  kind.addEventListener('change',switchFields);
  switchFields();
  let dirty = false;
  [title,urlInput,kind,fileInput,richEditor].forEach((field) => field.addEventListener('input', () => { dirty=true; feedback.textContent='Unsaved changes'; }));
  const dismiss = () => { if (!dirty || window.confirm('Discard unsaved changes?')) overlay.remove(); };
  close.onclick = dismiss;
  overlay.onclick = (event) => { if (event.target === overlay) dismiss(); };
  const save = button(existing ? 'Save changes' : 'Save material', async () => {
    if (!title.value.trim()) { feedback.textContent='Please enter a title.'; return; }
    save.disabled=true; feedback.textContent='Saving…';
    let uploadedPath = null;
    try {
      const data = {
        kind:kind.value, title:title.value.trim(),
        folder_id:folderId, owner_id:state.user.id,
        content:kind.value === 'note' ? safeNote(richEditor.innerHTML) : '',
        url:'', storage_path: existing?.storage_path || null,
      };
      if (kind.value === 'youtube') { youtubeId(urlInput.value); data.url=safeHttpUrl(urlInput.value); }
      if (kind.value === 'link') data.url=safeHttpUrl(urlInput.value);
      if (kind.value === 'pdf') {
        const file = fileInput.files[0];
        if (file) {
          if (!/\.pdf$/i.test(file.name) || file.size > 25 * 1024 * 1024) throw new Error('Choose a PDF no larger than 25 MB.');
          uploadedPath = `${state.user.id}/${crypto.randomUUID()}.pdf`;
          await check(await supabase.storage.from('teaching-pdfs').upload(uploadedPath,file,{contentType:'application/pdf'}));
          data.storage_path=uploadedPath;
          data.url=supabase.storage.from('teaching-pdfs').getPublicUrl(uploadedPath).data.publicUrl;
        } else if (urlInput.value.trim()) data.url=safeHttpUrl(urlInput.value);
        else if (existing?.url) data.url=existing.url;
        else throw new Error('Upload a PDF or paste a direct PDF URL.');
      }
      if (existing) await check(await supabase.from('materials').update(data).eq('id',existing.id));
      else await check(await supabase.from('materials').insert({
        ...data, sort_order:nextPosition(state.materials.filter((m) => m.folder_id === folderId)),
      }));
      dirty=false; overlay.remove(); toast('Saved successfully. Your material is available on other devices.');
      await loadData(); renderLibrary();
    } catch (error) {
      if (uploadedPath) await supabase.storage.from('teaching-pdfs').remove([uploadedPath]);
      feedback.textContent=`Save failed: ${message(error)}`;
      save.disabled=false;
    }
  },'button primary full');
  dialog.append(formLine('Material type',kind),formLine('Title',title),dynamic,feedback,save);
}

if (configured) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') window.setTimeout(initialize, 0);
  });
}
initialize();
