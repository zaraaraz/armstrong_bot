import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ShutdownService } from './core/kernel/shutdown.service';
import { buildOpenApiDocument, setupSwagger } from './api/swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // Capture the raw request body so webhook signature verification can run
    // over the exact bytes the provider signed.
    rawBody: true,
  });

  const document = buildOpenApiDocument(app);
  setupSwagger(app, document, 'api/docs');

  const shutdown = app.get(ShutdownService);
  const timeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 15_000);
  shutdown.enableShutdownHooks(app, timeoutMs);

  const port = Number(process.env.HTTP_PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
