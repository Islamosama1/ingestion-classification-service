import { InvalidQueryError } from '../../../src/common/errors';
import { parseReviewsQuery } from '../../../src/records/records-query';

describe('parseReviewsQuery', () => {
  it('always means "needs review", no status filter', () => {
    expect(parseReviewsQuery({})).toMatchObject({
      needsReview: true,
      status: undefined,
      limit: 50,
      offset: 0,
    });
  });

  it('keeps the other record filters', () => {
    expect(
      parseReviewsQuery({
        source: 'partner-a',
        category: 'other',
        q: 'camp',
        from: '2026-07-01',
        limit: '10',
      }),
    ).toMatchObject({
      source: 'partner-a',
      category: 'other',
      q: 'camp',
      from: new Date('2026-07-01T00:00:00Z'),
      limit: 10,
      needsReview: true,
    });
  });

  it.each([
    ['status', 'pending'],
    ['needsReview', 'false'],
    ['needsReview', 'true'],
  ])(
    '%s=%s → InvalidQueryError (the list is review-only by definition)',
    (param, value) => {
      expect(() => parseReviewsQuery({ [param]: value })).toThrow(
        InvalidQueryError,
      );
      expect(() => parseReviewsQuery({ [param]: value })).toThrow(
        new RegExp(param),
      );
    },
  );

  it('bad values of shared filters are still refused', () => {
    expect(() => parseReviewsQuery({ category: 'music' })).toThrow(
      InvalidQueryError,
    );
  });
});
