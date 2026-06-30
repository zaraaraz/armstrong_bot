/**
 * Typed WebSocket contract for the `/ws` namespace. Server→client events mirror
 * the Event Bus fan-out; client→server events are limited to subscription
 * management. Channels a client may join are gated by claims at subscribe time.
 */

export type RealtimeChannel = 'jobs' | 'logs' | 'presence';

/** Claim required to subscribe to each channel. */
export const CHANNEL_CLAIM: Record<RealtimeChannel, string> = {
  jobs: 'job.read',
  logs: 'logs.view',
  presence: 'presence.read',
};

/** client → server */
export interface SubscribeMessage {
  readonly guildId: string;
  readonly channels: ReadonlyArray<RealtimeChannel>;
}

export interface ClientToServerEvents {
  subscribe: (msg: SubscribeMessage) => void;
  unsubscribe: (msg: SubscribeMessage) => void;
}

/** server → client */
export interface JobProgressMessage {
  readonly guildId: string;
  readonly jobId: string;
  readonly name: string;
  readonly progress: number;
  readonly state: string;
}

export interface LogMessage {
  readonly guildId: string;
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly ts: string;
}

export interface PresenceMessage {
  readonly guildId: string;
  readonly online: number;
  readonly members: number;
}

export interface ServerToClientEvents {
  'job.progress': (msg: JobProgressMessage) => void;
  log: (msg: LogMessage) => void;
  presence: (msg: PresenceMessage) => void;
  error: (msg: { code: string; message: string }) => void;
}

/** Room naming: one room per guild+channel. */
export function roomFor(guildId: string, channel: RealtimeChannel): string {
  return `guild:${guildId}:${channel}`;
}
