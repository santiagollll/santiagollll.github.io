import { getApiConfig, getApiKeyOptions, getSettings, setActiveApiKeySlot, setSetting } from './settings.js';
import { exportImages, exportMarkdown, getMarkdown, listRecent } from './repository.js';
import { describeFile, isSupportedFile, runOcrForFile } from './ocr-service.js';
import { copyText, escapeHtml, formatBytes, renderEntry, setStatus } from './ui.js';

const statusEl = document.getElementById('status');
const setupGuideEl = document.getElementById('setupGuide');
const fileDropEl = document.getElementById('fileDrop');
const fileInputEl = document.getElementById('fileInput');
const fileInfoEl = document.getElementById('fileInfo');
const btnRunEl = document.getElementById('btnRun');
const btnCancelEl = document.getElementById('btnCancel');
const includeImagesEl = document.getElementById('includeImages');
const apiKeySelectWrapEl = document.getElementById('apiKeySelectWrap');
const apiKeySelectEl = document.getElementById('apiKeySelect');
const progressBoxEl = document.getElementById('progressBox');
const progressTextEl = document.getElementById('progressText');
const recentListEl = document.getElementById('recentList');

let selectedFile = null;
let activeController = null;

function renderApiKeys() {
  const config = getApiConfig();
  setupGuideEl.classList.toggle('hidden', !!config.activeApiKey);
  const options = getApiKeyOptions();
  apiKeySelectWrapEl.classList.toggle('hidden', options.length < 2);
  apiKeySelectEl.innerHTML = options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
  apiKeySelectEl.value = config.activeApiKeySlot;
}

function renderSelectedFile() {
  if (!selectedFile) {
    fileInfoEl.textContent = 'Ningun archivo seleccionado';
    btnRunEl.disabled = true;
    return;
  }
  const info = describeFile(selectedFile);
  const supported = isSupportedFile(selectedFile);
  fileInfoEl.textContent = `${selectedFile.name} - ${formatBytes(selectedFile.size)}${supported ? ` - ${info.resourceKind}` : ' - no compatible'}`;
  btnRunEl.disabled = !supported || !!activeController;
  setStatus(statusEl, supported ? '' : 'Formato no compatible con Mistral OCR.', supported ? '' : 'warn');
}

function renderRecent() {
  const items = listRecent(3);
  if (!items.length) {
    recentListEl.innerHTML = '<div class="web-empty">No hay transcripciones guardadas todavia.</div>';
    return;
  }
  recentListEl.innerHTML = items.map(renderEntry).join('');
}

function setBusy(isBusy, message = '') {
  btnRunEl.disabled = isBusy || !selectedFile || !isSupportedFile(selectedFile);
  btnCancelEl.classList.toggle('hidden', !isBusy);
  progressBoxEl.classList.toggle('hidden', !isBusy);
  progressTextEl.textContent = message || '';
}

function selectFile(file) {
  selectedFile = file || null;
  renderSelectedFile();
}

async function runOcr() {
  const config = getApiConfig();
  const settings = getSettings();
  if (!config.activeApiKey) {
    setStatus(statusEl, 'Configura una API key de Mistral primero.', 'warn');
    return;
  }
  activeController = new AbortController();
  setBusy(true, 'Preparando OCR...');
  setStatus(statusEl, '');
  try {
    const result = await runOcrForFile(selectedFile, {
      apiKey: config.activeApiKey,
      includeImages: includeImagesEl.checked,
      extractHeader: settings.removeDocumentHeader,
      extractFooter: settings.removeDocumentFooter,
      signal: activeController.signal,
      onProgress: (message) => {
        progressTextEl.textContent = message;
      }
    });
    setStatus(statusEl, 'Transcripcion guardada localmente.');
    window.location.href = `preview.html?hash=${encodeURIComponent(result.hash)}`;
  } catch (error) {
    const isAbort = error?.name === 'AbortError' || /abort|cancel/i.test(error?.message || '');
    setStatus(statusEl, isAbort ? 'OCR cancelado.' : (error?.message || 'No se pudo completar OCR.'), isAbort ? 'warn' : 'error');
  } finally {
    activeController = null;
    setBusy(false);
    renderSelectedFile();
    renderRecent();
  }
}

fileInputEl.addEventListener('change', () => selectFile(fileInputEl.files?.[0] || null));
btnRunEl.addEventListener('click', runOcr);
btnCancelEl.addEventListener('click', () => activeController?.abort('cancelado por el usuario'));
includeImagesEl.addEventListener('change', () => setSetting('includeImages', includeImagesEl.checked));
apiKeySelectEl.addEventListener('change', () => {
  setActiveApiKeySlot(apiKeySelectEl.value);
  renderApiKeys();
});

for (const eventName of ['dragenter', 'dragover']) {
  fileDropEl.addEventListener(eventName, (event) => {
    event.preventDefault();
    fileDropEl.classList.add('dragover');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  fileDropEl.addEventListener(eventName, (event) => {
    event.preventDefault();
    fileDropEl.classList.remove('dragover');
  });
}
fileDropEl.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0] || null;
  if (file) {
    fileInputEl.value = '';
    selectFile(file);
  }
});

recentListEl.addEventListener('click', async (event) => {
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
    }
  } catch (error) {
    setStatus(statusEl, error?.message || 'No se pudo completar la accion.', 'error');
  }
});

includeImagesEl.checked = getSettings().includeImages;
renderApiKeys();
renderSelectedFile();
renderRecent();
