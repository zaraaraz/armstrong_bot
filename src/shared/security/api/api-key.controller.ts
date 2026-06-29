import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../core/permissions/decorators/require-permission.decorator';
import { RestPermissionGuard } from '../../../core/permissions/guards/rest-permission.guard';
import { ApiKeyService } from '../services/api-key.service';
import {
  CreateApiKeySchema,
  type ApiKeyResponseDto,
  type CreatedApiKeyResponseDto,
} from '../dto/create-api-key.dto';
import type { ApiKeyRecord } from '../repositories/api-key.repository';

@ApiTags('Security')
@Controller('api/v1/guilds/:guildId/api-keys')
@UseGuards(RestPermissionGuard)
export class ApiKeyController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  @Get()
  @RequirePermission('security.apikeys.read')
  @ApiOperation({ summary: 'List API keys (prefixes only) for a guild' })
  async list(@Param('guildId') guildId: string): Promise<ApiKeyResponseDto[]> {
    const keys = await this.apiKeys.list(guildId);
    return keys.map(toListDto);
  }

  @Post()
  @RequirePermission('security.apikeys.create')
  @ApiOperation({ summary: 'Create an API key (raw key shown once)' })
  async create(
    @Param('guildId') guildId: string,
    @Body() rawBody: unknown,
  ): Promise<CreatedApiKeyResponseDto> {
    const dto = CreateApiKeySchema.parse(rawBody);
    const { record, rawKey } = await this.apiKeys.create({
      guildId,
      name: dto.name,
      scopes: dto.scopes,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    return {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      scopes: record.scopes,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      rawKey,
    };
  }

  @Delete(':keyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('security.apikeys.revoke')
  @ApiOperation({ summary: 'Revoke an API key' })
  async revoke(
    @Param('guildId') guildId: string,
    @Param('keyId') keyId: string,
  ): Promise<void> {
    const existing = await this.findKeyInGuild(guildId, keyId);
    if (!existing) throw new NotFoundException(`API key ${keyId} not found`);
    await this.apiKeys.revoke(keyId);
  }

  private async findKeyInGuild(
    guildId: string,
    keyId: string,
  ): Promise<ApiKeyRecord | null> {
    const keys = await this.apiKeys.list(guildId);
    return keys.find((k) => k.id === keyId) ?? null;
  }
}

function toListDto(record: ApiKeyRecord): ApiKeyResponseDto {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    scopes: record.scopes,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}
