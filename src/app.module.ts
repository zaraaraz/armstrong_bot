import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { DatabaseModule } from './database/database.module';
import { CacheModule } from './cache/cache.module';
import { I18nModule } from './core/i18n/i18n.module';
import { PermissionsModule } from './core/permissions/permissions.module';
import { EventBusModule } from './core/events/event-bus.module';
import { SecurityModule } from './shared/security/security.module';
import { PluginsModule } from './core/plugins/plugins.module';
import { TestingModule } from './core/testing/testing.module';
import { ApiModule } from './api/api.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';

@Module({
  imports: [
    CoreModule,
    DatabaseModule,
    CacheModule,
    I18nModule,
    PermissionsModule,
    EventBusModule,
    SecurityModule,
    PluginsModule,
    TestingModule,
    ApiModule,
    DashboardModule,
    SchedulerModule,
  ],
})
export class AppModule {}
