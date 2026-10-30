# Data Ingestion & Classification Service

A backend service that imports records from external sources, validates and stores them, and assigns each one a category in the background.

> **Status:** records can be imported (`POST /imports`) with validation and duplicate / conflict detection, and an import's progress and per-record feedback can be read. Classification and the rest of the API are being built.

## Stack

- Node.js 20 + TypeScript
- NestJS 11
- PostgreSQL 16 (Docker Compose)
- TypeORM
- Jest + Supertest

## Run with Docker only

Needs only Docker (no Node.js).

```bash
git clone https://github.com/Islamosama1/ingestion-classification-service.git
cd ingestion-classification-service

cp .env.example .env
# Replace every CHANGE_ME in .env with the same password (letters and digits),
# and set API_KEY to your own long random value.

docker compose up -d --build --wait
curl http://localhost:3000/health
# {"status":"ok","db":"up"}
```

Every other endpoint needs the `API_KEY` from `.env` in the `X-API-Key` header:

```bash
curl -H "X-API-Key: <API_KEY from .env>" http://localhost:3000/...
```

Stop with `docker compose down` (add `-v` to also delete the database).

On every start a one-off `migrate` container applies pending migrations and exits; the `api` container (compiled app, non-root user) starts only after that succeeds.

## Local development

### Prerequisites

- Node.js 20 or newer
- Docker Desktop (or Docker Engine with Compose)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your local env file, set your own DB password and API key
cp .env.example .env
#    Replace every CHANGE_ME in .env with the same password; set API_KEY.

# 3. Start only PostgreSQL (creates the "ingestion" and "ingestion_test" databases)
docker compose up -d --wait postgres

# 4. Create the tables
npm run migration:run
```

### Migrations

| Command | What |
|---|---|
| `npm run migration:run` | Apply pending migrations to `DATABASE_URL` |
| `npm run migration:revert` | Undo the last migration |
| `npm run migration:show` | List migrations, `[X]` = applied |

The schema is changed only through migrations (`src/database/migrations/`); TypeORM auto-sync is off.

`.env` is ignored by git. Never commit it.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development`, `test` or `production` |
| `PORT` | no | `3000` | HTTP port |
| `DATABASE_URL` | yes | – | App database (`postgres://…`) |
| `API_KEY` | yes | – | Key clients send as `X-API-Key`; at least 16 characters |
| `CLASSIFIER_MIN_DELAY_MS` | no | `200` | Mock classifier: shortest time per call (0–60000) |
| `CLASSIFIER_MAX_DELAY_MS` | no | `1500` | Mock classifier: longest time per call (≥ min) |
| `CLASSIFIER_FAILURE_RATE` | no | `0.1` | Mock classifier: chance a call fails (0–1) |
| `REVIEW_THRESHOLD` | no | `0.7` | Results with lower confidence need manual review (0–1) |
| `TEST_DATABASE_URL` | for integration tests | – | Test database; must differ from `DATABASE_URL` |
| `POSTGRES_USER` | for Docker | – | Postgres user created by Docker Compose |
| `POSTGRES_PASSWORD` | for Docker | – | Postgres password created by Docker Compose |
| `POSTGRES_PORT` | no | `5432` | Host port for Postgres |

The app checks these at startup and refuses to start if any are missing or invalid, listing every problem in one error.

### Run

```bash
npm run start:dev        # watch mode
# or
npm run build
npm start
```

Check it's up:

```bash
curl http://localhost:3000/health
# 200 {"status":"ok","db":"up"}
# 503 {"status":"error","db":"down"} if the database can't be reached
```

## Tests

| Command | What | Needs |
|---|---|---|
| `npm test` | Unit tests (`tests/unit/`) | nothing |
| `npm run test:integration` | Integration tests on the real test DB (`tests/integration/`) | Postgres running, `TEST_DATABASE_URL` set |
| `npm run test:api-flow` | Full HTTP flows (`tests/api-flow/`) | Postgres running |

Integration tests always use `TEST_DATABASE_URL` (set before the app loads) and stop if it equals `DATABASE_URL`, so they never touch the dev database. They use their own fixed test API key, not the one in `.env`.

## Authentication

