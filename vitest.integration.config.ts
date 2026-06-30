import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/tests/setup/vitest.setup.ts'],
    include: ['src/**/*.int-spec.ts', 'src/**/*.contract-spec.ts'],
    testTimeout: 120_000,
    fileParallelism: false,
    pool: 'forks',
  },
});
