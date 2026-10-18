// Attachments: what may be uploaded, and how files are described on screen.
// The server checks all of this again (and more: the file's actual contents); these checks just give
// a quick, clear message before a large file is sent for nothing.

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB, the same as the server

// Extension -> how it's described in the list
const KINDS = {
    png: 'PNG image',
    jpg: 'JPEG image',
    jpeg: 'JPEG image',
    gif: 'GIF image',
    webp: 'WebP image',
    pdf: 'PDF',
    txt: 'Text',
    csv: 'CSV',
    docx: 'Word document',
    xlsx: 'Excel spreadsheet',
    pptx: 'PowerPoint',
    zip: 'ZIP archive',
};

// For the file picker, so it offers these types first: ".png,.jpg,..."
export const ACCEPT = Object.keys(KINDS).map((ext) => `.${ext}`).join(',');

const extensionOf = (fileName) => (fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '');

// "PNG image", "Word document"... (or "File" for anything unexpected)
export function fileKind(fileName)
{
    return KINDS[extensionOf(fileName)] ?? 'File';
}

// "512 B", "14.2 KB", "3.4 MB"
export function formatBytes(bytes)
{
    const oneDecimal = (n) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${oneDecimal(bytes / 1024)} KB`;
    return `${oneDecimal(bytes / (1024 * 1024))} MB`;
}

// What's wrong with a chosen file, or null if it may be uploaded
export function problemWithFile(file)
{
    if (!KINDS[extensionOf(file.name)])
    {
        return "This kind of file can't be attached. Allowed: PNG, JPEG, GIF, WebP, PDF, TXT, CSV, DOCX, XLSX, PPTX, ZIP";
    }
    if (file.size === 0) return 'The file is empty';
    if (file.size > MAX_FILE_SIZE) return 'The file is too big (10 MB at most)';
    return null;
}
