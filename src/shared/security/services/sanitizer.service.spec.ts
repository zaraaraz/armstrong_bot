import { SanitizerService } from './sanitizer.service';

describe('SanitizerService', () => {
  const s = new SanitizerService();

  describe('stripMentions', () => {
    it('removes user, role and @everyone/@here mentions', () => {
      expect(s.stripMentions('hi <@123> and <@&456>')).toBe('hi and');
      expect(s.stripMentions('ping @everyone now')).toBe('ping now');
      expect(s.stripMentions('@here please')).toBe('please');
    });

    it('leaves clean text untouched', () => {
      expect(s.stripMentions('hello world')).toBe('hello world');
    });
  });

  describe('escapeMarkdown', () => {
    it('escapes markdown control characters', () => {
      expect(s.escapeMarkdown('**bold**')).toBe('\\*\\*bold\\*\\*');
      expect(s.escapeMarkdown('a_b')).toBe('a\\_b');
    });
  });

  describe('sanitizeHtml', () => {
    it('strips tags and escapes brackets', () => {
      expect(s.sanitizeHtml('<script>alert(1)</script>')).toBe('alert(1)');
      expect(s.sanitizeHtml('a < b')).toBe('a &lt; b');
    });
  });

  describe('sanitizeFilename', () => {
    it('strips path traversal and separators', () => {
      expect(s.sanitizeFilename('../../etc/passwd')).toBe('passwd');
      expect(s.sanitizeFilename('a/b/c.txt')).toBe('c.txt');
    });

    it('replaces unsafe characters and never returns empty', () => {
      expect(s.sanitizeFilename('we ird!.png')).toBe('we_ird_.png');
      expect(s.sanitizeFilename('...')).toBe('file');
    });
  });
});
