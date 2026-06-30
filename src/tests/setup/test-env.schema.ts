import { z } from 'zod';

export const TestEnvSchema = z.object({
  NODE_ENV: z.literal('test'),
  TEST_DB_REUSE: z.coerce.boolean().default(false),
  TEST_LOG_LEVEL: z
    .enum(['silent', 'error', 'info', 'debug'])
    .default('silent'),
  TEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  COVERAGE_LINES: z.coerce.number().min(0).max(100).default(80),
  COVERAGE_BRANCHES: z.coerce.number().min(0).max(100).default(75),
  COVERAGE_FUNCTIONS: z.coerce.number().min(0).max(100).default(80),
  COVERAGE_STATEMENTS: z.coerce.number().min(0).max(100).default(80),
  PLAYWRIGHT_BASE_URL: z.string().url().default('http://localhost:3000'),
});

export type TestEnv = z.infer<typeof TestEnvSchema>;
