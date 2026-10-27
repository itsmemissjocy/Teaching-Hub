import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { el, button, META, safeNote, youtubeId, message } from './lib.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

// Temporary classroom ink is deliberately kept separate from the database.
const ink = new Map();
const materialView = new Map();
let lastInkKey = null;

function inkRecord(key) {
  if (!ink.has(key)) ink.set(key, { strokes: [], undo: [], redo: [] });
  return ink.get(key);
}
function checkpoint(record) {
  record.undo.push(structuredClone(record.strokes));
  if (record.undo.length > 40) record.undo.shift();
  record.redo.length = 0;
}
function draw(canvas, key) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  for (const stroke of inkRecord(key).strokes) {
    if (!stroke.points.length) continue;
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = Math.max(1, stroke.width * width);
    ctx.globalAlpha = stroke.mode === 'highlight' ? 0.3 : 1;
    stroke.points.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x * width, y * height);
      else ctx.lineTo(x * width, y * height);
    });
    if (stroke.points.length === 1) {
      const [x, y] = stroke.points[0];
      ctx.arc(x * width, y * height, ctx.lineWidth / 2, 0, 2 * Math.PI);
      ctx.fill();
    } else ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function nearStroke(stroke, point, width, height, limit) {
  const p = [point[0] * width, point[1] * height];
  const coordinates = stroke.points.map(([x, y]) => [x * width, y * height]);
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  if (coordinates.length === 1) return d2(p, coordinates[0]) < limit ** 2;
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1];
    const b = coordinates[i];
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)));
    if (d2(p, [a[0] + t * vx, a[1] + t * vy]) < limit ** 2) return true;
  }
  return false;
}

function attachInk(canvas, key, state) {
  canvas.className = 'ink-layer';
  const record = inkRecord(key);
  let activeStroke = null;
  let pointer = null;
  let eraserChanged = false;
  const pos = (event) => {
    const rect = canvas.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  };
  const eraseAt = (point) => {
    const before = record.strokes.length;
    record.strokes = record.strokes.filter((stroke) =>
      !nearStroke(stroke, point, canvas.clientWidth, canvas.clientHeight, 16 + state.width / 2));
    if (record.strokes.length !== before) eraserChanged = true;
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (state.tool === 'hand' || event.button !== 0) return;
    event.preventDefault();
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    lastInkKey = key;
    checkpoint(record);
    if (state.tool === 'eraser') {
      eraserChanged = false;
      eraseAt(pos(event));
    } else {
      activeStroke = {
        mode: state.tool,
        color: state.color,
        width: state.width / canvas.clientWidth,
        points: [pos(event)],
      };
      record.strokes.push(activeStroke);
    }
    draw(canvas, key);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointer) return;
    event.preventDefault();
    if (state.tool === 'eraser') eraseAt(pos(event));
    else if (activeStroke) activeStroke.points.push(pos(event));
    draw(canvas, key);
  });
  const done = (event) => {
    if (event.pointerId !== pointer) return;
    pointer = null;
    activeStroke = null;
    if (state.tool === 'eraser' && !eraserChanged) record.undo.pop();
    draw(canvas, key);
  };
  canvas.addEventListener('pointerup', done);
  canvas.addEventListener('pointercancel', done);
  state.canvases.set(key, canvas);
  canvas.style.pointerEvents = state.tool === 'hand' ? 'none' : 'auto';
  draw(canvas, key);
}

function modifyInk(key, action, state) {
  const record = inkRecord(key);
  if (action === 'undo' && record.undo.length) {
    record.redo.push(structuredClone(record.strokes));
    record.strokes = record.undo.pop();
  } else if (action === 'redo' && record.redo.length) {
    record.undo.push(structuredClone(record.strokes));
    record.strokes = record.redo.pop();
  } else if (action === 'clear' && record.strokes.length && window.confirm('Clear all handwritten marks on this page? You can undo this.')) {
    checkpoint(record);
    record.strokes = [];
  }
  const canvas = state.canvases.get(key);
  if (canvas) draw(canvas, key);
}

function pageFromScroll(viewer, shells) {
  let chosen = 1;
  let smallest = Infinity;
  shells.forEach((shell, idx) => {
    const distance = Math.abs(shell.offsetTop - viewer.scrollTop);
    if (distance < smallest) { smallest = distance; chosen = idx + 1; }
  });
  return chosen;
}

