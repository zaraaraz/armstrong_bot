import { Injectable, Logger } from '@nestjs/common';
import IntlMessageFormat from 'intl-messageformat';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import { NOTIF_CACHE } from '../notifications.constants';
import { NotificationsConfigService } from '../config/notifications-config.service';
import {
  NotificationTemplateRepository,
  type TemplateRow,
} from '../infrastructure/notification-template.repository';
import { findDefaultTemplate } from './default-templates';
import type {
  NotificationCategory,
  NotificationPriority,
  RenderedMessage,
  TemplateVars,
} from '../notifications.public';

export interface RenderTemplateInput {
  readonly guildId: string | null;
  readonly templateKey: string;
  readonly vars: TemplateVars;
  readonly locale: string;
  readonly category: NotificationCategory;
  readonly priority: NotificationPriority;
}

const SECONDARY_LOCALE = 'en';

/**
 * Renders a notification template in the recipient's resolved locale.
 *
 * Resolution walks the requested locale -> secondary (EN) -> the raw key as a
 * last resort, and prefers a guild-specific override over the global default.
 * Bodies are full ICU messages (interpolation, plurals, select) rendered with
 * `intl-messageformat`. Resolved templates are cached per (guild, key, locale)
 * for a configurable TTL; rendering itself is never cached (vars differ).
 */
@Injectable()
export class TemplateService {
  private readonly logger = new Logger('notifications.template');

  constructor(
    private readonly repo: NotificationTemplateRepository,
    private readonly cache: CacheService,
    private readonly config: NotificationsConfigService,
  ) {}

  async render(input: RenderTemplateInput): Promise<RenderedMessage> {
    const chain = this.localeChain(input.locale);
    let resolved: { row: TemplateRow; locale: string } | null = null;
    for (const locale of chain) {
      const row = await this.resolveTemplate(
        input.guildId,
        input.templateKey,
        locale,
      );
      if (row) {
        resolved = { row, locale };
        break;
      }
    }

    if (!resolved) {
      // Last resort: the key itself, so a missing template never blocks delivery.
      this.logger.warn(
        `no template for key=${input.templateKey} guild=${input.guildId ?? 'global'} locales=${chain.join('>')}`,
      );
      return {
        subject: null,
        body: input.templateKey,
        locale: input.locale,
        category: input.category,
        priority: input.priority,
      };
    }

    const body = this.format(
      resolved.row.body,
      input.vars,
      resolved.locale,
      input.templateKey,
    );
    const subject =
      resolved.row.subject !== null
        ? this.format(
            resolved.row.subject,
            input.vars,
            resolved.locale,
            resolved.row.subject,
          )
        : null;

    return {
      subject,
      body,
      locale: resolved.locale,
      category: input.category,
      priority: input.priority,
    };
  }

  /** Distinct requested -> EN -> (key handled by caller) fallback chain. */
  localeChain(locale: string): readonly string[] {
    const primary = this.config.global().defaultLocale;
    const chain = [locale, primary, SECONDARY_LOCALE];
    return [...new Set(chain.filter((l) => l && l.length > 0))];
  }

  /** ICU render with a graceful fallback if the message is malformed. */
  format(
    message: string,
    vars: TemplateVars,
    locale: string,
    fallback: string,
  ): string {
    try {
      const fmt = new IntlMessageFormat(message, locale);
      const result = fmt.format<string>(this.toIcuValues(vars));
      return Array.isArray(result) ? result.join('') : String(result);
    } catch (err) {
      this.logger.warn(
        `template render failed locale=${locale}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallback;
    }
  }

  private async resolveTemplate(
    guildId: string | null,
    key: string,
    locale: string,
  ): Promise<TemplateRow | null> {
    const ttl = this.config.global().templateCacheTtlSeconds;
    const load = async (): Promise<TemplateRow | null> => {
      const row = await this.repo.findBest(guildId, key, locale);
      if (row) return row;
      // Fall back to a built-in default so a not-yet-seeded key still renders.
      const fallback = findDefaultTemplate(key, locale);
      return fallback
        ? {
            id: `builtin:${key}:${locale}`,
            guildId: null,
            key,
            locale,
            subject: fallback.subject,
            body: fallback.body,
          }
        : null;
    };
    if (ttl === 0) return load();

    const cacheKey = this.templateCacheKey(guildId, key, locale);
    return this.cache.getOrSet<TemplateRow | null>(cacheKey, load, {
      ttlSeconds: ttl,
    });
  }

  /** ICU accepts primitives; Dates are formatted via the ICU date type. */
  private toIcuValues(
    vars: TemplateVars,
  ): Record<string, string | number | boolean | Date> {
    const out: Record<string, string | number | boolean | Date> = {};
    for (const [k, v] of Object.entries(vars)) out[k] = v;
    return out;
  }

  private templateCacheKey(
    guildId: string | null,
    key: string,
    locale: string,
  ): string {
    return guildId
      ? this.cache.keys.forGuild(
          guildId,
          CacheNamespace.Generic,
          NOTIF_CACHE.Template,
          key,
          locale,
        )
      : this.cache.keys.forGlobal(
          CacheNamespace.Generic,
          NOTIF_CACHE.Template,
          key,
          locale,
        );
  }

  /** Invalidate cached copies of a template across the three-locale chain. */
  async invalidate(
    guildId: string | null,
    key: string,
    locale: string,
  ): Promise<void> {
    await this.cache.delete(this.templateCacheKey(guildId, key, locale));
  }
}
