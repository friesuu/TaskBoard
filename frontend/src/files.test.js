import { describe, expect, it } from 'vitest';
import { ACCEPT, fileKind, formatBytes, problemWithFile } from './files';

// A stand-in for a file chosen in the browser: only the name and size matter here
const file = (name, size) => ({ name, size });

describe('files', () => {
  it('describes files by their extension', () => {
    expect(fileKind('photo.PNG')).toBe('PNG image');
    expect(fileKind('report.docx')).toBe('Word document');
    expect(fileKind('README')).toBe('File');
  });

  it('shows sizes in B, KB or MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(14540)).toBe('14.2 KB');
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
  });

  it('offers only the allowed types in the file picker', () => {
    expect(ACCEPT).toBe('.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.docx,.xlsx,.pptx,.zip');
  });

  it('accepts an allowed file, and explains what is wrong with others', () => {
    expect(problemWithFile(file('photo.png', 2000))).toBeNull();
    expect(problemWithFile(file('drawing.svg', 2000))).toMatch(/can't be attached/);
    expect(problemWithFile(file('empty.txt', 0))).toBe('The file is empty');
    expect(problemWithFile(file('huge.pdf', 10 * 1024 * 1024 + 1))).toBe('The file is too big (10 MB at most)');
  });
});
