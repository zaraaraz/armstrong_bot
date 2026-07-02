import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { MetricsService } from '../application/metrics.service.contract';
import { MetricsScrapeGuard } from './metrics-scrape.guard';

/**
 * Internal Prometheus scrape endpoint. Deliberately excluded from Swagger and
 * guarded by bearer token + CIDR allow-list. Never carries guild data or
 * high-cardinality labels. Degrades gracefully — if a collector throws, the
 * registry still renders the remaining families with a 200.
 */
@ApiExcludeController()
@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  @UseGuards(MetricsScrapeGuard)
  async scrape(@Res() res: Response): Promise<void> {
    let body: string;
    try {
      body = await this.metrics.render();
    } catch {
      // A registry-level failure must not 500 the scrape endpoint.
      body = '';
    }
    res.setHeader('Content-Type', this.metrics.contentType);
    res.send(body);
  }
}
