import type { DiscordEventPayloads } from './payloads/discord.payloads';
import type { ModerationEventPayloads } from './payloads/moderation.payloads';
import type { TicketEventPayloads } from './payloads/tickets.payloads';
import type { EventsEventPayloads } from './payloads/events.payloads';
import type { I18nEventPayloads } from './payloads/i18n.payloads';
import type { PermissionsEventPayloads } from './payloads/permissions.payloads';
import type { SecurityEventPayloads } from './payloads/security.payloads';
import type { PluginEventPayloads } from './payloads/plugin.payloads';

export interface GhostEventMap
  extends
    DiscordEventPayloads,
    ModerationEventPayloads,
    TicketEventPayloads,
    EventsEventPayloads,
    I18nEventPayloads,
    PermissionsEventPayloads,
    SecurityEventPayloads,
    PluginEventPayloads {}

export type EventName = keyof GhostEventMap;
