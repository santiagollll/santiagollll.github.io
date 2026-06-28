import {
  arrayBufferToBase64,
  base64ToBytes,
  base64ToDataUrl,
  createZipFromFiles,
  dataUrlFromText,
  extractMarkdownImageNames,
  pickImageFileName,
  sanitizeFileName,
  stripFileExtension
} from './utils.js';
import { downloadText, downloadUrl } from './downloads.js';
import { getSettings } from './settings.js';

const DB_NAME = 'mistral-ocr-web-db';
const DB_VERSION = 1;
const ARTIFACTS_STORE = 'ocrArtifacts';
const INDEX_KEY = 'mistralOcrWeb.ocrIndex';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ARTIFACTS_STORE)) {
        db.createObjectStore(ARTIFACTS_STORE, { keyPath: 'hash' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB.'));
  });
}

async function withStore(mode, fn) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(ARTIFACTS_STORE, mode);
      const store = tx.objectStore(ARTIFACTS_STORE);
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      tx.oncomplete = () => done(undefined);
      tx.onerror = () => fail(tx.error || new Error('Fallo la transaccion de IndexedDB.'));
      tx.onabort = () => fail(tx.error || new Error('Se aborto la transaccion de IndexedDB.'));
      Promise.resolve(fn(store, done, fail)).catch(fail);
    });
  } finally {
    db.close();
  }
}

