import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import {
  ApiKeyRepository,
  type ApiKeyRecord,
  type CreateApiKeyInput,
} from './api-key.repository';

interface ApiKeyRow {
  id: string;
  guildId: string | null;
  name: string;
  hashedKey: string;
  prefix: string;
  scopes: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class PrismaApiKeyRepository extends ApiKeyRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(input: CreateApiKeyInput): Promise<ApiKeyRecord> {
    const row: ApiKeyRow = await this.prisma['apiKey'].create({
      data: {
        guildId: input.guildId,
        name: input.name,
        hashedKey: input.hashedKey,
        prefix: input.prefix,
        scopes: input.scopes.join(','),
        expiresAt: input.expiresAt,
      },
    });
    return toRecord(row);
  }

  async findByGuild(guildId: string | null): Promise<ApiKeyRecord[]> {
    const rows = (await this.prisma['apiKey'].findMany({
      where: { guildId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    })) as ApiKeyRow[];
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<ApiKeyRecord | null> {
    const row: ApiKeyRow | null = await this.prisma['apiKey'].findUnique({
      where: { id },
    });
    return row ? toRecord(row) : null;
  }

  async findActiveByPrefix(prefix: string): Promise<ApiKeyRecord[]> {
    const rows = (await this.prisma['apiKey'].findMany({
      where: { prefix, revokedAt: null },
    })) as ApiKeyRow[];
    const now = Date.now();
    return rows
      .map(toRecord)
      .filter((r) => !r.expiresAt || r.expiresAt.getTime() > now);
  }

  async revoke(id: string): Promise<void> {
    await this.prisma['apiKey'].update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.prisma['apiKey'].update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }
}

function toRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    name: row.name,
    hashedKey: row.hashedKey,
    prefix: row.prefix,
    scopes: row.scopes ? row.scopes.split(',').filter(Boolean) : [],
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}
