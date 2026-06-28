import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';

@Injectable()
export class ShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(ShutdownService.name);
  private app: INestApplication | null = null;

  setApp(app: INestApplication): void {
    this.app = app;
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Shutdown initiated${signal ? ` (signal: ${signal})` : ''}`);
  }

  enableShutdownHooks(app: INestApplication, timeoutMs = 15_000): void {
    this.setApp(app);
    app.enableShutdownHooks();

    const signals = ['SIGTERM', 'SIGINT'] as const;
    for (const signal of signals) {
      process.on(signal, () => {
        this.logger.log(`Received ${signal} — starting graceful shutdown`);
        const timer = setTimeout(() => {
          this.logger.error(`Shutdown timeout (${timeoutMs}ms) exceeded — forcing exit`);
          process.exit(1);
        }, timeoutMs);
        timer.unref();
        void app.close();
      });
    }
  }
}
