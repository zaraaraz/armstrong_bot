import { Controller, Get, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from '../../core/health/health.service';
import { Public } from '../auth/decorators/public.decorator';
import { ApiPublic } from '../common/decorators/api-protected.decorator';

/**
 * Versioned health surface under `/api/v1`. Reuses the core {@link HealthService}
 * (DB/Redis/queue contributors) — the API owns no health logic of its own.
 */
@ApiTags('health')
@ApiPublic()
@Controller('api/v1')
export class ApiHealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get('health')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ description: 'Process is alive' })
  liveness(): { status: string; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  @Get('ready')
  @Public()
  @ApiOperation({ summary: 'Readiness probe (DB/Redis/queue)' })
  @ApiOkResponse({ description: 'Aggregated readiness' })
  async readiness(): Promise<unknown> {
    return this.health.check();
  }
}
