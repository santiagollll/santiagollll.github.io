import {
  exportImages,
  exportMarkdown,
  getPreviewData,
  updateConfidenceDecision,
  updateConfidenceDecisions,
  updateMarkdown
} from './repository.js';
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
const confidencePopoverEl = document.getElementById('confidencePopover');
const confidencePopoverTextEl = document.getElementById('confidencePopoverText');
const confidenceKeepEl = document.getElementById('confidenceKeep');

const params = new URLSearchParams(location.search);
const hash = params.get('hash') || '';
const settings = getSettings();

let currentItem = null;
let saveTimer = null;
let dirty = false;
let activeConfidenceKey = '';
let hidePopoverTimer = null;

function markedApi() {
  return window.marked?.marked || window.marked;
}

function imageKey(value) {
  const clean = String(value || '').split('#')[0].split('?')[0];
  const base = clean.split('/').pop() || clean;
  try {
    return decodeURIComponent(base).toLowerCase();
  } catch {
    return base.toLowerCase();
  }
}

function buildImageMap(images) {
  const map = new Map();
  for (const image of images || []) {
    const key = imageKey(image.name);
    if (key && image.dataUrl) map.set(key, image.dataUrl);
  }
  return map;
}

function resolveRenderedImages(root, images) {
  const imageMap = buildImageMap(images);
  for (const img of root.querySelectorAll('img')) {
    const key = imageKey(img.getAttribute('src'));
    const dataUrl = imageMap.get(key);
    if (dataUrl) img.src = dataUrl;
    img.loading = 'lazy';
  }
}

function upgradeLinks(root) {
  for (const link of root.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href)) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  }
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
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
      throwOnError: false
    });
  } catch {}
}

function confidencePercent(confidence) {
  return Math.round(Number(confidence || 0) * 100);
}

function confidenceBucket(confidence) {
  const pct = confidencePercent(confidence);
  if (pct <= 83) return { key: 'red', className: 'confidence-red', label: '<=83%' };
  if (pct >= 84 && pct <= 89) return { key: 'orange', className: 'confidence-orange', label: '84-89%' };
  if (pct >= 90 && pct <= 95) return { key: 'yellow', className: 'confidence-yellow', label: '90-95%' };
  return null;
}

function confidenceClass(confidence) {
  return confidenceBucket(confidence)?.className || null;
}

function confidenceKey(score) {
  return [
    score.pageIndex ?? '',
    score.startIndex ?? '',
    score.markdownOffset ?? '',
    String(score.text || '')
  ].join('|');
}

function isConfidenceDismissed(item, score) {
  return !!item.confidenceDecisions?.[confidenceKey(score)];
}

