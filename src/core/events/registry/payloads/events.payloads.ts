export interface EventsEventPayloads {
  'events.handler.failed': {
    readonly envelopeId: string;
    readonly eventName: string;
    readonly handlerId: string;
    readonly attempt: number;
    readonly errorCode: string;
    readonly willRetry: boolean;
  };
  'events.deadletter.created': {
    readonly deadLetterId: string;
    readonly envelopeId: string;
    readonly eventName: string;
    readonly handlerId: string;
    readonly attempts: number;
  };
  'events.replay.completed': {
    readonly replayId: string;
    readonly count: number;
    readonly requestedBy: string;
  };
}
