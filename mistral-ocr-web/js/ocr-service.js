import { arrayBufferToBase64, guessImageMime, mimeFromExt, sha256Hex } from './utils.js';
import { runMistralOcrFile, runMistralOcrImage, uploadFileToMistralOcr } from './mistral-client.js';
import { saveCompletedOcr } from './repository.js';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'avif', 'tif', 'tiff', 'gif', 'heic', 'heif', 'bmp', 'webp']);
const FILE_EXTENSIONS = new Set(['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'csv', 'txt', 'epub', 'xml', 'rtf', 'odt', 'bib', 'fb2', 'ipynb', 'tex', 'opml', 'man']);

function extensionFromName(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

export function describeFile(file) {
  const ext = extensionFromName(file?.name);
  const mime = file?.type || mimeFromExt(ext);
  let type = null;
  let resourceKind = ext || 'file';
  if (IMAGE_EXTENSIONS.has(ext) || mime.startsWith('image/')) {
    type = 'image';
    resourceKind = `image-${ext || mime.replace('image/', '') || 'unknown'}`;
  } else if (ext === 'pdf' || mime === 'application/pdf') {
    type = 'pdf';
    resourceKind = 'pdf';
  } else if (FILE_EXTENSIONS.has(ext)) {
    type = 'file';
    resourceKind = ext || 'file';
  }
  return { ext, mime, type, resourceKind };
}

export function isSupportedFile(file) {
  return !!describeFile(file).type;
}

export async function runOcrForFile(file, { apiKey, includeImages, extractHeader, extractFooter, signal, onProgress }) {
  if (!file) throw new Error('Selecciona un archivo primero.');
  if (!apiKey) throw new Error('Configura una API key de Mistral antes de transcribir.');

  const info = describeFile(file);
  if (!info.type) throw new Error('Formato no compatible con OCR.');

  onProgress?.('Leyendo archivo local...');
  const ab = await file.arrayBuffer();
  const hash = await sha256Hex(ab);
  let ocr;

  if (info.type === 'image') {
    onProgress?.('Enviando imagen a Mistral OCR...');
    const mime = guessImageMime(file.name, file.type || info.mime);
    const dataUrl = `data:${mime};base64,${arrayBufferToBase64(ab)}`;
    ocr = await runMistralOcrImage(dataUrl, apiKey, { includeImages, extractHeader, extractFooter }, signal);
  } else {
    onProgress?.('Subiendo archivo a Mistral...');
    const upload = await uploadFileToMistralOcr(ab, file.name, apiKey, signal, file.type || info.mime);
    if (!upload?.id) throw new Error('Mistral no devolvio un ID de archivo.');
    onProgress?.('Ejecutando OCR en Mistral...');
    ocr = await runMistralOcrFile(upload.id, apiKey, { includeImages, extractHeader, extractFooter }, signal);
  }

  onProgress?.('Guardando resultado local...');
  const entry = await saveCompletedOcr({
    hash,
    name: file.name || 'document',
    sourceName: file.name || 'document',
    fileSize: file.size || 0,
    mimeType: file.type || info.mime,
    resourceKind: info.resourceKind,
    ocr,
    includeImages
  });
  return { hash, entry };
}