- Every endpoint needs the header `X-API-Key: <API_KEY>`, except `GET /health`.
- Missing or wrong key → `401`, same response either way (no hint which).
- The key is compared in constant time.
- One shared key: there are no per-user accounts, so actions are not attributed to a person.

## API

All requests except `GET /health` need `X-API-Key`. Bodies are JSON, up to 10 MB.

### `POST /imports`: submit records

```bash
curl -X POST http://localhost:3000/imports \
  -H "X-API-Key: <API_KEY>" -H "Content-Type: application/json" \
  -d '{"records": [
        {"externalId": "e-1", "source": "partner-a", "title": "Football camp",
         "description": "Summer camp for kids", "date": "2026-07-01"},
        {"externalId": "e-2", "source": "partner-a", "title": "",
         "description": "No title", "date": "2026-02-30"}
      ]}'
```

`202 Accepted`: records are stored now; classification runs in the background.

```json
{
  "importId": "7c1e…",
  "status": "processing",
  "total": 2, "created": 1, "duplicate": 0, "conflict": 0, "invalid": 1,
  "items": [
    { "index": 0, "outcome": "created", "externalId": "e-1", "source": "partner-a", "recordId": "a41f…" },
    { "index": 1, "outcome": "invalid", "externalId": "e-2", "source": "partner-a", "recordId": null,
      "errors": [
        { "field": "title", "message": "title is required" },
        { "field": "date", "message": "date must be an ISO 8601 date (2026-07-01) or date-time with time zone (2026-07-01T10:30:00Z)" }
      ] }
  ]
}
```

| Outcome | Meaning | `recordId` |
|---|---|---|
| `created` | New record stored, queued for classification | the new record |
| `duplicate` | Same `source` + `externalId` already stored (or earlier in this batch) with the same content; nothing changed | the existing record |
| `conflict` | Same `source` + `externalId`, **different** content; the stored record is kept as is | the existing record |
| `invalid` | Failed validation; see `errors` | `null` |

- `status` is `processing` when something was created (it will be classified), otherwise `completed`.
- Duplicate detection is safe under concurrent imports: the database's unique key decides, so two imports of the same record at once create it once.
- An import is all-or-nothing: the import, its records and its per-item feedback are saved in one transaction.

### `GET /imports/:id`: progress and outcome of an import

```json
{
  "importId": "7c1e…",
  "status": "processing",
  "createdAt": "2026-10-30T09:12:44.120Z",
  "total": 6, "created": 3, "duplicate": 1, "conflict": 1, "invalid": 1,
  "classification": { "pending": 1, "processing": 1, "classified": 1, "needsReview": 0, "failed": 0 }
}
```

- `classification` counts the records **this import created** (not duplicates of older records), by classification stage.
- `status` is worked out from those records on every read, so it's never stale: `processing` while any is `pending` or `processing`, otherwise `completed`. `failed` counts as finished; retrying a failed record makes the import `processing` again.
- Unknown id (or not a UUID) → `404`.

### `GET /imports/:id/items`: per-record feedback

`?outcome=created|duplicate|conflict|invalid` (optional), `?limit=` (1–1000, default 100), `?offset=` (default 0). Items are in submission order.

```json
{
  "items": [
    { "index": 3, "outcome": "invalid", "externalId": "d", "source": "partner-a", "recordId": null,
      "errors": [{ "field": "title", "message": "title is required" }] }
  ],
  "total": 1, "limit": 100, "offset": 0
}
```

`total` is the count for the filter, for paging. A bad `outcome`, `limit` or `offset` → `400 invalid_query`.

### Errors

Every error has the same shape:

```json
{ "error": { "code": "invalid_batch", "message": "\"records\" must contain at most 1000 records" } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_batch` | Body isn't `{ "records": [...] }` with 1–1000 items |
| 400 | `invalid_json` | Body isn't valid JSON |
| 400 | `invalid_query` | A query parameter is malformed (e.g. `limit=0`) |
| 401 | `unauthorized` | Missing or wrong `X-API-Key` |
| 404 | `not_found` | Unknown route or id |
| 413 | `payload_too_large` | Body over 10 MB |
| 500 | `internal_error` | Unexpected error (details are logged, never returned) |

## Record validation

