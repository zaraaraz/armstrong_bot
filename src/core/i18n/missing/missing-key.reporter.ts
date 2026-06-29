import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventBus } from '../../../core/events/event-bus';
import { I18N_EVENTS } from '../events/i18n.events';
import type { MissingKeyPayload } from '../events/i18n.events';
import type { Locale } from '../contracts/translation-context';

const DEDUP_WINDOW_MS = 60_000;

@Injectable()
export class MissingKeyReporter {
  private readonly logger = new Logger(MissingKeyReporter.name);
  private readonly seen = new Map<string, number>();

  constructor(@Inject(EventBus) private readonly eventBus: EventBus) {}

  report(
    key: string,
    locale: Locale,
    chainTried: readonly Locale[],
    guildId: string | null,
  ): void {
    const dedupeKey = `${guildId ?? 'global'}:${locale}:${key}`;
    const now = Date.now();
    const last = this.seen.get(dedupeKey);

    if (last && now - last < DEDUP_WINDOW_MS) return;

    this.seen.set(dedupeKey, now);

    const payload: MissingKeyPayload = {
      key,
      locale,
      chainTried,
      guildId,
      occurredAt: new Date(now).toISOString(),
    };

    this.logger.warn({ msg: 'i18n.missing', key, locale, chainTried, guildId });

    void this.eventBus.publish(I18N_EVENTS.MissingKeyDetected, payload, {
      guildId,
      actor: { type: 'system', id: 'i18n' },
    });
  }
}
