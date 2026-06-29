import type { EventName } from './event-map';

export type DeliveryPolicy = 'sync' | 'async' | 'both';

export interface EventPolicy {
  readonly delivery: DeliveryPolicy;
  readonly idempotent: boolean;
  readonly fireAndForget: boolean;
}

const DEFAULT_POLICY: EventPolicy = {
  delivery: 'async',
  idempotent: false,
  fireAndForget: false,
};

const POLICY_TABLE: Partial<Record<EventName, EventPolicy>> = {
  'discord.member.joined': {
    delivery: 'both',
    idempotent: true,
    fireAndForget: false,
  },
  'discord.message.deleted': {
    delivery: 'async',
    idempotent: true,
    fireAndForget: false,
  },
  'moderation.ban.executed': {
    delivery: 'both',
    idempotent: true,
    fireAndForget: false,
  },
  'moderation.warn.issued': {
    delivery: 'both',
    idempotent: true,
    fireAndForget: false,
  },
  'tickets.ticket.opened': {
    delivery: 'async',
    idempotent: true,
    fireAndForget: false,
  },
  'tickets.ticket.closed': {
    delivery: 'async',
    idempotent: true,
    fireAndForget: false,
  },
  'events.handler.failed': {
    delivery: 'sync',
    idempotent: false,
    fireAndForget: true,
  },
  'events.deadletter.created': {
    delivery: 'sync',
    idempotent: false,
    fireAndForget: true,
  },
  'events.replay.completed': {
    delivery: 'sync',
    idempotent: false,
    fireAndForget: true,
  },
  'security.rate_limit.exceeded': {
    delivery: 'async',
    idempotent: false,
    fireAndForget: true,
  },
  'security.auth.failed': {
    delivery: 'async',
    idempotent: false,
    fireAndForget: true,
  },
  'security.permission.denied': {
    delivery: 'async',
    idempotent: false,
    fireAndForget: true,
  },
  'security.secret.accessed': {
    delivery: 'async',
    idempotent: false,
    fireAndForget: true,
  },
  'security.encryption.key_rotated': {
    delivery: 'both',
    idempotent: false,
    fireAndForget: true,
  },
};

export function getEventPolicy(name: EventName): EventPolicy {
  return POLICY_TABLE[name] ?? DEFAULT_POLICY;
}
