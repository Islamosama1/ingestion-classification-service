import { InvalidQueryError } from '../../../src/common/errors';
import {
  RECORDS_DEFAULT_LIMIT,
  RECORDS_MAX_LIMIT,
  parseRecordsQuery,
} from '../../../src/records/records-query';

const ID = '7c1e5a40-1111-4a4a-9b9b-123456789abc';

describe('parseRecordsQuery', () => {
  it('no params → no filters, default page', () => {
    expect(parseRecordsQuery({})).toEqual({
      source: undefined,
      category: undefined,
      status: undefined,
      needsReview: undefined,
      importId: undefined,
      from: undefined,
      toBefore: undefined,
      q: undefined,
      limit: RECORDS_DEFAULT_LIMIT,
      offset: 0,
    });
    expect(RECORDS_DEFAULT_LIMIT).toBe(50);
    expect(RECORDS_MAX_LIMIT).toBe(200);
  });

  it('reads every filter', () => {
    expect(
      parseRecordsQuery({
        source: ' partner-a ',
        category: 'sports',
        status: 'needs_review',
        needsReview: 'true',
        importId: ID,
        from: '2026-07-01',
        to: '2026-07-31T12:00:00Z',
        q: ' camp ',
        limit: '10',
        offset: '20',
      }),
    ).toEqual({
      source: 'partner-a',
      category: 'sports',
      status: 'needs_review',
      needsReview: true,
      importId: ID,
      from: new Date('2026-07-01T00:00:00Z'),
      toBefore: new Date('2026-07-31T12:00:00.001Z'),
      q: 'camp',
      limit: 10,
      offset: 20,
    });
  });

  it('needsReview=false is kept as false', () => {
    expect(parseRecordsQuery({ needsReview: 'false' }).needsReview).toBe(false);
  });

  it('a date-only "to" covers that whole day', () => {
    expect(parseRecordsQuery({ to: '2026-07-31' }).toBefore).toEqual(
      new Date('2026-08-01T00:00:00Z'),
    );
  });

  it('from equal to to is allowed', () => {
    expect(() =>
      parseRecordsQuery({ from: '2026-07-01', to: '2026-07-01' }),
    ).not.toThrow();
  });

  it.each(['sports', 'culture', 'education', 'business', 'health', 'other'])(
    'category=%s is accepted',
    (category) => {
      expect(parseRecordsQuery({ category }).category).toBe(category);
    },
  );

  it.each(['pending', 'processing', 'classified', 'needs_review', 'failed'])(
    'status=%s is accepted',
    (status) => {
      expect(parseRecordsQuery({ status }).status).toBe(status);
    },
  );

  it.each([
    ['category', 'music'],
    ['status', 'done'],
    ['needsReview', 'yes'],
    ['needsReview', '1'],
    ['importId', 'abc'],
    ['from', 'yesterday'],
    ['to', '2026-02-30'],
    ['q', 'x'.repeat(201)],
    ['source', 'x'.repeat(101)],
    ['source', '   '],
    ['q', '  '],
    ['limit', '0'],
    ['limit', '201'],
    ['offset', '-1'],
  ])('%s=%p → InvalidQueryError naming it', (param, value) => {
    expect(() => parseRecordsQuery({ [param]: value })).toThrow(
      InvalidQueryError,
    );
    expect(() => parseRecordsQuery({ [param]: value })).toThrow(
      new RegExp(param),
    );
  });

  it('from after to → InvalidQueryError', () => {
    expect(() =>
      parseRecordsQuery({ from: '2026-08-01', to: '2026-07-01' }),
    ).toThrow(/from/);
  });

  it('a repeated param → InvalidQueryError', () => {
    expect(() => parseRecordsQuery({ source: ['a', 'b'] })).toThrow(
      InvalidQueryError,
    );
  });
});