function visibleScoreText(text) {
  const raw = String(text || '')
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^>\s*/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '');
  if (raw.trim().startsWith('![')) return '';
  const cleaned = raw
    .trim()
    .replace(/[*_`#>\[\]()!]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : '';
}

function markdownImageRanges(markdown) {
  const ranges = [];
  const re = /!\[[^\]]*]\([^)]+\)/g;
  let match;
  while ((match = re.exec(markdown || '')) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function isInsideRange(offset, ranges) {
  if (typeof offset !== 'number') return false;
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

function canReadTextNode(node) {
  const parent = node.parentElement;
  if (!parent) return false;
  return !parent.closest('pre, code, kbd, script, style, textarea, .katex, mark.confidence-low');
}

function collectTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let fullText = '';
  let node;
  while ((node = walker.nextNode())) {
    if (!canReadTextNode(node)) continue;
    nodes.push({ node, start: fullText.length, end: fullText.length + node.nodeValue.length });
    fullText += node.nodeValue;
  }
  return { nodes, fullText };
}

function createConfidenceMark(text, score, className) {
  const mark = document.createElement('mark');
  mark.classList.add('confidence-low');
  if (className) mark.classList.add(className);
  mark.dataset.confidenceKey = confidenceKey(score);
  mark.dataset.confidence = String(score.confidence);
  mark.dataset.confidenceText = String(score.text || '');
  mark.title = `Confianza OCR: ${confidencePercent(score.confidence)}%`;
  mark.textContent = text;
  return mark;
}

function rangeOverlaps(start, end, ranges) {
  return ranges.some((range) => start < range.end && end > range.start);
}

function firstAvailableMatch(source, text, usedRanges, startFrom = 0) {
  let found = source.indexOf(text, Math.max(0, startFrom));
  while (found >= 0) {
    const end = found + text.length;
    if (!rangeOverlaps(found, end, usedRanges)) return found;
    found = source.indexOf(text, found + 1);
  }
  return -1;
}

function rawScoreCandidates(score) {
  const candidates = [];
  const original = String(score.text || '');
  const visible = visibleScoreText(original);
  for (const text of [original, visible]) {
    if (!text || text.trim().startsWith('![')) continue;
    if (!candidates.includes(text)) candidates.push(text);
  }
  return candidates;
}

function findRawScoreMatch(markdown, score, usedRanges) {
  const expected = typeof score.markdownOffset === 'number' ? score.markdownOffset : -1;
  for (const text of rawScoreCandidates(score)) {
    if (expected >= 0 && markdown.slice(expected, expected + text.length) === text) {
      const end = expected + text.length;
      if (!rangeOverlaps(expected, end, usedRanges)) return { start: expected, text };
    }
  }
  const starts = expected >= 0 ? [Math.max(0, expected - 80), 0] : [0];
  for (const text of rawScoreCandidates(score)) {
    for (const startFrom of starts) {
      const start = firstAvailableMatch(markdown, text, usedRanges, startFrom);
      if (start >= 0) return { start, text };
    }
  }
  return null;
}

function buildRawHighlightRanges(markdown, item) {
  const ranges = [];
  const imageRanges = markdownImageRanges(markdown);
  for (const score of item.confidenceWords || []) {
    const className = confidenceClass(score.confidence);
    if (!className || isConfidenceDismissed(item, score)) continue;
    if (isInsideRange(score.markdownOffset, imageRanges)) continue;
    const match = findRawScoreMatch(markdown, score, ranges);
    if (!match) continue;
    ranges.push({
      start: match.start,
      end: match.start + match.text.length,
      score: { ...score, resolvedRawStart: match.start, resolvedRawEnd: match.start + match.text.length },
      className
    });
  }
  return ranges.sort((a, b) => a.start - b.start);
}

function renderRawEditor(markdown, item) {
  const ranges = item.rawConfidenceRanges || buildRawHighlightRanges(markdown, item);
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) fragment.appendChild(document.createTextNode(markdown.slice(cursor, range.start)));
    fragment.appendChild(createConfidenceMark(markdown.slice(range.start, range.end), range.score, range.className));
    cursor = range.end;
  }
  if (cursor < markdown.length) fragment.appendChild(document.createTextNode(markdown.slice(cursor)));
  if (!markdown) fragment.appendChild(document.createElement('br'));
  rawEditorEl.replaceChildren(fragment);
}

function visiblePrefixForMarkdown(markdown) {
  const api = markedApi();
  const parsed = api?.parse ? api.parse(markdown || '', { gfm: true, breaks: false, silent: true }) : markdown || '';
  const template = document.createElement('template');
  template.innerHTML = window.DOMPurify?.sanitize ? window.DOMPurify.sanitize(parsed) : parsed;
  const scratch = document.createElement('div');
  scratch.appendChild(template.content.cloneNode(true));
  for (const node of scratch.querySelectorAll('pre, code, kbd, script, style, textarea')) node.remove();
  return scratch.textContent || '';
}

function approximateVisibleOffset(markdown, markdownOffset) {
  if (typeof markdownOffset !== 'number' || markdownOffset <= 0) return 0;
  return visiblePrefixForMarkdown(markdown.slice(0, markdownOffset)).length;
}

function findHighlightIndex(fullText, text, ranges, preferredStart) {
  const starts = [preferredStart, Math.max(0, preferredStart - 80), 0];
  for (const startFrom of starts) {
    const found = firstAvailableMatch(fullText, text, ranges, startFrom);
    if (found >= 0) return found;
  }
  return -1;
}

function wrapSingleTextNodeRange(range) {
  const { nodes } = collectTextNodes(range.root);
  const startEntry = nodes.find((entry) => range.start >= entry.start && range.start <= entry.end);
  const endEntry = nodes.find((entry) => range.end >= entry.start && range.end <= entry.end);
  if (!startEntry || !endEntry || startEntry.node !== endEntry.node) return;
  const node = startEntry.node;
  const start = range.start - startEntry.start;
  const end = range.end - startEntry.start;
  const text = node.nodeValue;
  const fragment = document.createDocumentFragment();
  if (text.slice(0, start)) fragment.appendChild(document.createTextNode(text.slice(0, start)));
  fragment.appendChild(createConfidenceMark(text.slice(start, end), range.score, range.className));
  if (text.slice(end)) fragment.appendChild(document.createTextNode(text.slice(end)));
  node.parentNode.replaceChild(fragment, node);
}

function applyConfidenceHighlights(root, item) {
  const markdown = item.markdown || '';
  const imageRanges = markdownImageRanges(markdown);
  const { fullText } = collectTextNodes(root);
  const ranges = [];
  const visibleOffsetCache = new Map();
  let preferredStart = 0;

  for (const score of item.resolvedConfidenceScores || item.confidenceWords || []) {
    const className = confidenceClass(score.confidence);
    if (!className || isConfidenceDismissed(item, score)) continue;
    if (isInsideRange(score.markdownOffset, imageRanges)) continue;
    const text = visibleScoreText(score.text);
    if (!text) continue;
    const expectedOffset = visibleOffsetCache.has(score.markdownOffset)
      ? visibleOffsetCache.get(score.markdownOffset)
      : approximateVisibleOffset(markdown, score.markdownOffset);
    visibleOffsetCache.set(score.markdownOffset, expectedOffset);
    const preferred = typeof score.markdownOffset === 'number' ? expectedOffset : preferredStart;
    const index = findHighlightIndex(fullText, text, ranges, preferred);
    if (index < 0) continue;
    const range = { root, start: index, end: index + text.length, className, score };
    ranges.push(range);
    preferredStart = range.end;
  }
  ranges.sort((a, b) => b.start - a.start).forEach(wrapSingleTextNodeRange);
}

function renderAnchoredMarkdown(markdown) {
  const api = markedApi();
  if (!api?.parse) return escapeHtml(markdown || '').replace(/\n/g, '<br>');
  return api.parse(markdown || '', { gfm: true, breaks: false, silent: true });
}

function renderMarkdownInto(root, item) {
  const markdown = item.markdown || '';
  const rawRanges = item.rawConfidenceRanges || buildRawHighlightRanges(markdown, item);
  const parsed = renderAnchoredMarkdown(markdown);
  const clean = window.DOMPurify?.sanitize
    ? window.DOMPurify.sanitize(parsed, { ADD_ATTR: ['target', 'rel'] })
    : parsed;
  root.innerHTML = clean;
  resolveRenderedImages(root, item.images || []);
  upgradeLinks(root);
  renderMath(root);
  applyConfidenceHighlights(root, { ...item, resolvedConfidenceScores: rawRanges.map((range) => range.score) });
}

function renderConfidenceSummary(item) {
  confidenceSummaryEl.innerHTML = '';
  const counts = {
    yellow: { label: '90-95%', className: 'confidence-yellow', count: 0 },
    orange: { label: '84-89%', className: 'confidence-orange', count: 0 },
    red: { label: '<=83%', className: 'confidence-red', count: 0 }
  };
  const imageRanges = markdownImageRanges(item.markdown || '');
  const keys = [];
  for (const score of item.confidenceWords || []) {
    const bucket = confidenceBucket(score.confidence);
    if (!bucket || isConfidenceDismissed(item, score)) continue;
    if (isInsideRange(score.markdownOffset, imageRanges)) continue;
    if (!visibleScoreText(score.text)) continue;
    counts[bucket.key].count += 1;
    keys.push(confidenceKey(score));
  }
  const activeBuckets = ['yellow', 'orange', 'red'].filter((key) => counts[key].count > 0);
  if (!activeBuckets.length) return;

  const label = document.createElement('span');
  label.className = 'confidence-summary-label';
  label.textContent = 'Palabras OCR con baja confianza';
  confidenceSummaryEl.appendChild(label);
  for (const key of activeBuckets) {
    const pill = document.createElement('span');
    pill.className = `confidence-pill ${counts[key].className}`;
    pill.textContent = `${counts[key].label}: ${counts[key].count}`;
    confidenceSummaryEl.appendChild(pill);
  }
  const keepAll = document.createElement('button');
  keepAll.type = 'button';
  keepAll.className = 'confidence-summary-action';
  keepAll.textContent = 'Conservar todas';
  keepAll.addEventListener('click', () => preserveAllConfidenceWords(Array.from(new Set(keys))));
  confidenceSummaryEl.appendChild(keepAll);
}

function currentMarkdown() {
  return rawEditorEl.textContent || '';
}

function renderPreview() {
  const markdown = currentMarkdown();
  const rawConfidenceRanges = buildRawHighlightRanges(markdown, currentItem);
  renderRawEditor(markdown, { ...currentItem, markdown, rawConfidenceRanges });
  renderMarkdownInto(renderedEl, { ...currentItem, markdown, rawConfidenceRanges });
  renderConfidenceSummary({ ...currentItem, markdown });
}

function renderMeta() {
  const created = new Date(currentItem.createdAt || Date.now()).toLocaleString();
  const updated = new Date(currentItem.updatedAt || currentItem.createdAt || Date.now()).toLocaleString();
  titleEl.textContent = currentItem.name || 'Preview/Edit';
  document.title = `${currentItem.name || 'Preview/Edit'} - Mistral OCR Web`;
  metaEl.textContent = `${currentItem.resourceKind || 'document'} - ${currentItem.pages || 0} paginas - ${currentItem.imagesCount || 0} imagenes - creado ${created} - actualizado ${updated}`;
}

async function saveMarkdownNow(showStatus = false) {
  if (!currentItem || !dirty) return;
  const resp = await updateMarkdown(hash, currentMarkdown());
  currentItem = resp.item;
  dirty = false;
  renderMeta();
  if (showStatus) setStatus(statusEl, 'Cambios guardados.');
}

function scheduleSave() {
  dirty = true;
  const markdown = currentMarkdown();
  const rawConfidenceRanges = buildRawHighlightRanges(markdown, currentItem);
  renderMarkdownInto(renderedEl, { ...currentItem, markdown, rawConfidenceRanges });
  renderConfidenceSummary({ ...currentItem, markdown });
  if (settings.previewAutoSaveDisabled) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveMarkdownNow(false).catch((error) => setStatus(statusEl, error?.message || 'No se pudo guardar.', 'error'));
  }, 600);
}

function printableStyles() {
  return `
    @page { margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body { color: #18212a; font-family: Georgia, "Times New Roman", serif; margin: 0; }
    .print-header { border-bottom: 1px solid #d9dee4; margin-bottom: 18px; padding-bottom: 10px; }
    .print-header h1 { font-size: 22px; line-height: 1.25; margin: 0 0 6px; overflow-wrap: anywhere; }
    .print-meta { color: #66717d; display: flex; flex-wrap: wrap; font: 11px Verdana, sans-serif; gap: 6px 12px; }
    .markdown-body { font-size: 12pt; line-height: 1.55; }
    .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 { break-after: avoid; line-height: 1.2; margin: 1.35em 0 0.55em; }
    .markdown-body p, .markdown-body ul, .markdown-body ol, .markdown-body blockquote, .markdown-body table { margin: 0 0 0.9em; }
    .markdown-body blockquote { border-left: 4px solid #d9dee4; color: #4e5b67; padding-left: 12px; }
    .markdown-body pre { background: #f0f3f6; border: 1px solid #d9dee4; overflow-wrap: anywhere; padding: 10px; white-space: pre-wrap; }
    .markdown-body code { background: #f0f3f6; border-radius: 3px; font: 0.9em ui-monospace, Menlo, Consolas, monospace; padding: 0.1em 0.24em; }
    .markdown-body table { border-collapse: collapse; width: 100%; }
    .markdown-body th, .markdown-body td { border: 1px solid #d9dee4; padding: 6px 8px; vertical-align: top; }
    .markdown-body th { background: #f2f5f7; font-weight: 700; }
    .markdown-body img { display: block; height: auto; margin: 12px auto; max-width: 100%; page-break-inside: avoid; }
    .confidence-low { border-radius: 3px; color: inherit; padding: 0.02em 0.12em; }
    .confidence-yellow { background: #fff3a3; }
    .confidence-orange { background: #ffd0a1; }
    .confidence-red { background: #ffc9c9; }
    a { color: inherit; text-decoration: none; }
  `;
}

function printableMetaHtml() {
  const parts = [
    `SHA: ${currentItem.hash}`,
    `Tipo: ${currentItem.resourceKind || 'desconocido'}`,
    `${currentItem.pages ?? 0} paginas`,
    `${currentItem.imagesCount ?? 0} imagenes`,
    `Actualizado: ${new Date(currentItem.updatedAt || currentItem.createdAt || Date.now()).toLocaleString()}`
  ];
  return parts.map((part) => `<span>${escapeHtml(part)}</span>`).join('');
}

function buildPrintableRenderedHtml() {
  const scratch = document.createElement('div');
  scratch.className = 'markdown-body';
  const markdown = currentMarkdown();
  const rawConfidenceRanges = buildRawHighlightRanges(markdown, currentItem);
  renderMarkdownInto(scratch, { ...currentItem, markdown, rawConfidenceRanges });
  for (const img of scratch.querySelectorAll('img')) img.removeAttribute('loading');
  return scratch.innerHTML;
}

function buildPrintableHtml() {
  const title = currentItem?.name || 'transcripcion';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="vendor/katex/katex.min.css">
  <style>${printableStyles()}</style>
</head>
<body>
  <header class="print-header">
    <h1>${escapeHtml(title)}</h1>
    <div class="print-meta">${printableMetaHtml()}</div>
  </header>
  <main class="markdown-body">${buildPrintableRenderedHtml()}</main>
  <script>
    window.addEventListener('load', () => setTimeout(() => window.print(), 250));
  <\/script>
</body>
</html>`;
}

function exportPdf() {
  const html = buildPrintableHtml();
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    downloadText(html, `${currentItem?.name || 'transcripcion'}.html`, 'text/html;charset=utf-8');
    setStatus(statusEl, 'El navegador bloqueo la ventana. Se exporto HTML imprimible.', 'warn');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  setStatus(statusEl, 'Se abrio una vista imprimible con imagenes embebidas.');
}

function showConfidencePopover(mark) {
  clearTimeout(hidePopoverTimer);
  activeConfidenceKey = mark.dataset.confidenceKey || '';
  confidencePopoverTextEl.textContent = `Confianza OCR: ${confidencePercent(mark.dataset.confidence)}%`;
  confidencePopoverEl.classList.add('visible');
  const rect = mark.getBoundingClientRect();
  const popoverWidth = 260;
  confidencePopoverEl.style.top = `${Math.max(8, rect.bottom + 8)}px`;
  confidencePopoverEl.style.left = `${Math.min(window.innerWidth - popoverWidth - 8, Math.max(8, rect.left))}px`;
}

function hideConfidencePopoverSoon() {
  hidePopoverTimer = setTimeout(() => confidencePopoverEl.classList.remove('visible'), 200);
}

async function preserveConfidenceWord(key) {
  if (!key) return;
  const previous = currentItem.confidenceDecisions || {};
  currentItem.confidenceDecisions = { ...previous, [key]: 'keep' };
  renderPreview();
  confidencePopoverEl.classList.remove('visible');
  try {
    const resp = await updateConfidenceDecision(hash, key);
    currentItem = resp.item;
    renderPreview();
  } catch (error) {
    currentItem.confidenceDecisions = previous;
    renderPreview();
    setStatus(statusEl, error?.message || 'No se pudo guardar la decision.', 'error');
  }
}

async function preserveAllConfidenceWords(keys) {
  if (!keys.length) return;
  const previous = currentItem.confidenceDecisions || {};
  currentItem.confidenceDecisions = { ...previous };
  for (const key of keys) currentItem.confidenceDecisions[key] = 'keep';
  renderPreview();
  try {
    const resp = await updateConfidenceDecisions(hash, keys);
    currentItem = resp.item;
    renderPreview();
  } catch (error) {
    currentItem.confidenceDecisions = previous;
    renderPreview();
    setStatus(statusEl, error?.message || 'No se pudieron guardar las decisiones.', 'error');
  }
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
    renderPreview();
  } catch (error) {
    setStatus(statusEl, error?.message || 'No se pudo cargar la transcripcion.', 'error');
  }
}

rawEditorEl.addEventListener('input', scheduleSave);
saveMdEl.addEventListener('click', () => saveMarkdownNow(true).catch((error) => setStatus(statusEl, error?.message || 'No se pudo guardar.', 'error')));
copyRawEl.addEventListener('click', async () => {
  await copyText(currentMarkdown());
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

document.addEventListener('mouseover', (event) => {
  const mark = event.target.closest?.('mark.confidence-low');
  if (mark) showConfidencePopover(mark);
});
document.addEventListener('mouseout', (event) => {
  if (event.target.closest?.('mark.confidence-low')) hideConfidencePopoverSoon();
});
confidencePopoverEl.addEventListener('mouseover', () => clearTimeout(hidePopoverTimer));
confidencePopoverEl.addEventListener('mouseout', hideConfidencePopoverSoon);
confidenceKeepEl.addEventListener('click', () => preserveConfidenceWord(activeConfidenceKey));

window.addEventListener('beforeunload', (event) => {
  if (!settings.previewAutoSaveDisabled || !dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

load();
