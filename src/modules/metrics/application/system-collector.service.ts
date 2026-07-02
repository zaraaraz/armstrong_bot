import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Gauge,
  register as defaultRegister,
} from 'prom-client';
import { MemoryCacheStore } from '../../../cache/stores/memory-cache.store';
import { MetricsRegistry } from '../infrastructure/metrics.registry';
import { MetricsConfigService } from '../config/metrics-config.service';
import { MetricName } from '../domain/metric-name.enum';
import { METRIC_CATALOG } from '../domain/metric-definition';

/**
 * Registers prom-client's default process/runtime metrics and custom pull-based
 * collectors. Pull collectors use prom-client gauge `collect` callbacks so the
 * value is computed lazily at scrape time — nothing runs on the hot path, and a
 * throwing collector degrades gracefully (logged, scrape still returns 200
 * because prom-client isolates per-metric collect errors from the registry).
 */
@Injectable()
export class SystemCollectorService implements OnModuleInit {
  private readonly logger = new Logger('metrics.collector');

  constructor(
    private readonly registry: MetricsRegistry,
    private readonly config: MetricsConfigService,
    private readonly memoryCache: MemoryCacheStore,
  ) {}

  onModuleInit(): void {
    const cfg = this.config.global();
    if (!cfg.enabled) return;

    this.registry.setDefaultBuckets(cfg.histogramBucketsSeconds);

    if (cfg.defaultMetricsEnabled) {
      // Default metrics register on prom-client's default registry; attach it so
      // the aggregated exposition includes CPU/RSS/GC/handles/event-loop lag.
      try {
        collectDefaultMetrics();
        this.registry.attach(defaultRegister);
      } catch (err) {
        this.logger.error(
          `default metrics init failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.registerCacheHitRatio();
  }

  /**
   * Cache hit-ratio gauge, computed at scrape time from the memory store's
   * running hit/miss counters. Registered directly on the module registry with
   * a `collect` callback so it never needs a periodic writer.
   */
  private registerCacheHitRatio(): void {
    const def = METRIC_CATALOG[MetricName.CacheHitRatio];
    const store = this.memoryCache;
    const gauge = new Gauge({
      name: def.name,
      help: def.help,
      collect() {
        try {
          const total = store.hits + store.misses;
          this.set(total > 0 ? store.hits / total : 0);
        } catch {
          this.set(0);
        }
      },
    });
    this.registry.registerRaw(gauge);
  }
}