An import is `{ "records": [ ... ] }` with 1 to 1000 records. A body that isn't that shape is refused as a whole. Otherwise each record is checked on its own: one bad record doesn't block the others, and each gets its own field errors.

| Field | Rule |
|---|---|
| `externalId` | required string, ≤ 255 chars |
| `source` | required string, ≤ 100 chars |
| `title` | required string, ≤ 200 chars |
| `description` | required string, ≤ 5000 chars |
| `date` | required ISO 8601: `2026-07-01` (midnight UTC) or a date-time with time zone (`2026-07-01T10:30:00Z`, `…+02:00`); real calendar dates only; future dates allowed |

- Text is trimmed; empty or spaces-only counts as missing. Lengths are counted after trimming, in characters.
- Types are strict: `123` is not accepted as an `externalId` (no silent conversion, so duplicate checks stay exact).
- A date-time without a time zone is refused (ambiguous).
- Extra fields are ignored.
- Errors are `{ field, message }`, one per field, all bad fields reported at once.

## Classification (mocked)

No real AI service is used. A mock classifier stands in for one: it gives each record a category with a confidence, takes a random time, and sometimes fails, so the rest of the system has to cope with a slow, flaky service.

**Categories:** `sports`, `culture`, `education`, `business`, `health`, `other`.

**How it decides (deterministic keyword rules):**

- Each category has a keyword list (`src/classification/keyword-rules.ts`). Words match whole and case-insensitive; some match word forms (`swim*` → swimming).
- A keyword in the title is worth 2 points, in the description 1. The category with the most points wins.
- Confidence = the winner's share of all points × the strength of evidence (full at 2 points), between 0 and 1.
- **Needs review** when confidence is below `REVIEW_THRESHOLD`, when two categories tie, or when nothing matched (then the category is `other`, confidence 0).

| Title / description | Result |
|---|---|
| "Football tournament" | `sports`, 1.0 |
| "Saturday event" / "Near the museum" | `culture`, 0.5 → review |
| "Football and finance" | tie → review |
| "Community picnic" | `other`, 0 → review |

**Like a real service:** every call waits a random `CLASSIFIER_MIN_DELAY_MS`–`CLASSIFIER_MAX_DELAY_MS` and fails with probability `CLASSIFIER_FAILURE_RATE` (a slow failure also takes the delay). The answer itself is always the same for the same input; only timing and failures are random.

The worker depends on a `Classifier` interface, so the mock can be replaced by a real service without other changes.

## Database schema

| Table | Holds |
|---|---|
| `imports` | One per submitted batch: status and counts |
| `import_items` | One per submitted record: outcome (`created` / `duplicate` / `conflict` / `invalid`) and field errors |
| `records` | Stored records; unique on (`source`, `external_id`); classification status, attempts, retry time |
| `classifications` | Every classification result and correction |

Rules the database enforces itself, not just the code:

- **No duplicates:** unique (`source`, `external_id`), safe under concurrent imports.
- **History is kept:** `classifications` is append-only; a trigger refuses `UPDATE` and `DELETE`. A correction is a new row pointing to the one it corrects; `records.current_classification_id` points to the latest.
- **Valid values only:** check constraints on statuses, outcomes, categories, confidence (0–1), and on what a correction must contain (original and reason).

## Code quality

```bash
npm run lint           # ESLint
npm run format:check   # Prettier
npx tsc --noEmit       # Type check
```

## Project layout

```
src/
  config/      env validation
  database/    data source + migrations
  api-keys/    global X-API-Key guard, @Public()
  common/      shared error filter
  imports/     POST /imports, GET /imports/:id(/items), validation, duplicates
  records/     RecordEntity
  classification/ Classification entity, categories, mock classifier
  health/      GET /health
  app.module.ts
  main.ts
tests/
  unit/        fast tests, fake DB
  integration/ real test DB
  api-flow/    whole flows over HTTP
  helpers/
docker/
  postgres/init/  creates the test DB on first start
Dockerfile         production image (multi-stage, non-root)
docker-compose.yml postgres + migrate + api
```

## Coming next

Background classification with retries, record search, manual review, corrections and recovery of failed records. Technical decisions, assumptions, limitations and example API requests will be added here as they're built.
