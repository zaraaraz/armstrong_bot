import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../cache/cache.service';
import { CacheKeyBuilder } from '../../cache/keys/cache-key.builder';
import { CacheNamespace } from '../../cache/keys/cache-namespace.enum';
import { EventBus } from '../events/event-bus';
import { PrismaService } from '../../database/prisma.service';
import type {
  InterpolationValues,
  Locale,
  ResolvedLocale,
  TranslationContext,
} from './contracts/translation-context';
import { TranslationService as AbstractTranslationService } from './contracts/translation-service.contract';
import type { TranslationKey } from './contracts/translation-key';
import { parseKey } from './contracts/translation-key';
import { I18nConfigSchema } from './schemas/i18n-config.schema';
import type { I18nConfig } from './schemas/i18n-config.schema';
import { LocaleResolver } from './resolver/locale-resolver';
import { TranslationLoader } from './loader/translation-loader';
import { IcuFormatter } from './formatter/icu-formatter';
import { MissingKeyReporter } from './missing/missing-key.reporter';
import type { TranslationRepository } from './repository/translation.repository';
import { TRANSLATION_REPOSITORY } from './tokens';
import { I18N_EVENTS } from './events/i18n.events';
import type {
  TranslationUpdatedPayload,
  TranslationDeletedPayload,
} from './events/i18n.events';

type Bundle = Record<string, string>;

