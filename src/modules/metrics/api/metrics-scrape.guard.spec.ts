import { describe, expect, it } from 'vitest';
import { MetricsScrapeGuard } from './metrics-scrape.guard';
import type { MetricsConfigService } from '../config/metrics-config.service';
import type { ExecutionContext } from '@nestjs/common';

interface FakeReq {
  headers: Record<string, string>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

function ctx(req: FakeReq): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function guardWith(
  cfg: Partial<{
    endpointBearerToken?: string;
    endpointAllowlistCidrs: string[];
  }>,
): MetricsScrapeGuard {
  const config = {
    global: () => ({
      endpointBearerToken: cfg.endpointBearerToken,
      endpointAllowlistCidrs: cfg.endpointAllowlistCidrs ?? [],
    }),
  } as unknown as MetricsConfigService;
  return new MetricsScrapeGuard(config);
}

describe('MetricsScrapeGuard', () => {
  it('allows a request with the correct bearer token', () => {
    const guard = guardWith({
      endpointBearerToken: 'super-secret-token-value',
      endpointAllowlistCidrs: [],
    });
    const ok = guard.canActivate(
      ctx({ headers: { authorization: 'Bearer super-secret-token-value' } }),
    );
    expect(ok).toBe(true);
  });

  it('rejects a wrong bearer token off the allow-list', () => {
    const guard = guardWith({
      endpointBearerToken: 'super-secret-token-value',
      endpointAllowlistCidrs: [],
    });
    const ok = guard.canActivate(
      ctx({ headers: { authorization: 'Bearer nope' }, ip: '8.8.8.8' }),
    );
    expect(ok).toBe(false);
  });

  it('allows a request from an allow-listed CIDR without a token', () => {
    const guard = guardWith({ endpointAllowlistCidrs: ['127.0.0.1/32'] });
    const ok = guard.canActivate({
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, ip: '127.0.0.1' }),
      }),
    } as unknown as ExecutionContext);
    expect(ok).toBe(true);
  });

  it('rejects a request off the allow-list with no token configured', () => {
    const guard = guardWith({ endpointAllowlistCidrs: ['127.0.0.1/32'] });
    const ok = guard.canActivate(ctx({ headers: {}, ip: '10.0.0.9' }));
    expect(ok).toBe(false);
  });

  it('falls back to the allow-list when a token is configured but not sent', () => {
    const guard = guardWith({
      endpointBearerToken: 'super-secret-token-value',
      endpointAllowlistCidrs: ['10.0.0.0/8'],
    });
    const ok = guard.canActivate(ctx({ headers: {}, ip: '10.1.2.3' }));
    expect(ok).toBe(true);
  });
});
