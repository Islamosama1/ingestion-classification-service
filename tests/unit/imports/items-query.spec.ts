import { InvalidQueryError } from '../../../src/common/errors';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  parseItemsQuery,
} from '../../../src/imports/items-query';

describe('parseItemsQuery', () => {
  it('no params → no filter, default page', () => {
    expect(parseItemsQuery({})).toEqual({
      outcome: undefined,
      limit: DEFAULT_PAGE_LIMIT,
      offset: 0,
    });
    expect(DEFAULT_PAGE_LIMIT).toBe(100);
    expect(MAX_PAGE_LIMIT).toBe(1000);
  });

  it.each(['created', 'duplicate', 'conflict', 'invalid'])(
    'outcome=%s is accepted',
    (outcome) => {
      expect(parseItemsQuery({ outcome }).outcome).toBe(outcome);
    },
  );

  it('reads limit and offset as integers', () => {
    expect(parseItemsQuery({ limit: '25', offset: '50' })).toMatchObject({
      limit: 25,
      offset: 50,
    });
  });

  it('accepts limit at the max', () => {
    expect(parseItemsQuery({ limit: '1000' }).limit).toBe(1000);
  });

  it.each([
    ['outcome', 'skipped'],
    ['outcome', ''],
    ['limit', '0'],
    ['limit', '1001'],
    ['limit', '-5'],
    ['limit', '2.5'],
    ['limit', 'ten'],
    ['offset', '-1'],
    ['offset', '1.5'],
    ['offset', 'x'],
  ])('%s=%p → InvalidQueryError naming the param', (param, value) => {
    expect(() => parseItemsQuery({ [param]: value })).toThrow(
      InvalidQueryError,
    );
    expect(() => parseItemsQuery({ [param]: value })).toThrow(
      new RegExp(param),
    );
  });

  it('a repeated param (?outcome=a&outcome=b) → InvalidQueryError', () => {
    expect(() => parseItemsQuery({ outcome: ['invalid', 'created'] })).toThrow(
      InvalidQueryError,
    );
  });

  it('unknown params are ignored', () => {
    expect(parseItemsQuery({ sort: 'desc' })).toMatchObject({ offset: 0 });
  });
});
