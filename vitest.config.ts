import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // desktop/src/store has no Electron imports, so its tests run here too.
    include: [
      'src/**/*.test.ts',
      'lib/**/*.test.ts',
      'tests/**/*.test.ts',
      'desktop/src/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'lib/**'],
    },
  },
});
