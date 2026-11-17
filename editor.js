import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { el, button, safeNote, safeHttpUrl } from './lib.js';

const FONTS = [
  ['', 'Default font'],
  ['Arial, Helvetica, sans-serif', 'Arial'],
  ['"Century Gothic", Arial, sans-serif', 'Century Gothic'],
  ['Georgia, serif', 'Georgia'],
  ['"Times New Roman", Times, serif', 'Times New Roman'],
];
const INDENT_STEP = 28;

function indentBlocks(editor, delta) {
  const { state, view } = editor;
  const { from, to } = state.selection;
  const positions = new Set();
  if (from === to) {
    const resolved = state.doc.resolve(from);
    for (let depth = resolved.depth; depth > 0; depth--) {
      const node = resolved.node(depth);
      if (['paragraph', 'heading'].includes(node.type.name)) {
        positions.add(resolved.before(depth));
        break;
      }
    }
  } else {
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (['paragraph', 'heading'].includes(node.type.name)) positions.add(pos);
    });
  }
  if (!positions.size) return false;
  const tr = state.tr;
  for (const pos of positions) {
    const node = tr.doc.nodeAt(pos);
    if (!node) continue;
    const current = Number(node.attrs.indent) || 0;
    const next = Math.max(0, Math.min(8, current + delta));
    if (next !== current) tr.setNodeMarkup(pos, null, { ...node.attrs, indent: next });
  }
  if (!tr.docChanged) return false;
  view.dispatch(tr);
  return true;
}

const ParagraphIndent = Extension.create({
  name: 'paragraphIndent',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        indent: {
          default: 0,
          parseHTML: (element) => {
            const style = element.style.marginLeft || element.style.textIndent || '0';
            const factor = style.includes('em') ? 16 : style.includes('pt') ? 4 / 3 : 1;
            const px = (Number.parseFloat(style) || 0) * factor;
            return Math.max(0, Math.min(8, Math.round(px / INDENT_STEP)));
          },
          renderHTML: (attributes) => attributes.indent
            ? { style: 'margin-left: ' + Math.min(8, attributes.indent) * INDENT_STEP + 'px' }
            : {},
        },
      },
    }];
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive('table') || this.editor.isActive('listItem')) return false;
        return indentBlocks(this.editor, 1);
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('table') || this.editor.isActive('listItem')) return false;
        return indentBlocks(this.editor, -1);
      },
    };
  },
});

function addButton(parent, label, title, onClick) {
  const control = button(label, onClick, 'format-button');
  control.title = title;
  control.setAttribute('aria-label', title);
  control.addEventListener('pointerdown', (event) => event.preventDefault());
  parent.append(control);
  return control;
}
function addSelect(parent, title, options, change) {
  const select = el('select', 'format-select');
  select.title = title;
  select.setAttribute('aria-label', title);
  options.forEach(([value, label]) => {
    const option = el('option', '', label);
    option.value = value;
    select.append(option);
  });
  select.addEventListener('change', () => change(select.value));
  parent.append(select);
  return select;
}

