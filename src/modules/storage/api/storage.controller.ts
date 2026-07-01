import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { RestPermissionGuard } from '../../../core/permissions/guards/rest-permission.guard';
import { RequirePermission } from '../../../core/permissions/decorators/require-permission.decorator';
import { StorageService } from '../application/storage.service.contract';
import type {
  Paginated,
  StorageUsageSummary,
} from '../application/storage.service.contract';
import type { StoredObjectRef } from '../domain/storage-object.entity';
import {
  ListObjectsQueryDto,
  PaginatedStorageObjectsDto,
  SignedUrlResponseDto,
  StorageUsageResponseDto,
  listObjectsQuerySchema,
} from './dto/storage.dto';

interface ScopedRequest extends Request {
  user?: { id: string; guildId?: string | null };
}

/** Query params carried by a local-driver signed-proxy download link. */
interface DownloadQuery {
  key?: string;
  exp?: string;
  sig?: string;
  filename?: string;
  contentType?: string;
}

/**
 * REST surface for the storage catalog. Every management endpoint is gated by a
 * `storage.*` claim via {@link RestPermissionGuard} and scoped to the caller's
 * guild — a guild admin only ever sees/acts on its own guild's objects; global
 * objects (`guildId === null`) require platform-level authority.
 *
 * The controller is deliberately thin: it resolves the caller scope, parses the
 * query, and delegates everything (hashing, quota, catalog consistency, HMAC
 * verification, byte streaming) to {@link StorageService}. It never touches
 * Prisma or a driver SDK directly.
 */
@ApiTags('Storage')
@Controller('api/v1/storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  /** The guild a caller is scoped to (null => platform/global). */
  private scope(req: ScopedRequest): string | null {
    return req.user?.guildId ?? null;
  }

  @Get('guilds/:guildId/usage')
  @UseGuards(RestPermissionGuard)
  @RequirePermission('storage.read')
  @ApiOperation({ summary: 'Aggregated storage usage for a guild' })
  @ApiParam({ name: 'guildId' })
  @ApiOkResponse({ type: StorageUsageResponseDto })
  async usage(@Param('guildId') guildId: string): Promise<StorageUsageSummary> {
    return this.storage.usage(guildId);
  }

  @Get('guilds/:guildId/objects')
  @UseGuards(RestPermissionGuard)
  @RequirePermission('storage.read')
  @ApiOperation({ summary: 'Paginated catalog listing for a guild' })
  @ApiParam({ name: 'guildId' })
  @ApiQuery({ type: ListObjectsQueryDto })
  @ApiOkResponse({ type: PaginatedStorageObjectsDto })
  async listObjects(
    @Param('guildId') guildId: string,
    @Query() raw: Record<string, string>,
  ): Promise<Paginated<StoredObjectRef>> {
    const query = listObjectsQuerySchema.parse({ ...raw, guildId });
    return this.storage.list({ ...query, guildId });
  }

  @Post('objects/:id/signed-url')
  @UseGuards(RestPermissionGuard)
  @RequirePermission('storage.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Issue a time-limited signed GET URL for an object',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: SignedUrlResponseDto })
  async signedUrl(@Param('id') id: string): Promise<SignedUrlResponseDto> {
    const signed = await this.storage.signDownloadUrl(id);
    return {
      url: signed.url,
      method: signed.method,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  @Delete('objects/:id')
  @UseGuards(RestPermissionGuard)
  @RequirePermission('storage.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete an object and schedule byte GC' })
  @ApiParam({ name: 'id' })
  remove(@Param('id') id: string): Promise<void> {
    return this.storage.delete(id);
  }

  /**
   * PUBLIC signed-proxy download for the local driver. It carries no JWT and no
   * `storage.*` claim: authority comes entirely from the HMAC `sig`/`exp` query
   * params minted by the local driver. The service verifies the signature and
   * expiry before streaming; an invalid or expired link yields 401/410. Hidden
   * from Swagger — it is an implementation detail of the local backend.
   */
  @Get('download')
  @ApiExcludeEndpoint()
  async download(
    @Query() query: DownloadQuery,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    await this.storage.serveSignedDownload(
      {
        key: query.key,
        exp: query.exp,
        sig: query.sig,
        filename: query.filename,
        contentType: query.contentType,
      },
      res,
    );
  }
}
