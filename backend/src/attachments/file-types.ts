import { BadRequestException } from '@nestjs/common';

// Which files may be attached, and how we recognise each one.
// We never trust the browser's word for the type: the extension must be on this list AND the
// file's first bytes (its "signature") must look like that kind of file. A script renamed to
// photo.png fails the second check. SVG and HTML are left out on purpose: they can contain scripts.

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Do the bytes at `offset` match `signature`? (numbers, or a string of plain characters)
const startsWith = (bytes: Buffer, signature: number[] | string, offset = 0): boolean => {
  const expected = typeof signature === 'string' ? [...signature].map((c) => c.charCodeAt(0)) : signature;
  return expected.every((byte, i) => bytes[offset + i] === byte);
};

// DOCX, XLSX and PPTX are ZIP files inside, so they all start like a ZIP
const isZip = (bytes: Buffer) => startsWith(bytes, 'PK\x03\x04') || startsWith(bytes, 'PK\x05\x06');

// Plain text: no zero bytes, and valid UTF-8 all the way through
const isText = (bytes: Buffer): boolean => {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

interface FileType {
  mimeType: string; // what the download says it is
  looksRight: (bytes: Buffer) => boolean;
}

const JPEG: FileType = { mimeType: 'image/jpeg', looksRight: (b) => startsWith(b, [0xff, 0xd8, 0xff]) };

export const ALLOWED_TYPES: Record<string, FileType> = {
  png: { mimeType: 'image/png', looksRight: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg: JPEG,
  jpeg: JPEG,
  gif: { mimeType: 'image/gif', looksRight: (b) => startsWith(b, 'GIF87a') || startsWith(b, 'GIF89a') },
  webp: { mimeType: 'image/webp', looksRight: (b) => startsWith(b, 'RIFF') && startsWith(b, 'WEBP', 8) },
  pdf: { mimeType: 'application/pdf', looksRight: (b) => startsWith(b, '%PDF-') },
  txt: { mimeType: 'text/plain; charset=utf-8', looksRight: isText },
  csv: { mimeType: 'text/csv; charset=utf-8', looksRight: isText },
  docx: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', looksRight: isZip },
  xlsx: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', looksRight: isZip },
  pptx: { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', looksRight: isZip },
  zip: { mimeType: 'application/zip', looksRight: isZip },
};

const ALLOWED_LIST = 'PNG, JPEG, GIF, WebP, PDF, TXT, CSV, DOCX, XLSX, PPTX, ZIP';

// Checks a file and returns the type we'll store. Throws a 400 with a readable message if it isn't allowed.
export function checkFile(fileName: string, bytes: Buffer): { mimeType: string } {
  const extension = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  const type = ALLOWED_TYPES[extension];
  if (!type) {
    throw new BadRequestException(`This kind of file can't be attached. Allowed: ${ALLOWED_LIST}`);
  }
  if (bytes.length === 0) {
    throw new BadRequestException('The file is empty');
  }
  if (!type.looksRight(bytes)) {
    throw new BadRequestException(`The file's contents don't match its .${extension} extension`);
  }
  return { mimeType: type.mimeType };
}

// A safe, readable name to store and show: no folders, no control characters, at most 200 characters.
export function cleanFileName(originalName: string): string {
  // The upload library reads non-English names as Latin-1; turn them back into proper UTF-8 when we can
  const utf8 = Buffer.from(originalName, 'latin1').toString('utf8');
  const name = utf8.includes('�') ? originalName : utf8;

  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (clean.length <= 200) return clean || 'file';

  // Too long: shorten the name but keep the extension
  const dot = clean.lastIndexOf('.');
  const extension = dot > 0 ? clean.slice(dot) : '';
  return clean.slice(0, 200 - extension.length) + extension;
}
