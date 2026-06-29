import { Injectable } from '@nestjs/common';
import type { ISanitizer } from '../interfaces/security.interfaces';

const MARKDOWN_SPECIALS = /[\\*_~`>|]/g;
const HTML_TAG = /<[^>]*>/g;
const MENTION = /<@[!&]?\d+>|@(everyone|here)/g;
const UNSAFE_FILENAME = /[^a-zA-Z0-9._-]/g;

/**
 * Input sanitisation helpers. Never trust user input: strip Discord mentions,
 * escape markdown, drop HTML tags, and constrain filenames to a safe charset.
 */
@Injectable()
export class SanitizerService implements ISanitizer {
  /** Remove user/role mentions and @everyone/@here. */
  stripMentions(input: string): string {
    return input
      .replace(MENTION, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /** Escape Discord markdown control characters. */
  escapeMarkdown(input: string): string {
    return input.replace(MARKDOWN_SPECIALS, (ch) => `\\${ch}`);
  }

  /** Strip all HTML tags and decode-safe the angle brackets. */
  sanitizeHtml(input: string): string {
    return input
      .replace(HTML_TAG, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /** Reduce to a safe basename: no path separators, no traversal. */
  sanitizeFilename(input: string): string {
    const base = input.replace(/^.*[\\/]/, '');
    const cleaned = base.replace(UNSAFE_FILENAME, '_').replace(/^\.+/, '');
    return cleaned.slice(0, 255) || 'file';
  }
}
