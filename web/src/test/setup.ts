import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  document.title = '';
  // What a test kept in this browser (a ready Handover, HAND-6.4; the right sidebar's layout) isn't the next one's.
  window.localStorage.clear();
});
