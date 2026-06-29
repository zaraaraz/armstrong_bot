import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_CLAIM_KEY } from '../decorators/require-permission.decorator';
import {
  PermissionService,
  PermissionDeniedError,
} from '../application/permission.service';
import type { PermissionActor } from '../application/permission.service';
import type { Request } from 'express';

@Injectable()
export class RestPermissionGuard implements CanActivate {
  private readonly logger = new Logger(RestPermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const claim = this.reflector.getAllAndOverride<string | undefined>(
      PERMISSION_CLAIM_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!claim) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const actor = this.extractActor(req);
    if (!actor) throw new UnauthorizedException('Authentication required');

    try {
      await this.permissionService.assert(actor, claim);
      return true;
    } catch (err) {
      if (err instanceof PermissionDeniedError) return false;
      throw err;
    }
  }

  private extractActor(req: Request): PermissionActor | null {
    const user = (
      req as unknown as {
        user?: {
          id: string;
          guildId: string;
          roleIds: string[];
          isGuildOwner: boolean;
        };
      }
    ).user;
    if (!user) return null;
    return {
      userId: user.id,
      guildId: user.guildId,
      discordRoleIds: user.roleIds ?? [],
      isGuildOwner: user.isGuildOwner ?? false,
    };
  }
}
