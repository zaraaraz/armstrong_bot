import { beforeEach, describe, expect, it } from 'vitest';
import { TemplateService } from './template.service';
import type { CacheService } from '../../../cache/cache.service';
import type { NotificationsConfigService } from '../config/notifications-config.service';
import type {
  NotificationTemplateRepository,
  TemplateRow,
} from '../infrastructure/notification-template.repository';

/** In-memory template store keyed by `${guildId}|${key}|${locale}`. */
class FakeTemplateRepo {
  rows = new Map<string, TemplateRow>();

  seed(row: TemplateRow): void {
    this.rows.set(`${row.guildId ?? 'null'}|${row.key}|${row.locale}`, row);
  }

  findBest(
    guildId: string | null,
    key: string,
    locale: string,
  ): Promise<TemplateRow | null> {
    const guild = this.rows.get(`${guildId ?? 'null'}|${key}|${locale}`);
    if (guild) return Promise.resolve(guild);
    const global = this.rows.get(`null|${key}|${locale}`);
    return Promise.resolve(global ?? null);
  }
}

const noCache = {
  getOrSet: <T>(_k: string, loader: () => Promise<T>) => loader(),
  delete: () => Promise.resolve(),
  keys: {
    forGuild: (...p: string[]) => p.join(':'),
    forGlobal: (...p: string[]) => p.join(':'),
    guildNamespacePrefix: () => '',
  },
} as unknown as CacheService;

function makeConfig(defaultLocale = 'pt'): NotificationsConfigService {
  return {
    global: () => ({
      defaultLocale,
      templateCacheTtlSeconds: 0,
    }),
  } as unknown as NotificationsConfigService;
}

function makeService(
  repo: FakeTemplateRepo,
  defaultLocale = 'pt',
): TemplateService {
  return new TemplateService(
    repo as unknown as NotificationTemplateRepository,
    noCache,
    makeConfig(defaultLocale),
  );
}

const row = (over: Partial<TemplateRow>): TemplateRow => ({
  id: 't',
  guildId: null,
  key: 'k',
  locale: 'pt',
  subject: null,
  body: 'body',
  ...over,
});

describe('TemplateService', () => {
  let repo: FakeTemplateRepo;

  beforeEach(() => {
    repo = new FakeTemplateRepo();
  });

  it('interpolates variables into the body', async () => {
    repo.seed(row({ key: 'welcome', body: 'Olá {name}!' }));
    const svc = makeService(repo);
    const out = await svc.render({
      guildId: null,
      templateKey: 'welcome',
      vars: { name: 'Ana' },
      locale: 'pt',
      category: 'system',
      priority: 'normal',
    });
    expect(out.body).toBe('Olá Ana!');
    expect(out.locale).toBe('pt');
  });

  it('renders ICU plurals', async () => {
    repo.seed(
      row({
        key: 'commits',
        body: '{n, plural, one {# commit} other {# commits}}',
      }),
    );
    const svc = makeService(repo);
    const one = await svc.render({
      guildId: null,
      templateKey: 'commits',
      vars: { n: 1 },
      locale: 'en',
      category: 'integrations',
      priority: 'normal',
    });
    // Only the EN body was seeded; locale resolves to en for correct plural.
    expect(one.body).toBe('1 commit');
  });

  it('falls back requested -> EN when the requested locale is missing', async () => {
    repo.seed(row({ key: 'hi', locale: 'en', body: 'Hi' }));
    const svc = makeService(repo);
    const out = await svc.render({
      guildId: null,
      templateKey: 'hi',
      vars: {},
      locale: 'de', // no de, no pt, but en exists
      category: 'system',
      priority: 'normal',
    });
    expect(out.body).toBe('Hi');
    expect(out.locale).toBe('en');
  });

  it('falls back to a built-in default when the DB has no row', async () => {
    const svc = makeService(repo);
    const out = await svc.render({
      guildId: null,
      templateKey: 'system.test',
      vars: { by: 'Ana' },
      locale: 'pt',
      category: 'system',
      priority: 'normal',
    });
    expect(out.body).toContain('Ana');
  });

  it('falls back to the raw key when nothing matches at all', async () => {
    const svc = makeService(repo);
    const out = await svc.render({
      guildId: null,
      templateKey: 'nonexistent.key',
      vars: {},
      locale: 'pt',
      category: 'system',
      priority: 'normal',
    });
    expect(out.body).toBe('nonexistent.key');
  });

  it('prefers a guild override over the global default', async () => {
    repo.seed(row({ key: 'k', guildId: null, body: 'global' }));
    repo.seed(row({ key: 'k', guildId: 'g1', body: 'guild' }));
    const svc = makeService(repo);
    const out = await svc.render({
      guildId: 'g1',
      templateKey: 'k',
      vars: {},
      locale: 'pt',
      category: 'system',
      priority: 'normal',
    });
    expect(out.body).toBe('guild');
  });
});
