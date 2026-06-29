import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  resolveSecurityConfig,
  type SecurityConfig,
} from '../schemas/security-config.schema';
import type { UpdateSecurityConfigDto } from '../dto/update-security-config.dto';

const SETTINGS_NAMESPACE = 'security';

interface GuildConfigRow {
  settings: unknown;
}

/**
 * Reads/writes per-guild security config, persisted under the
 * `GuildConfig.settings.security` JSON namespace. Resolution order is
 * ENV → Database → Defaults (the Zod schema supplies the defaults).
 */
@Injectable()
export class SecurityConfigService {
  private readonly logger = new Logger(SecurityConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  async get(guildId: string): Promise<SecurityConfig> {
    const row = (await this.prisma['guildConfig'].findUnique({
      where: { guildId },
    })) as GuildConfigRow | null;

    const stored = this.extractStored(row);
    return resolveSecurityConfig(stored);
  }

  async update(
    guildId: string,
    patch: UpdateSecurityConfigDto,
  ): Promise<SecurityConfig> {
    const current = await this.get(guildId);
    const merged = resolveSecurityConfig({ ...current, ...patch });

    const row = (await this.prisma['guildConfig'].findUnique({
      where: { guildId },
    })) as { settings: unknown } | null;
    const settings = this.asObject(row?.settings);
    settings[SETTINGS_NAMESPACE] = merged;

    await this.prisma['guildConfig'].update({
      where: { guildId },
      data: { settings: settings as Prisma.InputJsonValue },
    });

    return merged;
  }

  private extractStored(row: GuildConfigRow | null): unknown {
    if (!row) return {};
    const settings = this.asObject(row.settings);
    return settings[SETTINGS_NAMESPACE] ?? {};
  }

  private asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? { ...(value as Record<string, unknown>) }
      : {};
  }
}
