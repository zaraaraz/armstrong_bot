import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiPermissionsGuard } from './permissions.guard';
import { ApiException } from '../../common/errors/api-exception';
import type { PermissionService } from '../../../core/permissions/application/permission.service';
import type { EventBus } from '../../../core/events/event-bus';
import type { ApiRequestContext } from '../../common/context/api-actor';

const eventBus = { publish: () => Promise.resolve() } as unknown as EventBus;

function makeCtx(
  apiContext: ApiRequestContext,
  claims: string[],
): {
  ctx: ExecutionContext;
  reflector: Reflector;
} {
  const req = { apiContext };
  const reflector = {
    getAllAndOverride: () => claims,
  } as unknown as Reflector;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

describe('ApiPermissionsGuard', () => {
  it('passes a service actor whose key scope covers the claim (wildcard)', async () => {
    const { ctx, reflector } = makeCtx(
      {
        requestId: 'r',
        actor: {
          id: 'k1',
          type: 'service',
          method: 'api-key',
          displayName: 'svc',
          claims: new Set(['tickets.*']),
          guildScope: new Set(['g1']),
        },
      },
      ['tickets.read'],
    );
    const perms = {} as PermissionService;
    const guard = new ApiPermissionsGuard(reflector, perms, eventBus);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('forbids a service actor missing the claim', async () => {
    const { ctx, reflector } = makeCtx(
      {
        requestId: 'r',
        actor: {
          id: 'k1',
          type: 'service',
          method: 'api-key',
          displayName: 'svc',
          claims: new Set(['logs.view']),
          guildScope: new Set(['g1']),
        },
      },
      ['tickets.read'],
    );
    const guard = new ApiPermissionsGuard(
      reflector,
      {} as PermissionService,
      eventBus,
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ApiException);
  });

  it('delegates a session user to the Permissions core', async () => {
    const { ctx, reflector } = makeCtx(
      {
        requestId: 'r',
        actor: {
          id: 'u1',
          type: 'user',
          method: 'session',
          displayName: 'user',
          claims: new Set<string>(),
          guildScope: new Set(['g1']),
        },
        user: {
          id: 'u1',
          guildId: 'g1',
          discordRoleIds: ['role1'],
          isGuildOwner: false,
        },
      },
      ['tickets.read'],
    );
    const can = vi.fn().mockResolvedValue(true);
    const perms = { can } as unknown as PermissionService;
    const guard = new ApiPermissionsGuard(reflector, perms, eventBus);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(can).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', guildId: 'g1' }),
      'tickets.read',
    );
  });

  it('passes through when no claims are required', async () => {
    const { ctx } = makeCtx({ requestId: 'r' }, []);
    const reflector = {
      getAllAndOverride: () => undefined,
    } as unknown as Reflector;
    const guard = new ApiPermissionsGuard(
      reflector,
      {} as PermissionService,
      eventBus,
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
