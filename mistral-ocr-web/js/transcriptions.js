import { deleteEntry, exportImages, exportMarkdown, getMarkdown, listEntries } from './repository.js';
import { copyText, renderEntry, setStatus } from './ui.js';

const statusEl = document.getElementById('status');
const listEl = document.getElementById('list');
const searchBoxEl = document.getElementById('searchBox');

let allItems = [];

function matchesSearch(item, query) {
  if (!query) return true;
  return [
    item.name,
    item.sourceName,
    item.hash,
    item.resourceKind,
    item.mimeType,
    item.pages,
    item.imagesCount
  ].join(' ').toLowerCase().includes(query);
}

function render() {
  const query = (searchBoxEl.value || '').trim().toLowerCase();
  const items = allItems.filter((item) => matchesSearch(item, query));
  listEl.innerHTML = items.length
    ? items.map(renderEntry).join('')
    : '<div class="web-empty">No hay transcripciones para mostrar.</div>';
}

function load() {
  allItems = listEntries();
  render();
}

listEl.addEventListener('click', async (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;
  const hash = btn.getAttribute('data-hash');
  const action = btn.getAttribute('data-act');
  try {
    if (action === 'copy') {
      const resp = await getMarkdown(hash);
      await copyText(resp.content);
      setStatus(statusEl, 'Markdown copiado.');
    } else if (action === 'export-md') {
      await exportMarkdown(hash);
      setStatus(statusEl, 'Markdown exportado.');
    } else if (action === 'export-images') {
      const resp = await exportImages(hash);
      setStatus(statusEl, resp.ok ? 'Imagenes exportadas.' : resp.error, resp.ok ? '' : 'warn');
    } else if (action === 'delete') {
      await deleteEntry(hash);
      setStatus(statusEl, 'Transcripcion eliminada.');
      load();
    }
  } catch (error) {
    setStatus(statusEl, error?.message || 'No se pudo completar la accion.', 'error');
  }
});

searchBoxEl.addEventListener('input', render);
load();
