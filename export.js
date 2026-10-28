import { safeNote } from './lib.js';

function fileName(title) {
  return (String(title || 'Teaching Hub document')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'Teaching Hub document');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

/** Export an editable Teaching Hub note as a genuine .docx Word document. */
export async function exportWord(title, html) {
  // The Word converter is loaded only on demand, keeping classroom launch quick.
  const [{ Document, Packer }, { htmlToContent }] = await Promise.all([
    import('docx'),
    import('docx/html'),
  ]);
  const content = `<h1>${escapeHtml(title)}</h1>${safeNote(html || '<p></p>')}`;
  const documentFile = new Document({
    sections: [{ children: htmlToContent(content) }],
  });
  const blob = await Packer.toBlob(documentFile);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName(title)}.docx`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 20_000);
}

/** Use the browser's print dialog, which offers "Save as PDF" on most devices. */
export function printDocument(title, html) {
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('Allow pop-ups for Teaching Hub to print or save a PDF.');
  const doc = popup.document;
  doc.title = title || 'Teaching Hub document';

  const style = doc.createElement('style');
  style.textContent = `
    @page { size: A4; margin: 20mm; }
    body { margin: 0 auto; max-width: 750px; color: #17251d;
      font: 12pt/1.55 Arial, Helvetica, sans-serif; }
    h1 { font-size: 20pt; margin: 0 0 16pt; }
    h2 { font-size: 16pt; } h3 { font-size: 14pt; }
    p { margin: 0 0 10pt; } li { margin-bottom: 4pt; }
    blockquote { border-left: 3px solid #ccd8cf; padding-left: 12pt; }
    @media screen { body { padding: 32px; } }
  `;
  const heading = doc.createElement('h1');
  heading.textContent = title || 'Teaching Hub document';
  const article = doc.createElement('article');
  article.innerHTML = safeNote(html || '<p></p>');
  doc.head.append(style);
  doc.body.replaceChildren(heading, article);
  popup.setTimeout(() => { popup.focus(); popup.print(); }, 300);
}
