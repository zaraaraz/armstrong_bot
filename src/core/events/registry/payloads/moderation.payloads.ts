export interface ModerationBanExecutedPayload {
  readonly caseId: string;
  readonly targetUserId: string;
  readonly moderatorUserId: string;
  readonly reason: string | null;
  readonly deleteMessageSeconds: number;
  readonly expiresAt: string | null;
}

export interface ModerationWarnIssuedPayload {
  readonly caseId: string;
  readonly targetUserId: string;
  readonly moderatorUserId: string;
  readonly reason: string;
  readonly points: number;
}

export interface ModerationEventPayloads {
  'moderation.ban.executed': ModerationBanExecutedPayload;
  'moderation.warn.issued': ModerationWarnIssuedPayload;
}
