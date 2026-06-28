import { getSettings, saveSettings } from './settings.js';

const fields = {
  apiKey1: document.getElementById('apiKey1'),
  apiKey2: document.getElementById('apiKey2'),
  apiKey1Label: document.getElementById('apiKey1Label'),
  apiKey2Label: document.getElementById('apiKey2Label'),
  includeImages: document.getElementById('includeImages'),
  removeDocumentHeader: document.getElementById('removeDocumentHeader'),
  removeDocumentFooter: document.getElementById('removeDocumentFooter'),
  imageExportMode: document.getElementById('imageExportMode'),
  previewAutoSaveDisabled: document.getElementById('previewAutoSaveDisabled')
};
const msgEl = document.getElementById('msg');

function load() {
  const settings = getSettings();
  for (const [key, el] of Object.entries(fields)) {
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else el.value = settings[key] ?? '';
  }
}

function save() {
  saveSettings({
    apiKey1: fields.apiKey1.value.trim(),
    apiKey2: fields.apiKey2.value.trim(),
    apiKey1Label: fields.apiKey1Label.value.trim() || 'API KEY 1',
    apiKey2Label: fields.apiKey2Label.value.trim() || 'API KEY 2',
    includeImages: fields.includeImages.checked,
    removeDocumentHeader: fields.removeDocumentHeader.checked,
    removeDocumentFooter: fields.removeDocumentFooter.checked,
    imageExportMode: fields.imageExportMode.value === 'separate' ? 'separate' : 'zip',
    previewAutoSaveDisabled: fields.previewAutoSaveDisabled.checked
  });
  msgEl.textContent = 'Guardado.';
  setTimeout(() => {
    msgEl.textContent = '';
  }, 1800);
}

document.getElementById('save').addEventListener('click', save);
document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-toggle-password]');
  if (!btn) return;
  const input = document.getElementById(btn.getAttribute('data-toggle-password'));
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? 'Mostrar' : 'Ocultar';
});

load();
