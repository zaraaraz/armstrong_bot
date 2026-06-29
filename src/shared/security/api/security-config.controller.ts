import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../core/permissions/decorators/require-permission.decorator';
import { RestPermissionGuard } from '../../../core/permissions/guards/rest-permission.guard';
import { SecurityConfigService } from '../services/security-config.service';
import { UpdateSecurityConfigSchema } from '../dto/update-security-config.dto';
import type { SecurityConfig } from '../schemas/security-config.schema';

@ApiTags('Security')
@Controller('api/v1/guilds/:guildId/security/config')
@UseGuards(RestPermissionGuard)
export class SecurityConfigController {
  constructor(private readonly configService: SecurityConfigService) {}

  @Get()
  @RequirePermission('security.config.read')
  @ApiOperation({ summary: 'Read resolved security settings for a guild' })
  get(@Param('guildId') guildId: string): Promise<SecurityConfig> {
    return this.configService.get(guildId);
  }

  @Patch()
  @RequirePermission('security.config.write')
  @ApiOperation({ summary: 'Update security settings for a guild' })
  update(
    @Param('guildId') guildId: string,
    @Body() rawBody: unknown,
  ): Promise<SecurityConfig> {
    const patch = UpdateSecurityConfigSchema.parse(rawBody);
    return this.configService.update(guildId, patch);
  }
}
