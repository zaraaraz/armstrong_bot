export interface EventLogResponseDto {
  readonly id: string;
  readonly envelopeId: string;
  readonly eventName: string;
  readonly guildId: string | null;
  readonly actorType: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly version: number;
  readonly delivery: string;
  readonly status: string;
  readonly occurredAt: string;
}
