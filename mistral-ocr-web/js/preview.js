import { exportImages, exportMarkdown, getPreviewData, updateMarkdown } from './repository.js';
import { downloadText } from './downloads.js';
import { copyText, escapeHtml, setStatus } from './ui.js';
import { getSettings } from './settings.js';

const titleEl = document.getElementById('title');
const metaEl = document.getElementById('meta');
const confidenceSummaryEl = document.getElementById('confidenceSummary');
const statusEl = document.getElementById('status');
const rawEditorEl = document.getElementById('rawEditor');
const renderedEl = document.getElementById('splitRendered');
const saveMdEl = document.getElementById('saveMd');
const copyRawEl = document.getElementById('copyRaw');
const exportMdEl = document.getElementById('exportMd');
const exportPdfEl = document.getElementById('exportPdf');
const exportImagesEl = document.getElementById('exportImages');

const params = new URLSearchParams(location.search);
const hash = params.get('hash') || '';
const settings = getSettings();

let currentItem = null;
let saveTimer = null;
let dirty = false;

function markdownToHtml(markdown) {
  const marked = window.marked;
  const DOMPurify = window.DOMPurify;
  const raw = marked?.parse ? marked.parse(markdown || '') : escapeHtml(markdown || '').replace(/\n/g, '<br>');
  return DOMPurify?.sanitize ? DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] }) : raw;
}

function renderMath(root) {
  try {
    window.renderMathInElement?.(root, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true }
      ],
      throwOnError: false
    });
  } catch {}
}

function renderMarkdown() {
  renderedEl.innerHTML = markdownToHtml(rawEditorEl.textContent || '');
  renderMath(renderedEl);
}

function renderMeta() {
  const created = new Date(currentItem.createdAt || Date.now()).toLocaleString();
  const updated = new Date(currentItem.updatedAt || currentItem.createdAt || Date.now()).toLocaleString();
  titleEl.textContent = currentItem.name || 'Preview/Edit';
  metaEl.textContent = `${currentItem.resourceKind || 'document'} - ${currentItem.pages || 0} paginas - ${currentItem.imagesCount || 0} imagenes - creado ${created} - actualizado ${updated}`;

  const words = currentItem.confidenceWords || [];
  if (!words.length) {
    confidenceSummaryEl.textContent = '';
    return;
  }
  const low = words.filter((word) => typeof word.confidence === 'number' && word.confidence < 0.8).length;
  confidenceSummaryEl.textContent = low ? `${low} palabras con baja confianza detectadas.` : 'Sin palabras de baja confianza detectadas.';
}

async function saveMarkdownNow(showStatus = false) {
  if (!currentItem || !dirty) return;
  const resp = await updateMarkdown(hash, rawEditorEl.textContent || '');
  currentItem = resp.item;
  dirty = false;
  renderMeta();
  if (showStatus) setStatus(statusEl, 'Cambios guardados.');
}

function scheduleSave() {
  dirty = true;
  renderMarkdown();
  if (settings.previewAutoSaveDisabled) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveMarkdownNow(false).catch((error) => setStatus(statusEl, error?.message || 'No se pudo guardar.', 'error'));
  }, 600);
}

function buildPrintableHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(currentItem?.name || 'transcripcion')}</title>
  <link rel="stylesheet" href="vendor/katex/katex.min.css">
  <style>
    body { color: #111; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.5; margin: 32px; }
    img { max-width: 100%; }
    pre, code { white-space: pre-wrap; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #ddd; padding: 6px; }
  </style>
</head>
<body>${renderedEl.innerHTML}</body>
</html>`;
}

function exportPdf() {
  const html = buildPrintableHtml();
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) {
    downloadText(html, `${currentItem?.name || 'transcripcion'}.html`, 'text/html;charset=utf-8');
    setStatus(statusEl, 'El navegador bloqueo la ventana de impresion. Se exporto HTML imprimible.');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  setStatus(statusEl, 'Se abrio una version imprimible. Usa Imprimir > Guardar como PDF.');
}

async function load() {
  if (!hash) {
    setStatus(statusEl, 'Falta el hash de la transcripcion.', 'error');
    return;
  }
  try {
    const resp = await getPreviewData(hash);
    currentItem = resp.item;
    rawEditorEl.textContent = currentItem.markdown || '';
    saveMdEl.hidden = !settings.previewAutoSaveDisabled;
    renderMeta();
    renderMarkdown();
  } catch (error) {
    setStatus(statusEl, error?.message || 'No se pudo cargar la transcripcion.', 'error');
  }
}

rawEditorEl.addEventListener('input', scheduleSave);
saveMdEl.addEventListener('click', () => saveMarkdownNow(true).catch((error) => setStatus(statusEl, error?.message || 'No se pudo guardar.', 'error')));
copyRawEl.addEventListener('click', async () => {
  await copyText(rawEditorEl.textContent || '');
  setStatus(statusEl, 'Markdown copiado.');
});
exportMdEl.addEventListener('click', async () => {
  await saveMarkdownNow(false);
  await exportMarkdown(hash);
  setStatus(statusEl, 'Markdown exportado.');
});
exportImagesEl.addEventListener('click', async () => {
  const resp = await exportImages(hash);
  setStatus(statusEl, resp.ok ? 'Imagenes exportadas.' : resp.error, resp.ok ? '' : 'warn');
});
exportPdfEl.addEventListener('click', async () => {
  await saveMarkdownNow(false);
  exportPdf();
});

window.addEventListener('beforeunload', (event) => {
  if (!settings.previewAutoSaveDisabled || !dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

load();
