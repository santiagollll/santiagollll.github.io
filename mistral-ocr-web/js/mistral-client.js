import { mimeFromExt } from './utils.js';

const API_BASE = 'https://api.mistral.ai/v1';

function fileMimeFromName(fileName, fallbackType) {
  if (fallbackType) return fallbackType.split(';')[0];
  const ext = (String(fileName || '').split('.').pop() || '').toLowerCase();
  return mimeFromExt(ext);
}

async function errorText(response) {
  const body = await response.text().catch(() => '');
  return body ? `HTTP ${response.status}: ${body}` : `HTTP ${response.status}`;
}

export async function uploadFileToMistralOcr(ab, fileName, apiKey, signal, contentType = '') {
  const file = new File([ab], fileName, { type: fileMimeFromName(fileName, contentType) });
  const form = new FormData();
  form.append('file', file);
  form.append('purpose', 'ocr');

  const res = await fetch(`${API_BASE}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal
  });

  if (!res.ok) throw new Error(`No se pudo subir el archivo a Mistral. ${await errorText(res)}`);
  return res.json();
}

function buildOcrBody(document, options) {
  return {
    document,
    model: 'mistral-ocr-latest',
    include_image_base64: !!options.includeImages,
    extract_header: !!options.extractHeader,
    extract_footer: !!options.extractFooter,
    confidence_scores_granularity: 'word'
  };
}

export async function runMistralOcrFile(fileId, apiKey, options, signal) {
  const res = await fetch(`${API_BASE}/ocr`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(buildOcrBody({ file_id: fileId }, options || {})),
    signal
  });

  if (!res.ok) throw new Error(`Mistral no pudo procesar el archivo. ${await errorText(res)}`);
  return res.json();
}

export async function runMistralOcrImage(imageDataUrl, apiKey, options, signal) {
  const res = await fetch(`${API_BASE}/ocr`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(buildOcrBody({ type: 'image_url', image_url: imageDataUrl }, options || {})),
    signal
  });

  if (!res.ok) throw new Error(`Mistral no pudo procesar la imagen. ${await errorText(res)}`);
  return res.json();
}
