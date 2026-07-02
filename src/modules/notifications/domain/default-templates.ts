/**
 * Built-in default notification templates, keyed by `templateKey` then locale.
 * These back {@link TemplateService} when no {@link NotificationTemplate} DB row
 * exists yet (fresh install / not-yet-seeded guild). A guild or global DB
 * override always wins over these. Bodies are ICU message strings (support
 * interpolation, plurals, select). Primary PT, secondary EN.
 */
export interface DefaultTemplate {
  readonly subject: string | null;
  readonly body: string;
}

export const DEFAULT_TEMPLATES: Readonly<
  Record<string, Readonly<Record<string, DefaultTemplate>>>
> = {
  'system.test': {
    pt: { subject: null, body: '🔔 Notificação de teste pedida por {by}.' },
    en: { subject: null, body: '🔔 Test notification requested by {by}.' },
  },
  'moderation.banned': {
    pt: {
      subject: 'Membro banido',
      body: '🔨 <@{target}> foi banido por <@{moderator}> (caso {caseId}). Motivo: {reason}.',
    },
    en: {
      subject: 'Member banned',
      body: '🔨 <@{target}> was banned by <@{moderator}> (case {caseId}). Reason: {reason}.',
    },
  },
  'tickets.created': {
    pt: {
      subject: 'Novo ticket',
      body: '🎫 Novo ticket {ticketId} aberto por <@{user}> ({ticketCategory}).',
    },
    en: {
      subject: 'New ticket',
      body: '🎫 New ticket {ticketId} opened by <@{user}> ({ticketCategory}).',
    },
  },
  'integrations.twitch.online': {
    pt: {
      subject: null,
      body: '🔴 {streamer} está em direto: {title} — {url}',
    },
    en: { subject: null, body: '🔴 {streamer} is live: {title} — {url}' },
  },
  'integrations.youtube.upload': {
    pt: { subject: null, body: '📺 Novo vídeo de {channel}: {title} — {url}' },
    en: { subject: null, body: '📺 New video from {channel}: {title} — {url}' },
  },
  'integrations.github.push': {
    pt: {
      subject: null,
      body: '💾 {pusher} enviou {count, plural, one {# commit} other {# commits}} para {repo} ({ref}) — {url}',
    },
    en: {
      subject: null,
      body: '💾 {pusher} pushed {count, plural, one {# commit} other {# commits}} to {repo} ({ref}) — {url}',
    },
  },
};

export function findDefaultTemplate(
  key: string,
  locale: string,
): DefaultTemplate | null {
  return DEFAULT_TEMPLATES[key]?.[locale] ?? null;
}
