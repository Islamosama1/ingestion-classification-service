import { contentHash, planImport } from '../../../src/imports/import-plan';
import {
  ValidRecord,
  validateRecord,
} from '../../../src/imports/record-validation';

const rec = (over: Partial<ValidRecord> = {}): ValidRecord => ({
  externalId: 'ext-1',
  source: 'partner-a',
  title: 'Football camp',
  description: 'Summer camp',
  date: new Date('2026-07-01T00:00:00Z'),
  ...over,
});

const raw = (over: { [k: string]: unknown } = {}) => ({
  externalId: 'ext-1',
  source: 'partner-a',
  title: 'Football camp',
  description: 'Summer camp',
  date: '2026-07-01',
  ...over,
});

describe('contentHash', () => {
  it('is a 64-char hex string, same content → same hash', () => {
    expect(contentHash(rec())).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash(rec())).toBe(contentHash(rec()));
  });

  it.each([
    ['title', { title: 'Basketball camp' }],
    ['description', { description: 'Winter camp' }],
    ['date', { date: new Date('2026-07-02T00:00:00Z') }],
  ])('changes when %s changes', (_f, over) => {
    expect(contentHash(rec(over))).not.toBe(contentHash(rec()));
  });

  it('ignores source and externalId (identity, not content)', () => {
    expect(contentHash(rec({ source: 'b', externalId: 'x' }))).toBe(
      contentHash(rec()),
    );
  });

  it('same instant written differently → same hash', () => {
    expect(
      contentHash(rec({ date: new Date('2026-07-01T02:00:00+02:00') })),
    ).toBe(contentHash(rec()));
  });

  it('field boundaries matter ("ab"+"c" ≠ "a"+"bc")', () => {
    expect(contentHash(rec({ title: 'ab', description: 'c' }))).not.toBe(
      contentHash(rec({ title: 'a', description: 'bc' })),
    );
  });
});

describe('planImport', () => {
  const plan = (raws: unknown[]) => planImport(raws.map(validateRecord));

  it('all different → every item is new, in index order', () => {
    const p = plan([raw(), raw({ externalId: 'ext-2' })]);
    expect(p.map((i) => [i.index, i.kind])).toEqual([
      [0, 'new'],
      [1, 'new'],
    ]);
  });

  it('invalid items keep their errors and raw ids', () => {
    const [item] = plan([raw({ title: '' })]);
    expect(item).toEqual({
      index: 0,
      kind: 'invalid',
      errors: [{ field: 'title', message: 'title is required' }],
      externalId: 'ext-1',
      source: 'partner-a',
    });
  });

  it('same record twice, same content → second is a repeat with sameContent', () => {
    const p = plan([raw(), raw()]);
    expect(p[0].kind).toBe('new');
    expect(p[1]).toMatchObject({
      index: 1,
      kind: 'repeat',
      of: 0,
      sameContent: true,
    });
  });

  it('same record twice, different content → repeat with sameContent false', () => {
    const p = plan([raw(), raw({ title: 'Changed' })]);
    expect(p[1]).toMatchObject({ kind: 'repeat', of: 0, sameContent: false });
  });

  it('a third copy points to the first occurrence, not the second', () => {
    const p = plan([raw(), raw(), raw()]);
    expect(p[2]).toMatchObject({ kind: 'repeat', of: 0 });
  });

  it('same externalId from a different source is not a repeat', () => {
    const p = plan([raw(), raw({ source: 'partner-b' })]);
    expect(p.map((i) => i.kind)).toEqual(['new', 'new']);
  });

  it('values are compared after trimming', () => {
    const p = plan([
      raw(),
      raw({ externalId: ' ext-1 ', title: ' Football camp ' }),
    ]);
    expect(p[1]).toMatchObject({ kind: 'repeat', sameContent: true });
  });

  it('an invalid copy is reported invalid, not as a repeat', () => {
    const p = plan([raw(), raw({ date: 'nope' })]);
    expect(p[1].kind).toBe('invalid');
  });

  it('a valid copy after an invalid first one becomes the new one', () => {
    const p = plan([raw({ date: 'nope' }), raw()]);
    expect(p.map((i) => i.kind)).toEqual(['invalid', 'new']);
  });

  it('new items carry the clean record and its hash', () => {
    const [item] = plan([raw()]);
    expect(item).toEqual({
      index: 0,
      kind: 'new',
      record: rec(),
      hash: contentHash(rec()),
    });
  });
});
