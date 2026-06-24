import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Only the pure, native-free units are tested here (requireGrant, the
    // synthetic-input marker); the Electron/nut.js/uiohook adapters need hardware.
    include: ['src/**/*.test.ts'],
  },
});
