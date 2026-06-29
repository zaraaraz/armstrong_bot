import { SetMetadata } from '@nestjs/common';
import { Claim } from '../domain/claim.value-object';

export const PERMISSION_CLAIM_KEY = 'ghost:permission:claim';

export const RequirePermission = (claim: string): MethodDecorator =>
  SetMetadata(PERMISSION_CLAIM_KEY, Claim.parse(claim).value);