@Injectable()
export class TranslationServiceImpl
  extends AbstractTranslationService
  implements OnModuleInit
{
  private readonly logger = new Logger(TranslationServiceImpl.name);
  private config!: I18nConfig;
  private readonly memoryBundleCache = new Map<string, Bundle>();

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly cacheKeyBuilder: CacheKeyBuilder,
    @Inject(EventBus) private readonly eventBus: EventBus,
    private readonly localeResolver: LocaleResolver,
    private readonly loader: TranslationLoader,
    private readonly formatter: IcuFormatter,
    private readonly missingKeyReporter: MissingKeyReporter,
    @Inject(TRANSLATION_REPOSITORY)
    private readonly repo: TranslationRepository,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  onModuleInit(): void {
    this.config = I18nConfigSchema.parse({
      defaultLocale: this.configService.get<string>('I18N_DEFAULT_LOCALE'),
      fallbackLocale: this.configService.get<string>('I18N_FALLBACK_LOCALE'),
      cacheTtlSeconds: this.configService.get<number>('I18N_CACHE_TTL'),
      missingKeyPolicy: this.configService.get<string>(
        'I18N_MISSING_KEY_POLICY',
      ),
      reportMissingKeys: this.configService.get<boolean>(
        'I18N_REPORT_MISSING_KEYS',
      ),
    });

    this.eventBus.on<TranslationUpdatedPayload>(
      I18N_EVENTS.TranslationUpdated,
      ({ payload }) => {
        void this.invalidate(payload.namespace, payload.locale);
      },
    );

    this.eventBus.on<TranslationDeletedPayload>(
      I18N_EVENTS.TranslationDeleted,
      ({ payload }) => {
        void this.invalidate(payload.namespace, payload.locale);
      },
    );

    this.eventBus.on<{ guildId: string }>('guild.deleted', ({ payload }) => {
      void this.repo.softDeleteByGuild(payload.guildId);
    });
  }

  async t(
    key: TranslationKey,
    values?: InterpolationValues,
    context?: TranslationContext,
  ): Promise<string> {
    const ctx = context ?? {};
    const resolved = await this.resolveLocale(ctx);
    const parsed = parseKey(key);

    for (const locale of resolved.chain) {
      const bundle = await this.getBundle(
        locale,
        parsed.namespace,
        ctx.guildId ?? null,
      );
      const message = bundle[parsed.path];
      if (message !== undefined) {
        return this.formatter.format(message, values, locale, key);
      }
    }

    this.handleMissing(key, resolved, ctx.guildId ?? null);
    return this.missingFallback(key);
  }

  tSync(
    key: TranslationKey,
    values: InterpolationValues | undefined,
    locale: Locale,
  ): string {
    const parsed = parseKey(key);
    const cacheKey = this.bundleMemKey(locale, parsed.namespace, null);
    const bundle = this.memoryBundleCache.get(cacheKey);
    if (!bundle) {
      throw new Error(
        `Bundle not cached for locale="${locale}" namespace="${parsed.namespace}". Use t() instead.`,
      );
    }
    const message = bundle[parsed.path];
    if (!message) return key;
    return this.formatter.format(message, values, locale, key);
  }

  async resolveLocale(context: TranslationContext): Promise<ResolvedLocale> {
    const guildLocale = context.guildId
      ? await this.cacheService.getOrSet<string | null>(
          this.cacheKeyBuilder.forGuild(
            context.guildId,
            CacheNamespace.Translations,
            'guild-locale',
          ),
          () => this.fetchGuildLocale(context.guildId!),
          { ttlSeconds: 300 },
        )
      : null;

    const userLocale = context.userId
      ? await this.fetchUserLocale(context.userId, context.guildId)
      : null;

    return this.localeResolver.resolve(
      context,
      guildLocale ?? undefined,
      userLocale ?? undefined,
      this.config.defaultLocale,
      this.config.fallbackLocale,
    );
  }

  async listLocales(): Promise<readonly Locale[]> {
    return this.repo.listLocales();
  }

  async has(key: TranslationKey, locale: Locale): Promise<boolean> {
    const parsed = parseKey(key);
    const bundle = await this.getBundle(locale, parsed.namespace, null);
    return parsed.path in bundle;
  }

  async invalidate(namespace: string, locale?: Locale): Promise<void> {
    if (locale) {
      this.memoryBundleCache.delete(this.bundleMemKey(locale, namespace, null));
      await this.cacheService.delete(
        this.cacheKeyBuilder.forGlobal(
          CacheNamespace.Translations,
          locale,
          namespace,
        ),
      );
    } else {
      for (const k of [...this.memoryBundleCache.keys()]) {
        if (k.includes(`:${namespace}:`)) this.memoryBundleCache.delete(k);
      }
      await this.cacheService.deleteByPrefix(
        this.cacheKeyBuilder.forGlobal(CacheNamespace.Translations, namespace),
      );
    }
    this.logger.debug({
      msg: 'i18n.cache',
      event: 'invalidated',
      namespace,
      locale,
    });
  }

  private async getBundle(
    locale: Locale,
    namespace: string,
    guildId: string | null,
  ): Promise<Bundle> {
    const memKey = this.bundleMemKey(locale, namespace, guildId);
    const cached = this.memoryBundleCache.get(memKey);
    if (cached) return cached;

    const redisKey = guildId
      ? this.cacheKeyBuilder.forGuild(
          guildId,
          CacheNamespace.Translations,
          locale,
          namespace,
        )
      : this.cacheKeyBuilder.forGlobal(
          CacheNamespace.Translations,
          locale,
          namespace,
        );

    const bundle = await this.cacheService.getOrSet<Bundle>(
      redisKey,
      () => this.loader.load(locale, namespace, guildId),
      { ttlSeconds: this.config.cacheTtlSeconds },
    );

    this.memoryBundleCache.set(memKey, bundle);
    return bundle;
  }

  private bundleMemKey(
    locale: Locale,
    namespace: string,
    guildId: string | null,
  ): string {
    return `${guildId ?? 'global'}:${locale}:${namespace}`;
  }

  private handleMissing(
    key: string,
    resolved: ResolvedLocale,
    guildId: string | null,
  ): void {
    if (this.config.reportMissingKeys) {
      this.missingKeyReporter.report(
        key,
        resolved.primary,
        resolved.chain,
        guildId,
      );
    }
  }

  private missingFallback(key: string): string {
    switch (this.config.missingKeyPolicy) {
      case 'return-empty':
        return '';
      default:
        return key;
    }
  }

  private async fetchGuildLocale(guildId: string): Promise<string | null> {
    try {
      const config = await this.prisma['guildConfig'].findFirst({
        where: { guildId, deletedAt: null },
      });
      return (config as { locale?: string } | null)?.locale ?? null;
    } catch {
      return null;
    }
  }

  private async fetchUserLocale(
    userId: string,
    guildId?: string,
  ): Promise<string | null> {
    try {
      const pref = await this.prisma['userLocalePreference'].findFirst({
        where: { userId, guildId: guildId ?? null },
      });
      return (pref as { locale?: string } | null)?.locale ?? null;
    } catch {
      return null;
    }
  }
}
