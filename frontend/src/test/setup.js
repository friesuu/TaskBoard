import '@testing-library/jest-dom/vitest'; // adds checks like toBeInTheDocument() and toBeDisabled()
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// The pretend browser (jsdom) can't scroll, so it has no scrollIntoView. ChatPanel uses it.
window.HTMLElement.prototype.scrollIntoView = function () {};

afterEach(() => {
  cleanup(); // remove whatever the test rendered, so tests can't affect each other
  vi.restoreAllMocks(); // undo any spies (e.g. on window.confirm)
});
