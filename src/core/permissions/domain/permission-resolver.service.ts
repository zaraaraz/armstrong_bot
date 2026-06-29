import { Injectable } from '@nestjs/common';
import { Claim } from './claim.value-object';
import type { PermissionContext, ResolvedGroup } from './permission-context';
import type { DecisionReason, PermissionDecision } from './permission-decision';

const DEFAULT_MAX_DEPTH = 8;

interface MatchResult {
  effect: 'GRANT' | 'DENY';
  specificity: number;
  groupKey: string;
  matchedClaim: string;
}

@Injectable()
export class PermissionResolver {
  resolve(
    context: PermissionContext,
    claimString: string,
    maxDepth = DEFAULT_MAX_DEPTH,
  ): PermissionDecision {
    if (context.isBotOwner || context.isGuildOwner) {
      return {
        allowed: true,
        reasons: [{ source: 'global', effect: 'GRANT', matchedClaim: '*' }],
      };
    }

    const required = Claim.parse(claimString);
    const reasons: DecisionReason[] = [];
    const effectiveGroupKeys = this.resolveGroupKeys(context);
    const resolvedGroups = effectiveGroupKeys
      .map((k) => context.groups[k])
      .filter((g): g is ResolvedGroup => g !== undefined)
      .sort((a, b) => b.priority - a.priority);

    let bestGrant: MatchResult | null = null as MatchResult | null;
    let bestDeny: MatchResult | null = null as MatchResult | null;

    const onMatch = (match: MatchResult) => {
      if (match.effect === 'GRANT') {
        if (!bestGrant || match.specificity > bestGrant.specificity)
          bestGrant = match;
      } else {
        if (!bestDeny || match.specificity > bestDeny.specificity)
          bestDeny = match;
      }
    };

    const visited = new Set<string>();
    for (const group of resolvedGroups) {
      this.walkGroup(group, context, required, visited, maxDepth, 0, onMatch);
    }

    if (
      bestDeny &&
      (!bestGrant || bestDeny.specificity >= bestGrant.specificity)
    ) {
      reasons.push({
        source: 'group',
        groupKey: bestDeny.groupKey,
        matchedClaim: bestDeny.matchedClaim,
        effect: 'DENY',
      });
      return { allowed: false, reasons };
    }

    if (bestGrant) {
      reasons.push({
        source: 'group',
        groupKey: bestGrant.groupKey,
        matchedClaim: bestGrant.matchedClaim,
        effect: 'GRANT',
      });
      return { allowed: true, reasons };
    }

    reasons.push({ source: 'fallback', effect: 'UNSET' });
    return { allowed: false, reasons };
  }

  private resolveGroupKeys(context: PermissionContext): string[] {
    const keys = new Set<string>(context.defaultGroupKeys);
    for (const roleId of context.memberRoleIds) {
      const groups = context.roleToGroups[roleId] ?? [];
      for (const g of groups) keys.add(g);
    }
    return [...keys];
  }

  private walkGroup(
    group: ResolvedGroup,
    context: PermissionContext,
    required: Claim,
    visited: Set<string>,
    maxDepth: number,
    depth: number,
    onMatch: (match: MatchResult) => void,
  ): void {
    if (depth > maxDepth) {
      throw new Error(
        `Max inheritance depth (${maxDepth}) exceeded — possible cycle in group "${group.key}"`,
      );
    }
    if (visited.has(group.key)) return;
    visited.add(group.key);

    for (const grant of group.grants) {
      const held = Claim.parse(grant.claim);
      if (held.covers(required)) {
        onMatch({
          effect: grant.effect,
          specificity: held.specificity(),
          groupKey: group.key,
          matchedClaim: grant.claim,
        });
      }
    }

    for (const parentKey of group.parents) {
      const parent = context.groups[parentKey];
      if (parent) {
        this.walkGroup(
          parent,
          context,
          required,
          visited,
          maxDepth,
          depth + 1,
          onMatch,
        );
      }
    }
  }
}
