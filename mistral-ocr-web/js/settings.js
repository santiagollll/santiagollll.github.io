const PREFIX = 'mistralOcrWeb.';

const DEFAULTS = {
  apiKey1: '',
  apiKey2: '',
  apiKey1Label: 'API KEY 1',
  apiKey2Label: 'API KEY 2',
  activeApiKeySlot: 'key1',
  includeImages: true,
  imageExportMode: 'zip',
  previewAutoSaveDisabled: false,
  removeDocumentHeader: false,
  removeDocumentFooter: false
};

function readRaw(key) {
  return localStorage.getItem(`${PREFIX}${key}`);
}

function writeRaw(key, value) {
  localStorage.setItem(`${PREFIX}${key}`, value);
}

function readBool(key) {
  const raw = readRaw(key);
  if (raw == null) return DEFAULTS[key];
  return raw === 'true';
}

export function getSetting(key) {
  if (typeof DEFAULTS[key] === 'boolean') return readBool(key);
  return readRaw(key) ?? DEFAULTS[key] ?? '';
}

export function setSetting(key, value) {
  if (typeof DEFAULTS[key] === 'boolean') {
    writeRaw(key, value ? 'true' : 'false');
    return;
  }
  writeRaw(key, String(value ?? ''));
}

export function getSettings() {
  return {
    apiKey1: getSetting('apiKey1').trim(),
    apiKey2: getSetting('apiKey2').trim(),
    apiKey1Label: getSetting('apiKey1Label').trim() || DEFAULTS.apiKey1Label,
    apiKey2Label: getSetting('apiKey2Label').trim() || DEFAULTS.apiKey2Label,
    activeApiKeySlot: getSetting('activeApiKeySlot') === 'key2' ? 'key2' : 'key1',
    includeImages: getSetting('includeImages'),
    imageExportMode: getSetting('imageExportMode') === 'separate' ? 'separate' : 'zip',
    previewAutoSaveDisabled: getSetting('previewAutoSaveDisabled'),
    removeDocumentHeader: getSetting('removeDocumentHeader'),
    removeDocumentFooter: getSetting('removeDocumentFooter')
  };
}

export function saveSettings(settings) {
  for (const key of Object.keys(DEFAULTS)) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      setSetting(key, settings[key]);
    }
  }
}

export function getApiConfig() {
  const settings = getSettings();
  const hasKey1 = !!settings.apiKey1;
  const hasKey2 = !!settings.apiKey2;
  let activeApiKeySlot = settings.activeApiKeySlot;
  if (activeApiKeySlot === 'key2' && !hasKey2) activeApiKeySlot = hasKey1 ? 'key1' : 'key2';
  if (activeApiKeySlot === 'key1' && !hasKey1 && hasKey2) activeApiKeySlot = 'key2';
  return {
    ...settings,
    hasKey1,
    hasKey2,
    activeApiKeySlot,
    activeApiKey: activeApiKeySlot === 'key2' ? settings.apiKey2 : settings.apiKey1,
    activeApiKeyLabel: activeApiKeySlot === 'key2' ? settings.apiKey2Label : settings.apiKey1Label
  };
}

export function setActiveApiKeySlot(slot) {
  setSetting('activeApiKeySlot', slot === 'key2' ? 'key2' : 'key1');
}

export function getApiKeyOptions() {
  const config = getApiConfig();
  const options = [];
  if (config.hasKey1) options.push({ value: 'key1', label: config.apiKey1Label });
  if (config.hasKey2) options.push({ value: 'key2', label: config.apiKey2Label });
  return options;
}
