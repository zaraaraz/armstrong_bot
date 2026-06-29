import { Injectable } from '@nestjs/common';
import type { Locale } from '../contracts/translation-context';
import type { Bundle } from './file-bundle.source';
import { FileBundleSource } from './file-bundle.source';
import { DbBundleSource } from './db-bundle.source';

@Injectable()
export class TranslationLoader {
  constructor(
    private readonly fileSource: FileBundleSource,
    private readonly dbSource: DbBundleSource,
  ) {}

  /**
   * Loads and merges a bundle for the given locale+namespace+guild.
   * Precedence (highest wins): DB guild override → DB global override → file default.
   */
  async load(
    locale: Locale,
    namespace: string,
    guildId: string | null,
  ): Promise<Bundle> {
    const [fileBundle, globalDbBundle, guildDbBundle] = await Promise.all([
      this.fileSource.load(locale, namespace),
      this.dbSource.load(locale, namespace, null),
      guildId
        ? this.dbSource.load(locale, namespace, guildId)
        : Promise.resolve<Bundle>({}),
    ]);

    return { ...fileBundle, ...globalDbBundle, ...guildDbBundle };
  }
}
