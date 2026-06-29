import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TranslationService } from '../contracts/translation-service.contract';
import { PrismaService } from '../../../database/prisma.service';
import { IcuFormatter } from '../formatter/icu-formatter';
import type { TranslationRepository } from '../repository/translation.repository';
import { TRANSLATION_REPOSITORY } from '../tokens';
import { UpsertTranslationSchema } from '../dto/upsert-translation.dto';
import type { UpsertTranslationDto } from '../dto/upsert-translation.dto';
import { TranslationQuerySchema } from '../dto/translation-query.dto';
import type {
  LocaleResponseDto,
  PaginatedTranslationsDto,
  TranslationResponseDto,
} from '../dto/translation.response.dto';
import { EventBus } from '../../events/event-bus';
import { I18N_EVENTS } from '../events/i18n.events';
import type { TranslationRecord } from '../repository/translation.repository';

@ApiTags('i18n')
@Controller('api/i18n')
export class TranslationsController {
  constructor(
    private readonly translationService: TranslationService,
    @Inject(TRANSLATION_REPOSITORY)
    private readonly repo: TranslationRepository,
    private readonly prisma: PrismaService,
    private readonly formatter: IcuFormatter,
    @Inject(EventBus) private readonly eventBus: EventBus,
  ) {}

  @Get('locales')
  @ApiOperation({ summary: 'List supported/enabled locales' })
  async listLocales(): Promise<LocaleResponseDto[]> {
    const rows = await this.prisma['locale'].findMany({
      where: { enabled: true, deletedAt: null },
    });
    return (
      rows as Array<{
        code: string;
        displayName: string;
        enabled: boolean;
        isDefault: boolean;
      }>
    ).map((r) => ({
      code: r.code,
      displayName: r.displayName,
      enabled: r.enabled,
      isDefault: r.isDefault,
    }));
  }

  @Get('translations')
  @ApiOperation({ summary: 'Paginated list of translation overrides' })
  async list(
    @Query() rawQuery: Record<string, string>,
  ): Promise<PaginatedTranslationsDto> {
    const query = TranslationQuerySchema.parse(rawQuery);
    const skip = (query.page - 1) * query.pageSize;
    const { items, total } = await this.repo.search({
      guildId: query.guildId ?? null,
      locale: query.locale,
      namespace: query.namespace,
      contains: query.contains,
      skip,
      take: query.pageSize,
    });
    return {
      items: items.map(toResponseDto),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  @Get('translations/:id')
  @ApiOperation({ summary: 'Fetch a single translation override' })
  async findOne(@Param('id') id: string): Promise<TranslationResponseDto> {
    const row = (await this.prisma['translation'].findFirst({
      where: { id, deletedAt: null },
    })) as Record<string, unknown> | null;
    if (!row) throw new NotFoundException(`Translation ${id} not found`);
    return toResponseDto({
      id: row['id'] as string,
      guildId: row['guildId'] as string | null,
      locale: row['locale'] as string,
      module: row['module'] as string,
      namespace: row['namespace'] as string,
      key: row['key'] as string,
      value: row['value'] as string,
      updatedBy: row['updatedBy'] as string | null,
      updatedAt: row['updatedAt'] as Date,
    });
  }

  @Put('translations')
  @ApiOperation({ summary: 'Upsert a translation override' })
  async upsert(@Body() rawBody: unknown): Promise<TranslationResponseDto> {
    const dto: UpsertTranslationDto = UpsertTranslationSchema.parse(rawBody);

    if (!this.formatter.isValid(dto.value, dto.locale)) {
      throw new Error(`Invalid ICU message format for locale "${dto.locale}"`);
    }

    const record = await this.repo.upsert({
      guildId: dto.guildId,
      locale: dto.locale,
      module: dto.module,
      namespace: dto.namespace,
      key: dto.key,
      value: dto.value,
      updatedBy: null,
    });

    await this.eventBus.publish(
      I18N_EVENTS.TranslationUpdated,
      {
        guildId: dto.guildId,
        locale: dto.locale,
        module: dto.module,
        namespace: dto.namespace,
        key: dto.key,
        updatedBy: 'api',
      },
      { guildId: dto.guildId, actor: { type: 'api', id: 'api' } },
    );

    return toResponseDto(record);
  }

  @Delete('translations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a translation override' })
  async remove(@Param('id') id: string): Promise<void> {
    const row = (await this.prisma['translation'].findFirst({
      where: { id, deletedAt: null },
    })) as Record<string, unknown> | null;
    if (!row) throw new NotFoundException(`Translation ${id} not found`);
    await this.repo.softDelete(id, 'api');

    await this.eventBus.publish(
      I18N_EVENTS.TranslationDeleted,
      {
        id,
        guildId: row['guildId'] as string | null,
        locale: row['locale'] as string,
        namespace: row['namespace'] as string,
        deletedBy: 'api',
      },
      {
        guildId: row['guildId'] as string | null,
        actor: { type: 'api', id: 'api' },
      },
    );
  }
}

function toResponseDto(record: TranslationRecord): TranslationResponseDto {
  return {
    id: record.id,
    guildId: record.guildId,
    locale: record.locale,
    module: record.module,
    namespace: record.namespace,
    key: record.key,
    value: record.value,
    updatedBy: record.updatedBy,
    updatedAt: record.updatedAt.toISOString(),
  };
}
