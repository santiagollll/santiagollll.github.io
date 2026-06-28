export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function setStatus(el, message, tone = '') {
  if (!el) return;
  el.textContent = message || '';
  el.className = tone ? `small status-line ${tone}` : 'small status-line';
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text || '');
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text || '';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return false;
  }
}

export function renderEntryActions(hash) {
  const safe = escapeHtml(hash);
  return `
    <div class="actions">
      <a class="button" href="preview.html?hash=${encodeURIComponent(hash)}">Preview/Edit</a>
      <button data-act="copy" data-hash="${safe}" type="button">Copiar</button>
      <button data-act="export-md" data-hash="${safe}" type="button">Exportar MD</button>
      <button data-act="export-images" data-hash="${safe}" type="button">Imagenes</button>
      <button class="danger" data-act="delete" data-hash="${safe}" type="button">Eliminar</button>
    </div>
  `;
}

export function renderEntry(item) {
  const createdAt = new Date(item.createdAt || Date.now()).toLocaleString();
  const updatedAt = new Date(item.updatedAt || item.createdAt || Date.now()).toLocaleString();
  return `
    <div class="entry transcription-entry">
      <div class="transcription-main">
        <div class="transcription-head">
          <div>
            <div class="entry-title">${escapeHtml(item.name)}</div>
            <div class="small hash-line">SHA ${escapeHtml(item.hash)}</div>
          </div>
          <div class="transcription-kind">${escapeHtml(item.resourceKind || 'desconocido')}</div>
        </div>
        <div class="transcription-meta">
          <span>${escapeHtml(String(item.pages ?? 0))} paginas</span>
          <span>${escapeHtml(String(item.imagesCount ?? 0))} imagenes</span>
          <span>${escapeHtml(formatBytes(item.fileSize))}</span>
          <span>Creado: ${escapeHtml(createdAt)}</span>
          <span>Actualizado: ${escapeHtml(updatedAt)}</span>
        </div>
        <div class="source-line">
          <span class="meta-label">Archivo</span>
          <span class="url-line">${escapeHtml(item.sourceName || item.name || 'document')}</span>
        </div>
      </div>
      ${renderEntryActions(item.hash)}
    </div>
  `;
}
