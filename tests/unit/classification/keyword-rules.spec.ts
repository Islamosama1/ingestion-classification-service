import { CATEGORIES } from '../../../src/classification/categories';
import {
  KEYWORDS,
  classifyByKeywords,
} from '../../../src/classification/keyword-rules';

const THRESHOLD = 0.7;
const classify = (title: string, description = '') =>
  classifyByKeywords({ title, description }, THRESHOLD);

describe('classifyByKeywords', () => {
  it('has keywords for every category except other (the fallback)', () => {
    expect(Object.keys(KEYWORDS).sort()).toEqual(
      CATEGORIES.filter((c) => c !== 'other').sort(),
    );
  });

  it.each([
    ['Football tournament', 'sports'],
    ['Modern art exhibition', 'culture'],
    ['Python programming workshop', 'education'],
    ['Startup investor pitch night', 'business'],
    ['Free blood pressure check at the clinic', 'health'],
  ])('%p → %s, confident, no review', (title, category) => {
    expect(classify(title)).toEqual({
      category,
      confidence: 1,
      needsReview: false,
    });
  });

  it('no keyword at all → other, low confidence, needs review', () => {
    expect(classify('Community picnic', 'Bring your own food')).toEqual({
      category: 'other',
      confidence: 0,
      needsReview: true,
    });
  });

  it('is case-insensitive', () => {
    expect(classify('FOOTBALL TOURNAMENT').category).toBe('sports');
  });

  it('matches whole words, not parts of other words ("art" ≠ "start", "party")', () => {
    expect(classify('Start of the party').category).toBe('other');
  });

  it('prefix keywords match word forms ("swim" → swimming, swimmers)', () => {
    expect(classify('Swimming lessons for swimmers').category).toBe('sports');
  });

  it('title counts more than description', () => {
    const r = classify('Football match', 'Held at the museum');
    expect(r.category).toBe('sports');
  });

  it('a single keyword only in the description → low confidence, review', () => {
    const r = classify('Saturday event', 'Near the museum');
    expect(r.category).toBe('culture');
    expect(r.confidence).toBe(0.5);
    expect(r.needsReview).toBe(true);
  });

  it('two categories mixed → lower confidence, review', () => {
    const r = classify('Football and finance');
    expect(r.confidence).toBeLessThan(THRESHOLD);
    expect(r.needsReview).toBe(true);
  });

  it('a tie between categories → review, first category in list order', () => {
    const r = classify('Concert', 'Football');
    const r2 = classify('Football', 'Concert');
    expect(r.needsReview).toBe(true);
    expect(r2.needsReview).toBe(true);
    // Title weight decides when not tied:
    expect(r.category).toBe('culture');
    expect(r2.category).toBe('sports');

    const tie = classify('Football concert');
    expect(tie.needsReview).toBe(true);
    expect(tie.category).toBe('sports'); // sports comes before culture
  });

  it('confidence is between 0 and 1 with at most 3 decimals', () => {
    for (const t of [
      'Football and finance',
      'Football football finance',
      'Museum',
      'Clinic school market gym',
    ]) {
      const { confidence } = classify(t, 'Workshop');
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
      expect(Math.round(confidence * 1000) / 1000).toBe(confidence);
    }
  });

  it('review flag follows the threshold (confidence >= threshold → no review)', () => {
    const r = classify('Saturday event', 'Near the museum'); // 0.5
    expect(
      classifyByKeywords(
        { title: 'Saturday event', description: 'Near the museum' },
        0.5,
      ).needsReview,
    ).toBe(false);
    expect(
      classifyByKeywords(
        { title: 'Saturday event', description: 'Near the museum' },
        0.51,
      ).needsReview,
    ).toBe(true);
    expect(r.confidence).toBe(0.5);
  });

  it('is deterministic (same input → same result)', () => {
    expect(classify('Football tournament', 'Kids')).toEqual(
      classify('Football tournament', 'Kids'),
    );
  });
});
