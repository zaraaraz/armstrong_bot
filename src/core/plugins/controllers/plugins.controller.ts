import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../permissions/decorators/require-permission.decorator';
import { RestPermissionGuard } from '../../permissions/guards/rest-permission.guard';
import { PluginApplicationService } from '../application/plugin.application-service';
import { PluginError } from '../errors/plugin.errors';
import {
  InstallPluginSchema,
  UpdatePluginStateSchema,
  UpdatePluginConfigSchema,
  ListPluginsQuerySchema,
} from '../application/dto/install-plugin.dto';

@ApiTags('Plugins')
@Controller('api/v1/plugins')
@UseGuards(RestPermissionGuard)
export class PluginsController {
  constructor(private readonly svc: PluginApplicationService) {}

  @Get()
  @RequirePermission('plugins.view')
  @ApiOperation({ summary: 'List plugins (paginated, filterable)' })
  async list(@Query() rawQuery: unknown) {
    const query = ListPluginsQuerySchema.parse(rawQuery);
    return this.svc.listPlugins({
      status: query.status,
      guildId: query.guildId,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get(':name')
  @RequirePermission('plugins.view')
  @ApiOperation({ summary: 'Get a plugin by name' })
  async getOne(@Param('name') name: string) {
    try {
      return await this.svc.getPlugin(name);
    } catch (err) {
      if (err instanceof PluginError) throw new NotFoundException(err.message);
      throw err;
    }
  }

  @Post()
  @RequirePermission('plugins.install')
  @ApiOperation({
    summary: 'Install a plugin from a source path or registry name',
  })
  async install(
    @Body() rawBody: unknown,
    @Query('actorId') actorId = 'system',
  ) {
    const dto = InstallPluginSchema.parse(rawBody);
    return this.svc.installPlugin(dto, actorId);
  }

  @Patch(':name/state')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Enable or disable a plugin for a guild or globally',
  })
  async updateState(@Param('name') name: string, @Body() rawBody: unknown) {
    const dto = UpdatePluginStateSchema.parse(rawBody);
    if (dto.enabled) {
      await this.svc.enablePlugin(name, dto);
    } else {
      await this.svc.disablePlugin(name, dto);
    }
  }

  @Patch(':name/config')
  @RequirePermission('plugins.config')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Update a plugin's guild-scoped config" })
  async updateConfig(@Param('name') name: string, @Body() rawBody: unknown) {
    const dto = UpdatePluginConfigSchema.parse(rawBody);
    await this.svc.updateConfig(name, dto);
  }

  @Post(':name/update')
  @RequirePermission('plugins.update')
  @ApiOperation({
    summary: 'Update a plugin to a new version from a source path',
  })
  async update(
    @Param('name') name: string,
    @Body() rawBody: unknown,
    @Query('actorId') actorId = 'system',
  ) {
    const { source } = InstallPluginSchema.pick({ source: true }).parse(
      rawBody,
    );
    await this.svc.updatePlugin(name, source, actorId);
  }

  @Delete(':name')
  @RequirePermission('plugins.remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete (remove) a plugin' })
  async remove(
    @Param('name') name: string,
    @Query('actorId') actorId = 'system',
  ) {
    await this.svc.removePlugin(name, actorId);
  }
}
