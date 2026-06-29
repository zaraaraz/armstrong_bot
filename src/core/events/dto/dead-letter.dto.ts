export interface DeadLetterResponseDto {
  readonly id: string;
  readonly envelopeId: string;
  readonly eventName: string;
  readonly guildId: string | null;
  readonly handlerId: string;
  readonly attempts: number;
  readonly errorCode: string;
  readonly status: 'pending' | 'replayed' | 'discarded';
  readonly createdAt: string;
}
