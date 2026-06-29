import type { PermissionEffect } from './claim.value-object';

export interface DecisionReason {
  readonly source:
    'group' | 'role-mapping' | 'tier-default' | 'global' | 'fallback';
  readonly groupKey?: string;
  readonly matchedClaim?: string;
  readonly effect: PermissionEffect;
}

export type PermissionDecision =
  | { readonly allowed: true; readonly reasons: readonly DecisionReason[] }
  | { readonly allowed: false; readonly reasons: readonly DecisionReason[] };
