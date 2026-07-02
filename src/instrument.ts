/**
 * Side-effect entrypoint that starts OpenTelemetry BEFORE any instrumented
 * library (http, express, ioredis, prisma) is imported. It must be the very
 * first import in `main.ts` so the auto-instrumentations can patch those modules
 * as they load. Kept separate from main.ts so import ordering is unambiguous.
 */
import { startTracing } from './modules/metrics/tracing';

startTracing();
