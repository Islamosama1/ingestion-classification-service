import { InvalidBodyError } from '../../../src/common/errors';
import {
  MAX_REASON_LENGTH,
  parseCorrectionBody,
} from '../../../src/records/correction-body';

describe('parseCorrectionBody', () => {
  it('accepts a category and a reason', () => {
    expect(
      parseCorrectionBody({ category: 'health', reason: 'It is a clinic day' }),
    ).toEqual({ category: 'health', reason: 'It is a clinic day' });
  });

  it('trims the reason', () => {
    expect(
      parseCorrectionBody({ category: 'health', reason: '  wrong topic \n' })
        .reason,
    ).toBe('wrong topic');
  });

  it('ignores extra fields', () => {
    expect(
      parseCorrectionBody({ category: 'sports', reason: 'r', confidence: 1 }),
    ).toEqual({ category: 'sports', reason: 'r' });
  });

  it(`accepts a reason of exactly ${1000} characters`, () => {
    expect(MAX_REASON_LENGTH).toBe(1000);
    expect(() =>
      parseCorrectionBody({ category: 'sports', reason: 'x'.repeat(1000) }),
    ).not.toThrow();
  });

  it.each([
    ['body is not an object', 'health', 'category'],
    ['body is null', null, 'category'],
    ['category missing', { reason: 'r' }, 'category'],
    [
      'category not in the list',
      { category: 'music', reason: 'r' },
      'category',
    ],
    ['category wrong type', { category: 3, reason: 'r' }, 'category'],
    ['reason missing', { category: 'sports' }, 'reason'],
    ['reason empty', { category: 'sports', reason: '' }, 'reason'],
    ['reason only spaces', { category: 'sports', reason: '   ' }, 'reason'],
    ['reason wrong type', { category: 'sports', reason: 5 }, 'reason'],
    [
      'reason too long',
      { category: 'sports', reason: 'x'.repeat(1001) },
      'reason',
    ],
  ])('%s → InvalidBodyError naming %s', (_name, body, field) => {
    expect(() => parseCorrectionBody(body)).toThrow(InvalidBodyError);
    expect(() => parseCorrectionBody(body)).toThrow(
      new RegExp(field as string),
    );
  });

  it('the category error lists the allowed categories', () => {
    expect(() =>
      parseCorrectionBody({ category: 'music', reason: 'r' }),
    ).toThrow(/sports, culture, education, business, health, other/);
  });
});