export function mountTeaching(root, folder, materials, initialId, onExit) {
  if (!materials.length) return;
  const state = { tool: 'hand', color: '#c24b43', width: 4, canvases: new Map(), active: initialId || materials[0].id, zoom: 1, page: 1 };
  let generation = 0;
  let observer = null;
  const shell = el('div', 'teaching-shell');
  const top = el('header', 'teaching-header');
  const title = el('span', 'teaching-title', folder.name);
  const status = el('span', 'teaching-status', '');
  const fullscreen = button('⛶ Full screen', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    } catch { status.textContent = 'Full-screen is unavailable in this browser.'; }
  }, 'button quiet');
  top.append(button('← Library', () => { ++generation; observer?.disconnect(); onExit(); }, 'button quiet'), title, status, fullscreen);
  const tabsWrap = el('nav', 'lesson-tabs');
  tabsWrap.setAttribute('aria-label', 'Lesson materials');
  const toolbar = el('div', 'teaching-tools');
  const viewer = el('main', 'teaching-viewer');
  const footer = el('footer', 'lesson-footer');
  shell.append(top, tabsWrap, toolbar, viewer, footer);
  root.replaceChildren(shell);

  function current() { return materials.find((item) => item.id === state.active) || materials[0]; }
  function remember() {
    materialView.set(state.active, { scroll: viewer.scrollTop, zoom: state.zoom });
  }
  function select(id) {
    if (state.active && state.active !== id) remember();
    state.active = id;
    state.zoom = materialView.get(id)?.zoom || 1;
    state.page = 1;
    render();
  }
  function nav(delta) {
    const idx = materials.findIndex((item) => item.id === state.active);
    if (idx + delta >= 0 && idx + delta < materials.length) select(materials[idx + delta].id);
  }
  function renderTabs() {
    tabsWrap.replaceChildren();
    materials.forEach((item, i) => {
      const tab = button(`${i + 1}. ${item.title}`, () => select(item.id), `lesson-tab ${item.id === state.active ? 'selected' : ''}`);
      tab.title = `${META[item.kind]?.label || ''} · ${item.title}`;
      tabsWrap.append(tab);
    });
    tabsWrap.querySelector('.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function inkKey() { return lastInkKey?.startsWith(`${state.active}:`) ? lastInkKey : `${state.active}:${state.page}`; }
  function renderToolbar() {
    toolbar.replaceChildren();
    const item = current();
    if (item.kind === 'pdf' || item.kind === 'note') {
      const tools = [['hand','✋ Scroll'],['pen','✎ Pen'],['highlight','▰ Highlight'],['eraser','⌫ Erase']];
      tools.forEach(([name, label]) => toolbar.append(button(label, () => {
        state.tool = name;
        state.canvases.forEach((canvas) => { canvas.style.pointerEvents = name === 'hand' ? 'none' : 'auto'; });
        renderToolbar();
      }, `tool-button ${state.tool === name ? 'active' : ''}`)));
      toolbar.append(button('↶', () => modifyInk(inkKey(), 'undo', state), 'tool-button icon-only'));
      toolbar.append(button('↷', () => modifyInk(inkKey(), 'redo', state), 'tool-button icon-only'));
      const color = el('input', 'color-input'); color.type = 'color'; color.value = state.color;
      color.title = 'Pen colour'; color.setAttribute('aria-label','Pen colour');
      color.addEventListener('input', () => { state.color = color.value; });
      toolbar.append(color);
      const sizes = el('select', 'thickness');
      [[3,'Thin'],[5,'Medium'],[9,'Thick']].forEach(([value, label]) => {
        const option = el('option', '', label); option.value = value; option.selected = state.width === value; sizes.append(option);
      });
      sizes.title = 'Pen thickness'; sizes.addEventListener('change', () => { state.width = Number(sizes.value); });
      toolbar.append(sizes);
      toolbar.append(button('Clear page', () => modifyInk(inkKey(), 'clear', state), 'tool-button secondary-tool'));
      if (item.kind === 'pdf') {
        toolbar.append(el('span', 'tool-separator'));
        toolbar.append(button('−', () => changeZoom(0.8), 'tool-button icon-only'));
        toolbar.append(el('span', 'zoom-label', `${Math.round(state.zoom * 100)}%`));
        toolbar.append(button('+', () => changeZoom(1.25), 'tool-button icon-only'));
        toolbar.append(button('Fit width', () => { state.zoom = 1; render(); }, 'tool-button secondary-tool'));
      }
    } else toolbar.append(el('span', 'toolbar-hint', 'Material opens without annotation tools'));
  }
  function changeZoom(multiplier) {
    remember();
    state.zoom = Math.max(0.5, Math.min(3, state.zoom * multiplier));
    materialView.set(state.active, { scroll: viewer.scrollTop, zoom: state.zoom });
    render();
  }
  function renderFooter() {
    footer.replaceChildren();
    const index = materials.findIndex((item) => item.id === state.active);
    const prev = button('← Previous', () => nav(-1), 'button quiet');
    prev.disabled = index === 0;
    const next = button('Next →', () => nav(1), 'button primary');
    next.disabled = index === materials.length - 1;
    footer.append(prev, el('span', '', `${index + 1} of ${materials.length}`), next);
  }
  async function renderPdf(item, token) {
    status.textContent = 'Loading PDF…';
    const loading = el('div', 'loading-state', 'Preparing PDF pages…');
    viewer.append(loading);
    try {
      const pdf = await pdfjs.getDocument({ url: item.url }).promise;
      if (token !== generation) return;
      loading.remove();
      const pageRoot = el('div', 'pdf-pages'); viewer.append(pageRoot);
      const shells = [];
      const pages = [];
      const available = Math.max(320, viewer.clientWidth - 48);
      observer?.disconnect();
      observer = new IntersectionObserver((entries) => {
        entries.filter((e) => e.isIntersecting).forEach((e) => pages.find((p) => p.pageShell === e.target)?.renderOne());
      }, { root: viewer, rootMargin: '800px 0px' });
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        if (token !== generation) return;
        const native = page.getViewport({ scale: 1 });
        const scale = Math.min(available / native.width, 2.5) * state.zoom;
        const viewport = page.getViewport({ scale });
        const pageShell = el('section', 'pdf-page');
        pageShell.style.width = `${viewport.width}px`;
        pageShell.style.height = `${viewport.height}px`;
        pageShell.setAttribute('aria-label', `PDF page ${number}`);
        const base = el('canvas', 'pdf-render');
        const overlay = el('canvas');
        pageShell.append(base, overlay);
        pageRoot.append(pageShell);
        shells.push(pageShell);
        const key = `${item.id}:${number}`;
        attachInk(overlay, key, state);
        const renderOne = async () => {
          if (base.dataset.done || base.dataset.loading) return;
          base.dataset.loading = '1';
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          base.width = Math.round(viewport.width * ratio);
          base.height = Math.round(viewport.height * ratio);
          try {
            await page.render({canvasContext: base.getContext('2d'),viewport,transform:ratio !== 1 ? [ratio,0,0,ratio,0,0] : null}).promise;
            base.dataset.done = '1';
          } catch (error) { base.dataset.loading = ''; console.warn('PDF page render', error); }
        };
        pages.push({ pageShell, renderOne });
        observer.observe(pageShell);
      }
      viewer.onscroll = () => { state.page = pageFromScroll(viewer, shells); remember(); };
      status.textContent = `${pdf.numPages} pages`;
      viewer.scrollTop = materialView.get(item.id)?.scroll || 0;
    } catch (error) {
      if (token !== generation) return;
      loading.remove();
      status.textContent = '';
      viewer.append(el('div', 'error-state', `Could not display this PDF: ${message(error)}. Google Drive links may block direct PDF loading.`));
      viewer.append(button('Open PDF in a new tab', () => window.open(item.url, '_blank', 'noopener,noreferrer'), 'button primary'));
    }
  }
  function renderNote(item) {
    const pad = el('div', 'note-pad');
    const page = el('article', 'note-page');
    const body = el('div', 'note-body');
    body.innerHTML = safeNote(item.content);
    page.append(body);
    const overlay = el('canvas');
    page.append(overlay);
    pad.append(page);
    viewer.append(pad);
    const key = `${item.id}:1`;
    state.page = 1;
    requestAnimationFrame(() => {
      page.style.height = `${Math.max(950, body.scrollHeight + 90)}px`;
      attachInk(overlay, key, state);
      viewer.scrollTop = materialView.get(item.id)?.scroll || 0;
    });
    viewer.onscroll = remember;
  }
  function renderYouTube(item) {
    try {
      const id = youtubeId(item.url);
      const frame = el('iframe', 'video-frame');
      frame.src = `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
      frame.title = item.title;
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      frame.allowFullscreen = true;
      viewer.append(frame);
      viewer.append(button('Open on YouTube ↗', () => window.open(`https://www.youtube.com/watch?v=${id}`, '_blank', 'noopener,noreferrer'), 'button quiet'));
    } catch (error) { viewer.append(el('div', 'error-state', message(error))); }
  }
  function renderLink(item) {
    const empty = el('section', 'external-link-panel');
    empty.append(el('div', 'external-icon', '↗'), el('h2', '', item.title));
    empty.append(el('p', '', 'This website opens in a separate tab because many learning sites block embedded viewing. Your lesson will stay open here.'));
    empty.append(button('Open website ↗', () => window.open(item.url, '_blank', 'noopener,noreferrer'), 'button primary big'));
    viewer.append(empty);
  }
  function render() {
    ++generation;
    const token = generation;
    observer?.disconnect(); observer = null;
    state.canvases.clear();
    viewer.onscroll = null;
    viewer.replaceChildren();
    status.textContent = '';
    renderTabs(); renderToolbar(); renderFooter();
    const item = current();
    if (item.kind === 'pdf') renderPdf(item, token);
    else if (item.kind === 'note') renderNote(item);
    else if (item.kind === 'youtube') renderYouTube(item);
    else renderLink(item);
  }
  render();
}
