import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure-logic unit tests (no DOM) — resolver + reducers. Component rendering
    // is out of scope for now; node env keeps it fast.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
