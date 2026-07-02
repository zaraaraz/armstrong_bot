import { Injectable } from '@nestjs/common';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import { NOTIF_CACHE } from '../notifications.constants';
import { NotificationsConfigService } from '../config/notifications-config.service';
import {
  NotificationPreferenceRepository,
  type PreferenceRow,
} from '../infrastructure/notification-preference.repository';
import type { NotificationsGuildConfig } from '../config/notifications.config';
import { ALL_CHANNELS } from './value-objects/notification-channel.vo';
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationPriority,
} from '../notifications.public';

export interface ResolveChannelsInput {
  readonly guildId: string | null;
  readonly userId?: string;
  readonly category: NotificationCategory;
  readonly priority: NotificationPriority;
  /** Explicit channel override; when present it wins over preferences. */
  readonly forcedChannels?: ReadonlyArray<NotificationChannel>;
  /** Evaluation instant (defaults to now); injectable for tests. */
  readonly now?: Date;
}

export interface ChannelDecision {
  readonly channel: NotificationChannel;
  readonly allowed: boolean;
  readonly reason: string | null;
}

/**
 * Decides which channels a notification reaches for a given recipient. The
 * merge order is:
 *   1. Start from the forced channels, else the guild's `enabledChannels`.
 *   2. Drop any channel the user has explicitly disabled for the category.
 *   3. Defer (skip) non-critical channels while quiet hours are active.
 * Critical-priority notifications always bypass quiet hours.
 */
@Injectable()
export class PreferenceResolver {
  constructor(
    private readonly repo: NotificationPreferenceRepository,
    private readonly cache: CacheService,
    private readonly config: NotificationsConfigService,
  ) {}

  async resolve(input: ResolveChannelsInput): Promise<ChannelDecision[]> {
    const guildConfig = await this.config.forGuild(input.guildId);
    const candidates = this.candidateChannels(input, guildConfig);
    const userPrefs = await this.loadUserPrefs(input.guildId, input.userId);
    const now = input.now ?? new Date();
    const quiet =
      input.priority !== 'critical' && this.inQuietHours(guildConfig, now);

    return candidates.map((channel) =>
      this.decide(channel, input.category, userPrefs, quiet),
    );
  }

  /** True when `now` falls inside the guild's configured quiet-hours window. */
  inQuietHours(config: NotificationsGuildConfig, now: Date): boolean {
    const { quietHours } = config;
    if (!quietHours.enabled) return false;
    const hour = this.hourInZone(now, quietHours.timezone);
    const { startHour, endHour } = quietHours;
    if (startHour === endHour) return false;
    // Window wraps midnight (e.g. 23 -> 7): inside if hour >= start OR < end.
    if (startHour > endHour) return hour >= startHour || hour < endHour;
    // Same-day window (e.g. 1 -> 6): inside if start <= hour < end.
    return hour >= startHour && hour < endHour;
  }

  private decide(
    channel: NotificationChannel,
    category: NotificationCategory,
    userPrefs: ReadonlyMap<string, boolean>,
    quiet: boolean,
  ): ChannelDecision {
    const pref = userPrefs.get(this.prefKey(category, channel));
    if (pref === false) {
      return { channel, allowed: false, reason: 'user-disabled' };
    }
    if (quiet) {
      return { channel, allowed: false, reason: 'quiet-hours' };
    }
    return { channel, allowed: true, reason: null };
  }

  private candidateChannels(
    input: ResolveChannelsInput,
    guildConfig: NotificationsGuildConfig,
  ): NotificationChannel[] {
    if (input.forcedChannels && input.forcedChannels.length > 0) {
      // De-dupe while preserving caller order.
      return [...new Set(input.forcedChannels)];
    }
    const enabled = new Set(guildConfig.enabledChannels);
    return ALL_CHANNELS.filter((c) => enabled.has(c));
  }

  private async loadUserPrefs(
    guildId: string | null,
    userId: string | undefined,
  ): Promise<ReadonlyMap<string, boolean>> {
    if (!guildId || !userId) return new Map();
    const ttl = this.config.global().preferenceCacheTtlSeconds;
    const load = (): Promise<PreferenceRow[]> =>
      this.repo.findForUser(guildId, userId);
    const rows =
      ttl === 0
        ? await load()
        : await this.cache.getOrSet<PreferenceRow[]>(
            this.prefCacheKey(guildId, userId),
            load,
            { ttlSeconds: ttl, tags: [`guild:${guildId}`] },
          );
    const map = new Map<string, boolean>();
    for (const row of rows) {
      map.set(this.prefKey(row.category, row.channel), row.enabled);
    }
    return map;
  }

  async invalidateUser(guildId: string, userId: string): Promise<void> {
    await this.cache.delete(this.prefCacheKey(guildId, userId));
  }

  private prefKey(category: string, channel: NotificationChannel): string {
    return `${category}:${channel}`;
  }

  private prefCacheKey(guildId: string, userId: string): string {
    return this.cache.keys.forGuild(
      guildId,
      CacheNamespace.Generic,
      NOTIF_CACHE.Preference,
      userId,
    );
  }

  /** Hour-of-day (0-23) at `now` in the given IANA timezone. */
  private hourInZone(now: Date, timezone: string): number {
    try {
      const fmt = new Intl.DateTimeFormat('en-GB', {
        hour: 'numeric',
        hour12: false,
        timeZone: timezone,
      });
      const hour = Number.parseInt(fmt.format(now), 10);
      // Intl returns 24 for midnight in some engines; normalise to 0.
      return Number.isFinite(hour) ? hour % 24 : now.getUTCHours();
    } catch {
      // Unknown timezone -> fall back to UTC rather than throwing on the path.
      return now.getUTCHours();
    }
  }
}
