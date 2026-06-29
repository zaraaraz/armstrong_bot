import { Injectable } from '@nestjs/common';
import type { Locale } from '../contracts/translation-context';
import type { TranslationRepository } from '../repository/translation.repository';
import type { Bundle } from './file-bundle.source';

@Injectable()
export class DbBundleSource {
  constructor(private readonly repo: TranslationRepository) {}

  async load(
    locale: Locale,
    namespace: string,
    guildId: string | null,
  ): Promise<Bundle> {
    const records = await this.repo.findBundle(locale, namespace, guildId);
    const bundle: Bundle = {};
    for (const r of records) {
      bundle[r.key] = r.value;
    }
    return bundle;
  }
}
