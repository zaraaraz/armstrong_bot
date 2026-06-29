import { Global, Module } from '@nestjs/common';
import { PermissionService } from './application/permission.service';
import { PermissionCacheFacade } from './application/permission-cache.facade';
import { PermissionResolver } from './domain/permission-resolver.service';
import { GroupRepository } from './infrastructure/group.repository';
import { ClaimGrantRepository } from './infrastructure/claim-grant.repository';
import { RoleMappingRepository } from './infrastructure/role-mapping.repository';
import { GroupInheritanceRepository } from './infrastructure/group-inheritance.repository';
import { RestPermissionGuard } from './guards/rest-permission.guard';

@Global()
@Module({
  providers: [
    PermissionService,
    PermissionCacheFacade,
    PermissionResolver,
    GroupRepository,
    ClaimGrantRepository,
    RoleMappingRepository,
    GroupInheritanceRepository,
    RestPermissionGuard,
  ],
  exports: [PermissionService, RestPermissionGuard],
})
export class PermissionsModule {}
