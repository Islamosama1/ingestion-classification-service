// A query string parameter is malformed (→ 400 invalid_query).
export class InvalidQueryError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ids are UUIDs; anything else can't exist, so callers answer 404 without
// sending it to the DB (which would fail on the cast).
export const isUuid = (value: string): boolean => UUID.test(value);
