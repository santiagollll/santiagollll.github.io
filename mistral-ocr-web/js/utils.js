export function ab2hex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(ab) {
  const digest = await crypto.subtle.digest('SHA-256', ab);
  return ab2hex(digest);
}

export function mimeFromExt(ext) {
  const normalized = (ext || '').toLowerCase();
  if (normalized === 'jpg' || normalized === 'jpeg') return 'image/jpeg';
  if (normalized === 'png') return 'image/png';
  if (normalized === 'gif') return 'image/gif';
  if (normalized === 'webp') return 'image/webp';
  if (normalized === 'avif') return 'image/avif';
  if (normalized === 'tif' || normalized === 'tiff') return 'image/tiff';
  if (normalized === 'heic') return 'image/heic';
  if (normalized === 'heif') return 'image/heif';
  if (normalized === 'bmp') return 'image/bmp';
  if (normalized === 'md') return 'text/markdown';
  if (normalized === 'json') return 'application/json';
  if (normalized === 'pdf') return 'application/pdf';
  if (normalized === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (normalized === 'doc') return 'application/msword';
  if (normalized === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (normalized === 'ppt') return 'application/vnd.ms-powerpoint';
  if (normalized === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (normalized === 'csv') return 'text/csv';
  if (normalized === 'txt') return 'text/plain';
  if (normalized === 'epub') return 'application/epub+zip';
  if (normalized === 'xml') return 'application/xml';
  if (normalized === 'rtf') return 'application/rtf';
  if (normalized === 'odt') return 'application/vnd.oasis.opendocument.text';
  if (normalized === 'ipynb') return 'application/x-ipynb+json';
  if (normalized === 'tex') return 'application/x-tex';
  return 'application/octet-stream';
}

export function guessImageMime(url, contentType) {
  if (contentType && contentType.startsWith('image/')) return contentType.split(';')[0];
  const ext = String(url || '').split('?')[0].split('.').pop().toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'avif') return 'image/avif';
  if (ext === 'tif' || ext === 'tiff') return 'image/tiff';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  if (ext === 'bmp') return 'image/bmp';
  return 'image/jpeg';
}

export function arrayBufferToBase64(ab) {
  const bytes = new Uint8Array(ab);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function normalizeBase64Payload(value) {
  if (!value) return '';
  let normalized = String(value).trim();
  const commaIndex = normalized.indexOf(',');
  if (normalized.startsWith('data:') && commaIndex >= 0) normalized = normalized.slice(commaIndex + 1);
  normalized = normalized.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const remainder = normalized.length % 4;
  if (remainder) normalized += '='.repeat(4 - remainder);
  return normalized;
}

export function base64ToBytes(b64) {
  const normalized = normalizeBase64Payload(b64);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64ToDataUrl(base64OrDataUrl, fallbackName = 'image.jpeg') {
  if (base64OrDataUrl.startsWith('data:')) return base64OrDataUrl;
  const ext = fallbackName.split('.').pop() || 'jpeg';
  return `data:${mimeFromExt(ext)};base64,${base64OrDataUrl}`;
}

export function dataUrlFromText(text, type = 'text/plain') {
  return `data:${type};charset=utf-8,${encodeURIComponent(text)}`;
}

export function extractMarkdownImageNames(markdown) {
  const names = [];
  const re = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = re.exec(markdown)) !== null) names.push(match[1]);
  return names;
}

export function pickImageFileName(index, page, namesFromMd, imageObj) {
  if (namesFromMd[index]) return namesFromMd[index];
  if (imageObj?.id) return imageObj.id;
  return `img-${page.index}-${index}.jpeg`;
}

export function sanitizeFileName(name, fallback = 'document') {
  const cleaned = (name || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return cleaned || fallback;
}

export function stripFileExtension(name) {
  const safeName = sanitizeFileName(name, 'document');
  return safeName.replace(/\.[A-Za-z0-9]{1,8}$/, '') || 'document';
}

function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function writeU16(out, value) {
  out.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeU32(out, value) {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

export function createZipFromFiles(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files || []) {
    const nameBytes = encoder.encode(sanitizeFileName(file.name || 'file.bin', 'file.bin'));
    const data = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes || []);
    const crc = crc32(data);
    const local = [];
    writeU32(local, 0x04034b50);
    writeU16(local, 20);
    writeU16(local, 0);
    writeU16(local, 0);
    writeU16(local, 0);
    writeU16(local, 0);
    writeU32(local, crc);
    writeU32(local, data.length);
    writeU32(local, data.length);
    writeU16(local, nameBytes.length);
    writeU16(local, 0);
    localParts.push(new Uint8Array(local), nameBytes, data);

    const central = [];
    writeU32(central, 0x02014b50);
    writeU16(central, 20);
    writeU16(central, 20);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU32(central, crc);
    writeU32(central, data.length);
    writeU32(central, data.length);
    writeU16(central, nameBytes.length);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU32(central, 0);
    writeU32(central, offset);
    centralParts.push(new Uint8Array(central), nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = [];
  writeU32(end, 0x06054b50);
  writeU16(end, 0);
  writeU16(end, 0);
  writeU16(end, files.length);
  writeU16(end, files.length);
  writeU32(end, centralSize);
  writeU32(end, offset);
  writeU16(end, 0);

  const parts = [...localParts, ...centralParts, new Uint8Array(end)];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const zip = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    zip.set(part, cursor);
    cursor += part.length;
  }
  return zip;
}