function readIndex() {
  try {
    const parsed = JSON.parse(localStorage.getItem(INDEX_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeIndex(index) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index || {}));
}

function toUint8Array(value) {
  if (!value) return new Uint8Array();
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function inferImageMimeFromName(name) {
  const lower = (name || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'image/jpeg';
}

function normalizeImagesForStorage(images) {
  return (images || []).map((image) => ({
    name: image.name,
    mimeType: image.mimeType,
    bytes: image.bytes
  }));
}

function buildExportBaseName(name) {
  return stripFileExtension(name || 'document');
}

export function listEntries() {
  return Object.values(readIndex())
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
}

export function listRecent(limit = 3) {
  return listEntries().slice(0, limit);
}

export function getIndexEntry(hash) {
  return readIndex()[hash] || null;
}

export async function saveOcrArtifact({ hash, markdown, images, pages, imagesCount, resourceKind, confidenceWords, confidenceDecisions }) {
  const record = {
    hash,
    markdown,
    images: normalizeImagesForStorage(images),
    pages,
    imagesCount,
    resourceKind,
    confidenceWords: Array.isArray(confidenceWords) ? confidenceWords : [],
    confidenceDecisions: confidenceDecisions && typeof confidenceDecisions === 'object' ? confidenceDecisions : {}
  };
  await withStore('readwrite', (store) => store.put(record));
}

export async function getOcrArtifact(hash) {
  return withStore('readonly', (store, resolve, reject) => {
    const request = store.get(hash);
    request.onsuccess = () => {
      if (!request.result) return reject(new Error('No se encontro la transcripcion.'));
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error('No se pudo leer la transcripcion.'));
  });
}

export async function deleteOcrArtifact(hash) {
  await withStore('readwrite', (store) => store.delete(hash));
}

export async function buildAndSaveOcrArtifacts({ ocr, hash, includeImages, resourceKind }) {
  let markdown = '';
  const images = [];
  const confidenceWords = [];

  for (const page of ocr.pages || []) {
    const md = page.markdown || '';
    const pageOffset = markdown.length;
    markdown += `${md}\n\n`;

    const wordScores = page.confidence_scores?.word_confidence_scores || page.confidenceScores?.wordConfidenceScores || [];
    for (const score of wordScores) {
      if (!score || typeof score.confidence !== 'number') continue;
      const startIndex = typeof score.start_index === 'number' ? score.start_index : score.startIndex;
      confidenceWords.push({
        text: String(score.text || ''),
        confidence: score.confidence,
        startIndex,
        markdownOffset: typeof startIndex === 'number' ? pageOffset + startIndex : null,
        pageIndex: page.index
      });
    }

    if (!includeImages) continue;
    const namesFromMd = extractMarkdownImageNames(md);
    const pageImages = page.images || [];
    for (let i = 0; i < pageImages.length; i++) {
      const image = pageImages[i];
      const base64 = image.image_base64 || image.imageBase64;
      if (!base64) continue;
      const bytes = base64ToBytes(base64);
      const name = pickImageFileName(i, page, namesFromMd, image);
      images.push({ name, mimeType: inferImageMimeFromName(name), bytes });
    }
  }

  await saveOcrArtifact({
    hash,
    markdown,
    images,
    pages: (ocr.pages || []).length,
    imagesCount: includeImages ? images.length : 0,
    resourceKind,
    confidenceWords,
    confidenceDecisions: {}
  });

  return {
    markdown,
    imagesCount: includeImages ? images.length : 0,
    pages: (ocr.pages || []).length
  };
}

export async function saveCompletedOcr({ hash, name, sourceName, fileSize, mimeType, resourceKind, ocr, includeImages }) {
  const artifacts = await buildAndSaveOcrArtifacts({ ocr, hash, includeImages, resourceKind });
  const index = readIndex();
  const now = Date.now();
  const previous = index[hash];
  const entry = {
    hash,
    name: name || sourceName || 'document',
    sourceName: sourceName || name || 'document',
    fileSize: fileSize || 0,
    mimeType: mimeType || '',
    resourceKind: resourceKind || null,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    pages: artifacts.pages,
    imagesCount: artifacts.imagesCount
  };
  index[hash] = entry;
  writeIndex(index);
  return entry;
}

export async function getPreviewData(hash) {
  const entry = getIndexEntry(hash);
  if (!entry) throw new Error('No se encontro la entrada del historial.');
  const artifact = await getOcrArtifact(hash);
  const images = (artifact.images || []).map((image) => {
    const base64 = arrayBufferToBase64(toUint8Array(image.bytes));
    const mimeType = image.mimeType || inferImageMimeFromName(image.name);
    return { name: image.name, mimeType, dataUrl: `data:${mimeType};base64,${base64}` };
  });
  return {
    ok: true,
    item: {
      ...entry,
      markdown: artifact.markdown || '',
      images,
      confidenceWords: Array.isArray(artifact.confidenceWords) ? artifact.confidenceWords : [],
      confidenceDecisions: artifact.confidenceDecisions && typeof artifact.confidenceDecisions === 'object' ? artifact.confidenceDecisions : {},
      pages: artifact.pages ?? entry.pages ?? 0,
      imagesCount: artifact.imagesCount ?? entry.imagesCount ?? images.length,
      resourceKind: artifact.resourceKind || entry.resourceKind || null
    }
  };
}

export async function updateMarkdown(hash, markdown) {
  const index = readIndex();
  const entry = index[hash];
  if (!entry) throw new Error('No se encontro la entrada del historial.');
  const artifact = await getOcrArtifact(hash);
  await saveOcrArtifact({
    ...artifact,
    hash,
    markdown: String(markdown || ''),
    images: artifact.images || [],
    pages: artifact.pages ?? entry.pages ?? 0,
    imagesCount: artifact.imagesCount ?? entry.imagesCount ?? 0,
    resourceKind: artifact.resourceKind || entry.resourceKind || null,
    confidenceWords: artifact.confidenceWords || [],
    confidenceDecisions: artifact.confidenceDecisions || {}
  });
  index[hash] = { ...entry, updatedAt: Date.now() };
  writeIndex(index);
  return getPreviewData(hash);
}

export async function updateConfidenceDecision(hash, key) {
  const artifact = await getOcrArtifact(hash);
  const normalizedKey = String(key || '');
  if (!normalizedKey) throw new Error('Falta identificador de palabra.');
  await saveOcrArtifact({
    ...artifact,
    hash,
    markdown: artifact.markdown || '',
    images: artifact.images || [],
    pages: artifact.pages ?? 0,
    imagesCount: artifact.imagesCount ?? 0,
    resourceKind: artifact.resourceKind || null,
    confidenceWords: artifact.confidenceWords || [],
    confidenceDecisions: {
      ...(artifact.confidenceDecisions || {}),
      [normalizedKey]: 'keep'
    }
  });
  return getPreviewData(hash);
}

export async function updateConfidenceDecisions(hash, keys) {
  const artifact = await getOcrArtifact(hash);
  const normalizedKeys = Array.from(new Set((Array.isArray(keys) ? keys : []).map((key) => String(key || '')).filter(Boolean)));
  if (!normalizedKeys.length) throw new Error('Faltan identificadores de palabras.');
  const confidenceDecisions = { ...(artifact.confidenceDecisions || {}) };
  for (const key of normalizedKeys) confidenceDecisions[key] = 'keep';
  await saveOcrArtifact({
    ...artifact,
    hash,
    markdown: artifact.markdown || '',
    images: artifact.images || [],
    pages: artifact.pages ?? 0,
    imagesCount: artifact.imagesCount ?? 0,
    resourceKind: artifact.resourceKind || null,
    confidenceWords: artifact.confidenceWords || [],
    confidenceDecisions
  });
  return getPreviewData(hash);
}

export async function getMarkdown(hash) {
  const artifact = await getOcrArtifact(hash);
  return { ok: true, content: artifact.markdown || '' };
}

export async function deleteEntry(hash) {
  const index = readIndex();
  delete index[hash];
  writeIndex(index);
  await deleteOcrArtifact(hash);
  return { ok: true };
}

export async function exportMarkdown(hash) {
  const entry = getIndexEntry(hash);
  if (!entry) throw new Error('No se encontro la entrada del historial.');
  const artifact = await getOcrArtifact(hash);
  downloadText(artifact.markdown || '', `${buildExportBaseName(entry.name)}.md`, 'text/markdown;charset=utf-8');
  return { ok: true };
}

async function exportImagesAsSeparateFiles(entry, artifact) {
  for (const image of artifact.images || []) {
    const base64 = arrayBufferToBase64(toUint8Array(image.bytes));
    const url = base64ToDataUrl(base64, image.name);
    const imageName = sanitizeFileName(image.name || 'image.jpeg', 'image.jpeg');
    downloadUrl(url, `${buildExportBaseName(entry.name)} - ${imageName}`);
  }
  return { ok: true };
}

async function exportImagesAsZip(entry, artifact) {
  const files = (artifact.images || []).map((image) => ({
    name: sanitizeFileName(image.name || 'image.jpeg', 'image.jpeg'),
    bytes: toUint8Array(image.bytes)
  }));
  const zipBytes = createZipFromFiles(files);
  const base64 = arrayBufferToBase64(zipBytes);
  downloadUrl(`data:application/zip;base64,${base64}`, `${buildExportBaseName(entry.name)}.zip`);
  return { ok: true };
}

export async function exportImages(hash) {
  const entry = getIndexEntry(hash);
  if (!entry) throw new Error('No se encontro la entrada del historial.');
  const artifact = await getOcrArtifact(hash);
  if (!artifact.images?.length) return { ok: false, error: 'Esta transcripcion no tiene imagenes guardadas.' };
  return getSettings().imageExportMode === 'separate'
    ? exportImagesAsSeparateFiles(entry, artifact)
    : exportImagesAsZip(entry, artifact);
}

export function markdownDataUrl(text) {
  return dataUrlFromText(text || '', 'text/markdown');
}
