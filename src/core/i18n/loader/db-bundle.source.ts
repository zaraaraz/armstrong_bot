import { Inject, Injectable } from '@nestjs/common';
import type { Locale } from '../contracts/translation-context';
import type { TranslationRepository } from '../repository/translation.repository';
import { TRANSLATION_REPOSITORY } from '../tokens';
import type { Bundle } from './file-bundle.source';

@Injectable()
export class DbBundleSource {
  constructor(
    // Bound under the TRANSLATION_REPOSITORY token in I18nModule, so inject by
    // token (the abstract class is used only as the type annotation).
    @Inject(TRANSLATION_REPOSITORY)
    private readonly repo: TranslationRepository,
  ) {}

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
