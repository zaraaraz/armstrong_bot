import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type {
  PluginStatus as PrismaPluginStatus,
  PluginScope as PrismaPluginScope,
} from '@prisma/client';
import type { PluginManifest } from '../contracts/plugin-manifest.interface';
import { PluginStatus, PluginScope } from '../contracts/plugin.enums';

export interface PluginRecord {
  id: string;
  name: string;
  displayName: string;
  version: string;
  author: string;
  scope: PluginScope;
  status: PluginStatus;
  sdkRange: string;
  checksum: string | null;
  manifest: unknown;
  installedAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface PluginEnablementRecord {
  id: string;
  pluginId: string;
  guildId: string | null;
  enabled: boolean;
  enabledBy: string;
  enabledAt: Date;
  deletedAt: Date | null;
}

export interface ListPluginsFilter {
  status?: PrismaPluginStatus;
  guildId?: string;
  page?: number;
  pageSize?: number;
}

function toPluginStatus(s: PrismaPluginStatus): PluginStatus {
  const map: Record<PrismaPluginStatus, PluginStatus> = {
    INSTALLED: PluginStatus.Installed,
    ENABLED: PluginStatus.Enabled,
    DISABLED: PluginStatus.Disabled,
    ERRORED: PluginStatus.Errored,
    UPDATING: PluginStatus.Updating,
    REMOVED: PluginStatus.Removed,
  };
  return map[s];
}

function toPrismaStatus(s: PluginStatus): PrismaPluginStatus {
  const map: Record<PluginStatus, PrismaPluginStatus> = {
    [PluginStatus.Installed]: 'INSTALLED',
    [PluginStatus.Enabled]: 'ENABLED',
    [PluginStatus.Disabled]: 'DISABLED',
    [PluginStatus.Errored]: 'ERRORED',
    [PluginStatus.Updating]: 'UPDATING',
    [PluginStatus.Removed]: 'REMOVED',
  };
  return map[s];
}

function toPluginScope(s: PrismaPluginScope): PluginScope {
  return s === 'GLOBAL' ? PluginScope.Global : PluginScope.Guild;
}

function toPrismaScope(s: PluginScope): PrismaPluginScope {
  return s === PluginScope.Global ? 'GLOBAL' : 'GUILD';
}

function mapRecord(p: {
  id: string;
  name: string;
  displayName: string;
  version: string;
  author: string;
  scope: PrismaPluginScope;
  status: PrismaPluginStatus;
  sdkRange: string;
  checksum: string | null;
  manifest: unknown;
  installedAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}): PluginRecord {
  return {
    ...p,
    scope: toPluginScope(p.scope),
    status: toPluginStatus(p.status),
  };
}

@Injectable()
export class PluginRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByName(name: string): Promise<PluginRecord | null> {
    const row = await this.prisma.plugin.findFirst({
      where: { name, deletedAt: null },
    });
    return row ? mapRecord(row) : null;
  }

  async findById(id: string): Promise<PluginRecord | null> {
    const row = await this.prisma.plugin.findFirst({
      where: { id, deletedAt: null },
    });
    return row ? mapRecord(row) : null;
  }

  async list(
    filter: ListPluginsFilter,
  ): Promise<{ items: PluginRecord[]; total: number }> {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = { deletedAt: null };
    if (filter.status) where['status'] = filter.status;

    if (filter.guildId) {
      where['enablements'] = {
        some: { guildId: filter.guildId, enabled: true, deletedAt: null },
      };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.plugin.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { name: 'asc' },
      }),
      this.prisma.plugin.count({ where }),
    ]);

    return { items: rows.map(mapRecord), total };
  }

  async create(data: {
    name: string;
    displayName: string;
    version: string;
    author: string;
    scope: PluginScope;
    sdkRange: string;
    checksum?: string;
    manifest: PluginManifest;
  }): Promise<PluginRecord> {
    const row = await this.prisma.plugin.create({
      data: {
        name: data.name,
        displayName: data.displayName,
        version: data.version,
        author: data.author,
        scope: toPrismaScope(data.scope),
        sdkRange: data.sdkRange,
        checksum: data.checksum ?? null,
        manifest: data.manifest as unknown as Prisma.InputJsonValue,
        status: 'INSTALLED',
      },
    });
    return mapRecord(row);
  }

  async updateStatus(id: string, status: PluginStatus): Promise<void> {
    await this.prisma.plugin.update({
      where: { id },
      data: { status: toPrismaStatus(status) },
    });
  }

  async updateVersion(
    id: string,
    version: string,
    actorId: string,
    fromVersion: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.plugin.update({
        where: { id },
        data: { version, status: 'INSTALLED' },
      }),
      this.prisma.pluginVersionHistory.create({
        data: { pluginId: id, fromVersion, toVersion: version, actorId },
      }),
    ]);
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.plugin.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'REMOVED' },
    });
  }

  async setEnablement(
    pluginId: string,
    guildId: string | null,
    enabled: boolean,
    enabledBy: string,
  ): Promise<void> {
    await this.prisma.pluginEnablement.upsert({
      where: { pluginId_guildId: { pluginId, guildId: guildId as string } },
      update: { enabled, enabledBy, deletedAt: null },
      create: { pluginId, guildId, enabled, enabledBy },
    });
  }

  async getEnablement(
    pluginId: string,
    guildId: string | null,
  ): Promise<PluginEnablementRecord | null> {
    const row = await this.prisma.pluginEnablement.findFirst({
      where: { pluginId, guildId, deletedAt: null },
    });
    return row ?? null;
  }

  async getConfig(
    pluginId: string,
    guildId: string | null,
  ): Promise<Record<string, unknown> | null> {
    const row = await this.prisma.pluginConfig.findFirst({
      where: { pluginId, guildId },
    });
    return row ? (row.values as Record<string, unknown>) : null;
  }

  async upsertConfig(
    pluginId: string,
    guildId: string | null,
    values: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.pluginConfig.upsert({
      where: { pluginId_guildId: { pluginId, guildId: guildId as string } },
      update: { values: values as Prisma.InputJsonValue },
      create: { pluginId, guildId, values: values as Prisma.InputJsonValue },
    });
  }

  async recordVersionHistory(
    pluginId: string,
    fromVersion: string | null,
    toVersion: string,
    actorId: string,
  ): Promise<void> {
    await this.prisma.pluginVersionHistory.create({
      data: { pluginId, fromVersion, toVersion, actorId },
    });
  }
}
