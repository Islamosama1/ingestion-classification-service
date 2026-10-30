import {
  InvalidBatchError,
  MAX_RECORDS_PER_IMPORT,
  parseImportBody,
  validateRecord,
} from '../../../src/imports/record-validation';

const good = {
  externalId: 'ext-1',
  source: 'partner-a',
  title: 'Football camp',
  description: 'Summer camp for kids',
  date: '2026-07-01',
};

function errorsOf(raw: unknown) {
  const r = validateRecord(raw);
  if (r.ok) throw new Error('expected invalid');
  return r.errors;
}

function fieldsWithErrors(raw: unknown): string[] {
  return errorsOf(raw).map((e) => e.field);
}

describe('validateRecord: valid input', () => {
  it('accepts a full record and returns clean values', () => {
    expect(validateRecord(good)).toEqual({
      ok: true,
      record: {
        externalId: 'ext-1',
        source: 'partner-a',
        title: 'Football camp',
        description: 'Summer camp for kids',
        date: new Date('2026-07-01T00:00:00.000Z'),
      },
    });
  });

  it('trims every text field', () => {
    const r = validateRecord({
      externalId: '  ext-1 ',
      source: ' partner-a ',
      title: ' Football camp ',
      description: '\tSummer camp\n',
      date: ' 2026-07-01 ',
    });
    expect(r).toMatchObject({
      ok: true,
      record: {
        externalId: 'ext-1',
        source: 'partner-a',
        title: 'Football camp',
        description: 'Summer camp',
      },
    });
  });

  it('ignores extra fields', () => {
    const r = validateRecord({ ...good, color: 'red', id: 99 });
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(Object.keys(r.record).sort()).toEqual([
        'date',
        'description',
        'externalId',
        'source',
        'title',
      ]);
  });

  it.each([
    ['date only', '2026-07-01', '2026-07-01T00:00:00.000Z'],
    ['UTC datetime', '2026-07-01T10:30:00Z', '2026-07-01T10:30:00.000Z'],
    [
      'with milliseconds',
      '2026-07-01T10:30:00.123Z',
      '2026-07-01T10:30:00.123Z',
    ],
    ['with offset', '2026-07-01T12:30:00+02:00', '2026-07-01T10:30:00.000Z'],
    ['leap day', '2028-02-29', '2028-02-29T00:00:00.000Z'],
    ['future date', '2099-12-31', '2099-12-31T00:00:00.000Z'],
  ])('accepts date: %s', (_name, date, iso) => {
    const r = validateRecord({ ...good, date });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.date.toISOString()).toBe(iso);
  });

  it.each([
    ['externalId', 255],
    ['source', 100],
    ['title', 200],
    ['description', 5000],
  ])('accepts %s at exactly the max length (%i)', (field, max) => {
    expect(validateRecord({ ...good, [field]: 'x'.repeat(max) }).ok).toBe(true);
  });

  it('measures length after trimming', () => {
    expect(
      validateRecord({ ...good, title: `  ${'x'.repeat(200)}  ` }).ok,
    ).toBe(true);
  });
});

describe('validateRecord: invalid input', () => {
  it.each(['externalId', 'source', 'title', 'description', 'date'])(
    'missing %s → error on that field',
    (field) => {
      const raw: { [k: string]: unknown } = { ...good };
      delete raw[field];
      expect(errorsOf(raw)).toEqual([
        { field, message: expect.stringMatching(/required/i) },
      ]);
    },
  );

  it.each(['externalId', 'source', 'title', 'description'])(
    '%s empty or only spaces → required',
    (field) => {
      expect(fieldsWithErrors({ ...good, [field]: '' })).toEqual([field]);
      expect(fieldsWithErrors({ ...good, [field]: '   ' })).toEqual([field]);
    },
  );

  it.each(['externalId', 'source', 'title', 'description', 'date'])(
    '%s null → required',
    (field) => {
      expect(fieldsWithErrors({ ...good, [field]: null })).toEqual([field]);
    },
  );

  it.each([
    ['externalId', 123],
    ['source', true],
    ['title', ['a']],
    ['description', { text: 'x' }],
    ['date', 1751328000000],
  ])('%s of wrong type (%p) → must be a string', (field, value) => {
    expect(errorsOf({ ...good, [field]: value })).toEqual([
      { field, message: expect.stringMatching(/string/i) },
    ]);
  });

  it.each([
    ['externalId', 255],
    ['source', 100],
    ['title', 200],
    ['description', 5000],
  ])('%s over %i chars → error naming the limit', (field, max) => {
    expect(errorsOf({ ...good, [field]: 'x'.repeat(max + 1) })).toEqual([
      { field, message: expect.stringContaining(String(max)) },
    ]);
  });

  it.each([
    ['not a date', 'tomorrow'],
    ['impossible day', '2026-02-30'],
    ['not a leap year', '2027-02-29'],
    ['month 13', '2026-13-01'],
    ['hour 25', '2026-07-01T25:00:00Z'],
    ['no time zone', '2026-07-01T10:30:00'],
    ['US format', '07/01/2026'],
    ['year only', '2026'],
    ['date with trailing text', '2026-07-01abc'],
  ])('date %s (%p) → invalid date', (_name, date) => {
    expect(errorsOf({ ...good, date })).toEqual([
      { field: 'date', message: expect.stringMatching(/ISO 8601/) },
    ]);
  });

  it('reports every bad field at once, one error per field', () => {
    const errors = errorsOf({
      externalId: '',
      source: 'x'.repeat(101),
      title: 5,
      description: 'ok',
      date: 'nope',
    });
    expect(errors.map((e) => e.field)).toEqual([
      'externalId',
      'source',
      'title',
      'date',
    ]);
  });

  it.each([
    ['null', null],
    ['a string', 'record'],
    ['a number', 42],
    ['an array', [good]],
  ])('item is %s → one error "must be an object"', (_name, raw) => {
    expect(errorsOf(raw)).toEqual([
      { field: 'record', message: expect.stringMatching(/object/i) },
    ]);
  });

  it('invalid result keeps the raw externalId and source for feedback', () => {
    const r = validateRecord({ ...good, title: '' });
    expect(r).toMatchObject({
      ok: false,
      externalId: 'ext-1',
      source: 'partner-a',
    });
  });

  it('invalid result has null externalId / source when they are not strings', () => {
    const r = validateRecord({ ...good, externalId: 7, source: undefined });
    expect(r).toMatchObject({ ok: false, externalId: null, source: null });
  });
});

describe('parseImportBody: batch checks', () => {
  const records = (n: number) => Array.from({ length: n }, () => good);

  it('returns the records array as is (items checked one by one later)', () => {
    const items = [good, 'junk', null];
    expect(parseImportBody({ records: items })).toBe(items);
  });

  it('accepts exactly the max (1000)', () => {
    expect(MAX_RECORDS_PER_IMPORT).toBe(1000);
    expect(parseImportBody({ records: records(1000) })).toHaveLength(1000);
  });

  it.each([
    ['no body', undefined],
    ['body is an array', [good]],
    ['body is a string', 'records'],
    ['records missing', {}],
    ['records not an array', { records: good }],
    ['records null', { records: null }],
  ])('%s → InvalidBatchError', (_name, body) => {
    expect(() => parseImportBody(body)).toThrow(InvalidBatchError);
  });

  it('empty records → InvalidBatchError', () => {
    expect(() => parseImportBody({ records: [] })).toThrow(/at least 1/);
  });

  it('1001 records → InvalidBatchError naming the limit', () => {
    expect(() => parseImportBody({ records: records(1001) })).toThrow(/1000/);
  });
});