// Notes remain stored as sanitized HTML in the existing Supabase content field.
// No automatic rewrite of previously saved records is performed.
export function createDocumentEditor({ initialHTML = '<p></p>', onChange, onUploadImage, onNotice }) {
  const root = el('section', 'document-editor-v2');
  const toolbar = el('div', 'format-toolbar');
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Document formatting');
  const paper = el('div', 'document-edit-paper');
  const surface = el('div', 'doc-editor-surface');
  paper.append(surface);
  root.append(toolbar, paper);
  const editor = new Editor({
    element: surface,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
      TableKit.configure({ table: { resizable: false } }),
      Image.configure({ inline: false, allowBase64: false }),
      TextAlign.configure({ types: ['paragraph', 'heading'], alignments: ['left', 'center', 'right', 'justify'] }),
      TextStyleKit,
      ParagraphIndent,
    ],
    content: safeNote(initialHTML || '<p></p>'),
    editorProps: {
      attributes: {
        class: 'rich-editor tiptap',
        'aria-label': 'Editable teaching document',
        'aria-multiline': 'true',
        spellcheck: 'true',
      },
      transformPastedHTML: (html) => safeNote(html),
    },
    onUpdate: () => { onChange?.(); refreshControls(); },
    onSelectionUpdate: () => refreshControls(),
  });
  const toggles = [];
  const add = (label, title, action, isActive = null) => {
    const control = addButton(toolbar, label, title, action);
    if (isActive) toggles.push([control, isActive]);
    return control;
  };
  add('↶', 'Undo', () => editor.chain().focus().undo().run());
  add('↷', 'Redo', () => editor.chain().focus().redo().run());
  add('B', 'Bold', () => editor.chain().focus().toggleBold().run(), () => editor.isActive('bold'));
  add('I', 'Italic', () => editor.chain().focus().toggleItalic().run(), () => editor.isActive('italic'));
  add('U', 'Underline', () => editor.chain().focus().toggleUnderline().run(), () => editor.isActive('underline'));
  add('¶', 'Normal paragraph', () => editor.chain().focus().setParagraph().run(), () => editor.isActive('paragraph'));
  add('H1', 'Heading 1', () => editor.chain().focus().toggleHeading({ level: 1 }).run(), () => editor.isActive('heading', { level: 1 }));
  add('H2', 'Heading 2', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), () => editor.isActive('heading', { level: 2 }));
  add('• List', 'Bulleted list', () => editor.chain().focus().toggleBulletList().run(), () => editor.isActive('bulletList'));
  add('1. List', 'Numbered list', () => editor.chain().focus().toggleOrderedList().run(), () => editor.isActive('orderedList'));
  add('⇤', 'Align left', () => editor.chain().focus().setTextAlign('left').run());
  add('≡', 'Centre text', () => editor.chain().focus().setTextAlign('center').run());
  add('⇥', 'Align right', () => editor.chain().focus().setTextAlign('right').run());
  add('☰', 'Justify text', () => editor.chain().focus().setTextAlign('justify').run());
  add('↤', 'Decrease indentation / Shift+Tab', () => indentBlocks(editor, -1));
  add('↦', 'Increase indentation / Tab', () => indentBlocks(editor, 1));
  addSelect(toolbar, 'Font family', FONTS, (family) => {
    if (family) editor.chain().focus().setFontFamily(family).run();
    else editor.chain().focus().unsetFontFamily().run();
  });
  addSelect(toolbar, 'Font size', [['', 'Font size'], ...[12,14,16,18,20,24,30].map((n) => [n+'px', n+' px'])], (size) => {
    if (size) editor.chain().focus().setFontSize(size).run();
    else editor.chain().focus().unsetFontSize().run();
  });
  add('▦ Table', 'Insert 3 by 3 table', () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run());
  add('＋ Row', 'Add table row', () => editor.chain().focus().addRowAfter().run());
  add('＋ Col', 'Add table column', () => editor.chain().focus().addColumnAfter().run());
  add('− Row', 'Delete table row', () => editor.chain().focus().deleteRow().run());
  add('− Col', 'Delete table column', () => editor.chain().focus().deleteColumn().run());
  add('✕ Table', 'Delete table', () => editor.chain().focus().deleteTable().run());
  const imageInput = el('input', 'doc-inline-image-input');
  imageInput.type = 'file';
  imageInput.accept = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';
  imageInput.hidden = true;
  root.append(imageInput);
  add('▧ Picture', 'Insert a picture from device', () => imageInput.click());
  imageInput.addEventListener('change', async () => {
    const file = imageInput.files?.[0];
    imageInput.value = '';
    if (!file) return;
    try {
      const url = await onUploadImage(file);
      if (!url) return;
      editor.chain().focus().setImage({ src: url, alt: file.name }).run();
      onNotice?.('Picture inserted. Save this document to keep it.');
    } catch (error) {
      onNotice?.('Picture upload failed: ' + (error.message || error), true);
    }
  });
  add('↗ URL', 'Insert picture using a public HTTPS image URL', () => {
    const input = window.prompt('Enter the direct HTTPS image URL:');
    if (!input) return;
    try {
      const src = safeHttpUrl(input);
      editor.chain().focus().setImage({ src, alt: 'Teaching picture' }).run();
    } catch (error) { onNotice?.(error.message, true); }
  });
  function refreshControls() {
    if (editor.isDestroyed) return;
    for (const [control, isActive] of toggles) {
      const selected = Boolean(isActive());
      control.classList.toggle('format-active', selected);
      control.setAttribute('aria-pressed', String(selected));
    }
  }
  refreshControls();
  return {
    element: root,
    getHTML: () => safeNote(editor.getHTML()),
    setHTML: (html) => editor.commands.setContent(safeNote(html || '<p></p>')),
    focus: () => editor.chain().focus().run(),
    destroy: () => editor.destroy(),
  };
}
