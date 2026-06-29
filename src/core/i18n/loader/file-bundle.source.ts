import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locale } from '../contracts/translation-context';

export type Bundle = Record<string, string>;

@Injectable()
export class FileBundleSource {
  private readonly logger = new Logger(FileBundleSource.name);
  private readonly localesRoot: string;

  constructor() {
    this.localesRoot = join(process.cwd(), 'locales');
  }

  async load(locale: Locale, namespace: string): Promise<Bundle> {
    const filePath = join(this.localesRoot, locale, `${namespace}.json`);
    try {
      const raw = await readFile(filePath, 'utf8');
      return JSON.parse(raw) as Bundle;
    } catch {
      this.logger.debug({
        msg: 'i18n.cache',
        source: 'file',
        miss: true,
        locale,
        namespace,
      });
      return {};
    }
  }
}
