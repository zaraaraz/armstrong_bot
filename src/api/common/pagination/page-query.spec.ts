import { pageQuerySchema, parseSort, MAX_PAGE_LIMIT } from './page-query.dto';

describe('pageQuerySchema', () => {
  it('applies defaults', () => {
    const parsed = pageQuerySchema.parse({});
    expect(parsed.limit).toBe(25);
    expect(parsed.sort).toBe('-createdAt');
  });

  it('coerces and clamps limit to the max', () => {
    expect(() =>
      pageQuerySchema.parse({ limit: MAX_PAGE_LIMIT + 1 }),
    ).toThrow();
    expect(pageQuerySchema.parse({ limit: '50' }).limit).toBe(50);
  });

  it('rejects an invalid sort field', () => {
    expect(() => pageQuerySchema.parse({ sort: '1bad;drop' })).toThrow();
  });
});

describe('parseSort', () => {
  it('parses ascending and descending', () => {
    expect(parseSort('createdAt')).toEqual({
      field: 'createdAt',
      direction: 'asc',
    });
    expect(parseSort('-createdAt')).toEqual({
      field: 'createdAt',
      direction: 'desc',
    });
  });
});
