import { InvalidQueryError } from './errors';

export type RawQuery = { [k: string]: unknown };

// Express gives a string, or an array when the param is repeated.
export function single(query: RawQuery, name: string): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new InvalidQueryError(`${name} must be given once`);
  }
  return value;
}

export function integer(
  query: RawQuery,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = single(query, name);
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new InvalidQueryError(
      `${name} must be a whole number from ${min} to ${max}`,
    );
  }
  return Number(value);
}

// One of a fixed list of values.
export function oneOf<T extends string>(
  query: RawQuery,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = single(query, name);
  if (value !== undefined && !(allowed as readonly string[]).includes(value)) {
    throw new InvalidQueryError(
      `${name} must be one of: ${allowed.join(', ')}`,
    );
  }
  return value as T | undefined;
}

// Trimmed, non-empty text up to max characters.
export function text(
  query: RawQuery,
  name: string,
  max: number,
): string | undefined {
  const value = single(query, name)?.trim();
  if (value === undefined) return undefined;
  if (value === '' || [...value].length > max) {
    throw new InvalidQueryError(`${name} must be 1 to ${max} characters`);
  }
  return value;
}
