import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { canonicalJson } from './canonical-json';
import type {
  AuditEntry,
  AuditEntryDraft,
  ChainVerificationResult,
} from './audit-entry.model';
import type { AuditScope } from './audit-scope.enum';

export type HashAlgorithm = 'sha256' | 'sha512';

/**
 * Chain anchor left behind by the retention job: the hash of the last
 * archived entry, used to validate linkage across a pruned boundary.
 */
export interface ChainAnchor {
  readonly toSeq: bigint;
  readonly rootHash: string;
}

/**
 * Pure tamper-evidence logic: computes each entry's hash from its canonical
 * content + the predecessor's hash, and re-verifies a stored chain. Never
 * touches persistence — ordering/locking is the ingest processor's concern.
 */
@Injectable()
export class AuditChainService {
  computeHash(
    draft: AuditEntryDraft,
    seq: bigint,
    previousHash: string | null,
    algorithm: HashAlgorithm,
  ): string {
    const content = canonicalJson({
      scope: draft.scope,
      guildId: draft.guildId,
      seq: seq.toString(),
      action: draft.action,
      source: draft.source,
      actorId: draft.actorId,
      actorType: draft.actorType,
      targetType: draft.targetType,
      targetId: draft.targetId,
      channelId: draft.channelId,
      correlationId: draft.correlationId,
      causationId: draft.causationId,
      summary: draft.summary,
      metadata: draft.metadata,
      before: draft.before,
      after: draft.after,
      occurredAt: draft.occurredAt.toISOString(),
      previousHash,
    });
    return createHash(algorithm).update(content, 'utf8').digest('hex');
  }

  /**
   * Walks the chain in seq order re-computing every hash and checking the
   * previousHash linkage. When the chain does not start at seq 1 (older
   * segments pruned by retention), the first entry must link to the archive
   * anchor covering seq-1.
   */
  async verify(
    scope: AuditScope,
    guildId: string | null,
    entries: AsyncIterable<AuditEntry>,
    algorithm: HashAlgorithm,
    anchor: ChainAnchor | null,
  ): Promise<ChainVerificationResult> {
    let checked = 0;
    let previous: AuditEntry | null = null;
    let firstBrokenSeq: bigint | null = null;

    for await (const entry of entries) {
      checked += 1;
      const expectedPrevious = previous
        ? previous.hash
        : entry.seq === 1n
          ? null
          : anchor && anchor.toSeq === entry.seq - 1n
            ? anchor.rootHash
            : undefined;

      const linkageOk =
        expectedPrevious !== undefined &&
        entry.previousHash === expectedPrevious;
      const seqOk = previous === null || entry.seq === previous.seq + 1n;
      const recomputed = this.computeHash(
        entry,
        entry.seq,
        entry.previousHash,
        algorithm,
      );
      const contentOk = recomputed === entry.hash;

      if (!(linkageOk && seqOk && contentOk)) {
        firstBrokenSeq = entry.seq;
        break;
      }
      previous = entry;
    }

    return {
      scope,
      guildId,
      checked,
      valid: firstBrokenSeq === null,
      firstBrokenSeq,
      verifiedAt: new Date(),
    };
  }
}
