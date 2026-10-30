import { CATEGORIES, Category } from './categories';
import { ClassifierInput, ClassifierResult } from './classifier';

type Scored = Exclude<Category, 'other'>;

// Whole words, case-insensitive; a trailing * also matches longer forms
// ("swim*" → swimming, swimmers). "other" has none: it is the fallback.
// prettier-ignore
export const KEYWORDS: { [c in Scored]: string[] } = {
  sports: [
    'sport*', 'football', 'soccer', 'basketball', 'tennis', 'volleyball',
    'swim*', 'athlet*', 'marathon', 'cycling', 'match', 'tournament*',
    'league', 'gym', 'olympi*', 'championship*',
  ],
  culture: [
    'cultur*', 'art', 'arts', 'artist*', 'museum*', 'exhibit*', 'concert*',
    'music*', 'theater', 'theatre', 'film*', 'cinema', 'festival*',
    'gallery', 'galleries', 'dance', 'dancing', 'poetry', 'heritage', 'opera',
  ],
  education: [
    'educat*', 'school*', 'course*', 'class', 'classes', 'workshop*',
    'lecture*', 'training', 'universit*', 'student*', 'learn*', 'teach*',
    'tutor*', 'seminar*', 'lesson*', 'academ*', 'scholarship*',
  ],
  business: [
    'business*', 'startup*', 'invest*', 'market*', 'financ*',
    'entrepreneur*', 'networking', 'sales', 'trade', 'company', 'companies',
    'corporate', 'econom*', 'bank*', 'pitch',
  ],
  health: [
    'health*', 'medical', 'medicine', 'doctor*', 'clinic*', 'hospital*',
    'vaccin*', 'nutrition*', 'wellness', 'fitness', 'yoga', 'mental',
    'therapy', 'diet*', 'blood', 'disease*',
  ],
};

const SCORED = CATEGORIES.filter((c): c is Scored => c !== 'other');

const PATTERNS: { [c in Scored]: RegExp } = Object.fromEntries(
  SCORED.map((c) => {
    const words = KEYWORDS[c].map((k) =>
      k.endsWith('*') ? `${k.slice(0, -1)}\\w*` : k,
    );
    return [c, new RegExp(`\\b(?:${words.join('|')})\\b`, 'gi')];
  }),
) as { [c in Scored]: RegExp };

const TITLE_WEIGHT = 2;
const DESCRIPTION_WEIGHT = 1;
// Points needed for full strength: one title hit.
const FULL_EVIDENCE = 2;

const hits = (re: RegExp, text: string): number => text.match(re)?.length ?? 0;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

// Deterministic scoring: confidence = share of all points the winner has ×
// how much evidence there is. Ties, no match, or confidence below the
// threshold are flagged for manual review.
export function classifyByKeywords(
  input: ClassifierInput,
  reviewThreshold: number,
): ClassifierResult {
  const scores = SCORED.map((category) => ({
    category,
    points:
      TITLE_WEIGHT * hits(PATTERNS[category], input.title) +
      DESCRIPTION_WEIGHT * hits(PATTERNS[category], input.description),
  }));
  const total = scores.reduce((sum, s) => sum + s.points, 0);
  if (total === 0) {
    return { category: 'other', confidence: 0, needsReview: true };
  }

  const best = Math.max(...scores.map((s) => s.points));
  // First in list order wins a tie, so results never depend on chance.
  const winner = scores.find((s) => s.points === best)!;
  const tied = scores.filter((s) => s.points === best).length > 1;
  const confidence = round3((best / total) * Math.min(1, best / FULL_EVIDENCE));

  return {
    category: winner.category,
    confidence,
    needsReview: tied || confidence < reviewThreshold,
  };
}
