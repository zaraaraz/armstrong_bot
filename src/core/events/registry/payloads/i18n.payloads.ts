export interface I18nEventPayloads {
  'i18n.translation.updated': {
    readonly guildId: string | null;
    readonly locale: string;
    readonly module: string;
    readonly namespace: string;
    readonly key: string;
    readonly updatedBy: string;
  };
  'i18n.translation.deleted': {
    readonly id: string;
    readonly guildId: string | null;
    readonly locale: string;
    readonly namespace: string;
    readonly deletedBy: string;
  };
  'i18n.missingKey.detected': {
    readonly key: string;
    readonly locale: string;
    readonly chainTried: readonly string[];
    readonly guildId: string | null;
    readonly occurredAt: string;
  };
  'i18n.locale.added': {
    readonly locale: string;
    readonly addedBy: string;
  };
  'guild.deleted': {
    readonly guildId: string;
  };
  'guild.created': {
    readonly guildId: string;
  };
}
