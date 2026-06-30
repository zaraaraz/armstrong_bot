import { TestEnvSchema } from './test-env.schema';

// Enforce NODE_ENV=test at suite start — fails fast with a clear message if misconfigured.
const result = TestEnvSchema.safeParse({
  ...process.env,
  NODE_ENV: process.env['NODE_ENV'] ?? 'test',
});
if (!result.success) {
  console.error(
    '❌ Invalid test environment:',
    result.error.flatten().fieldErrors,
  );
  process.exit(1);
}

// Silence logs in tests unless TEST_LOG_LEVEL overrides it.
process.env['TEST_LOG_LEVEL'] ??= 'silent';
