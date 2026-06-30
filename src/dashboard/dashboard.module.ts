import { Module } from '@nestjs/common';
import {
  DASHBOARD_CONFIG,
  resolveDashboardConfig,
} from './backend/config/dashboard.config.schema';
// Repositories
import {
  DashboardSessionRepository,
  PrismaDashboardSessionRepository,
} from './backend/repositories/session.repository';
import {
  BackupRepository,
  PrismaBackupRepository,
} from './backend/repositories/backup.repository';
import {
  DashboardAuditRepository,
  PrismaDashboardAuditRepository,
} from './backend/repositories/audit.repository';
// Services
import { DashboardOAuthService } from './backend/services/discord-oauth.service';
import { DashboardSessionService } from './backend/services/session.service';
import { DashboardAuthService } from './backend/services/auth.service';
import { GuildAccessService } from './backend/services/guild-access.service';
import { DashboardApiKeyService } from './backend/services/api-key.service';
import { BackupService } from './backend/services/backup.service';
import { DashboardAggregationService } from './backend/services/dashboard-aggregation.service';
// Guards
import { SessionGuard } from './backend/guards/session.guard';
import { GuildManageGuard } from './backend/guards/guild-manage.guard';
import { ClaimGuard } from './backend/guards/claim.guard';
// Gateway
import { TicketService } from './backend/gateway/ticket.service';
import { DashboardGateway } from './backend/gateway/dashboard.gateway';
// Controllers
import { DashboardAuthController } from './backend/controllers/auth.controller';
import { GuildsController } from './backend/controllers/guilds.controller';
import { DashboardApiKeysController } from './backend/controllers/api-keys.controller';
import { BackupsController } from './backend/controllers/backups.controller';
import { RealtimeController } from './backend/controllers/realtime.controller';

/**
 * Dashboard backend (BFF). Exposes the dashboard-only REST + WebSocket surface
 * under `/api/dashboard`, consuming only CORE systems and `@shared/security`.
 * The Next.js frontend (separate deployable) calls this surface and nothing
 * else.
 */
@Module({
  controllers: [
    DashboardAuthController,
    GuildsController,
    DashboardApiKeysController,
    BackupsController,
    RealtimeController,
  ],
  providers: [
    { provide: DASHBOARD_CONFIG, useFactory: () => resolveDashboardConfig() },
    // Repositories
    {
      provide: DashboardSessionRepository,
      useClass: PrismaDashboardSessionRepository,
    },
    { provide: BackupRepository, useClass: PrismaBackupRepository },
    {
      provide: DashboardAuditRepository,
      useClass: PrismaDashboardAuditRepository,
    },
    // Services
    DashboardOAuthService,
    DashboardSessionService,
    DashboardAuthService,
    GuildAccessService,
    DashboardApiKeyService,
    BackupService,
    DashboardAggregationService,
    // Guards
    SessionGuard,
    GuildManageGuard,
    ClaimGuard,
    // Gateway
    TicketService,
    DashboardGateway,
  ],
})
export class DashboardModule {}
