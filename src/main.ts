import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ShutdownService } from './core/kernel/shutdown.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const swagger = new DocumentBuilder()
    .setTitle('Armstrong Bot API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));

  const shutdown = app.get(ShutdownService);
  const timeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 15_000);
  shutdown.enableShutdownHooks(app, timeoutMs);

  const port = Number(process.env.HTTP_PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
