import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { MetricsConfigService } from '../config/metrics-config.service';
import { ipInAnyCidr } from '../domain/cidr.util';

/**
 * Guards the internal `/metrics` scrape endpoint. Access requires EITHER a valid
 * bearer token (when one is configured) OR a source IP inside the configured
 * CIDR allow-list. If a bearer token is configured it is authoritative; the
 * allow-list is the fallback for token-less collectors on trusted networks.
 *
 * Returns false (403) on any failure and warns with the source IP so scrape
 * misconfiguration is visible without leaking guild data.
 */
@Injectable()
export class MetricsScrapeGuard implements CanActivate {
  private readonly logger = new Logger('metrics.scrape');

  constructor(private readonly config: MetricsConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const cfg = this.config.global();
    const req = context.switchToHttp().getRequest<Request>();

    if (cfg.endpointBearerToken) {
      const provided = this.bearer(req);
      if (provided && this.timingSafeEqual(provided, cfg.endpointBearerToken)) {
        return true;
      }
    }

    const ip = this.sourceIp(req);
    if (ip && ipInAnyCidr(ip, cfg.endpointAllowlistCidrs)) return true;

    this.logger.warn(`scrape rejected from ${ip ?? 'unknown'}`);
    return false;
  }

  private bearer(req: Request): string | null {
    const header = req.headers['authorization'];
    if (typeof header !== 'string') return null;
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
  }

  private sourceIp(req: Request): string | null {
    return (
      req.ip ??
      (req.socket && 'remoteAddress' in req.socket
        ? (req.socket.remoteAddress ?? null)
        : null)
    );
  }

  /** Constant-time compare to avoid leaking the token via timing. */
  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i += 1) {
      mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return mismatch === 0;
  }
}
