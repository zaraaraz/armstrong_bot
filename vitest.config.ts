import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/tests/setup/vitest.setup.ts'],
    include: ['src/**/*.spec.ts'],
    exclude: [
      'src/**/*.int-spec.ts',
      'src/**/*.contract-spec.ts',
      'src/dashboard/e2e/**',
    ],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage/unit',
      thresholds: { lines: 80, branches: 75, functions: 80, statements: 80 },
      exclude: [
        '**/*.spec.ts',
        '**/*.int-spec.ts',
        '**/*.contract-spec.ts',
        'src/tests/**',
        '**/*.dto.ts',
        'dist/**',
      ],
    },
  },
});
