import { describe, expect, it } from 'vitest';
import { shortcutFor } from './shortcuts';

// A keydown as the browser would send it, from `target`
const keydown = (key, target = document.body, mods = {}) => ({ key, target, ...mods });

describe('shortcutFor', () => {
  it('matches the keys on event.key, either case', () => {
    expect(shortcutFor(keydown('n'))).toBe('add');
    expect(shortcutFor(keydown('N', document.body, { shiftKey: true }))).toBe('add');
    expect(shortcutFor(keydown('/'))).toBe('search');
    expect(shortcutFor(keydown('b'))).toBe('board');
    expect(shortcutFor(keydown('C'))).toBe('calendar');
    expect(shortcutFor(keydown('?', document.body, { shiftKey: true }))).toBe('help');
    expect(shortcutFor(keydown('x'))).toBeNull();
  });

  it('ignores them with Ctrl, Alt or Meta held', () => {
    expect(shortcutFor(keydown('n', document.body, { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(keydown('n', document.body, { altKey: true, shiftKey: true }))).toBeNull();
    expect(shortcutFor(keydown('c', document.body, { metaKey: true }))).toBeNull();
  });

  it('ignores them while you type in an input, textarea, select or editable element', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const inside = document.createElement('span');
    editable.appendChild(inside);
    for (const target of [
      document.createElement('input'),
      document.createElement('textarea'),
      document.createElement('select'),
      editable,
      inside,
    ])
    {
      expect(shortcutFor(keydown('n', target))).toBeNull();
    }
  });
});
