import { Injectable, Logger } from '@nestjs/common';
import IntlMessageFormat from 'intl-messageformat';
import type {
  InterpolationValues,
  Locale,
} from '../contracts/translation-context';

@Injectable()
export class IcuFormatter {
  private readonly logger = new Logger(IcuFormatter.name);

  format(
    message: string,
    values: InterpolationValues | undefined,
    locale: Locale,
    fallback: string,
  ): string {
    try {
      const fmt = new IntlMessageFormat(message, locale);
      const result = fmt.format<string>(values);
      return Array.isArray(result) ? result.join('') : result;
    } catch (err: unknown) {
      const message_ = err instanceof Error ? err.message : String(err);
      this.logger.error({
        msg: 'i18n.icu.error',
        icuMessage: message,
        locale,
        err: message_,
      });
      return fallback;
    }
  }

  isValid(message: string, locale: Locale): boolean {
    try {
      new IntlMessageFormat(message, locale);
      return true;
    } catch {
      return false;
    }
  }
}
