# Data Ingestion & Classification Service

A backend service that imports records from external sources, validates and stores them, and assigns each one a category in the background.

| Requirement | How |
|---|---|
| Submit multiple records for import | `POST /imports` (1–1000 per request) |
| Identify invalid records with useful feedback | Per-record outcome with `{ field, message }` errors, in the response and `GET /imports/:id/items` |
| Prevent duplicates | DB unique key on (`source`, `externalId`); same content → `duplicate`, different → `conflict`, never overwritten; safe under concurrent imports |
| Track progress and outcome of an import | `GET /imports/:id`: counts + classification progress, status always current |
| Retrieve and filter stored records | `GET /records` with 7 filters + paging |
| Retrieve a record and its classification | `GET /records/:id`: current result + full history |
| Identify results needing manual review | `GET /reviews` queue (longest waiting first), `needsReview` filter |
| Correct a classification, keeping the original | `POST /records/:id/corrections`: new row; classifications are append-only (DB trigger) |
| Recover failed records without duplicates or redoing work | Automatic retries with backoff; `POST /records/:id/retry`, `POST /imports/:id/retry` touch only `failed` records |
| Slow, sometimes failing classification | Mock classifier with random delay / failures, run by a background worker with crash recovery |

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

To try every endpoint, use the [API collection](#api-collection).

On every start a one-off `migrate` container applies pending migrations and exits; the `api` and `worker` containers (compiled app, non-root user) start only after that succeeds. The `worker` classifies imported records in the background; run more of them with `docker compose up -d --scale worker=3`.

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
| `WORKER_BATCH_SIZE` | no | `10` | Records a worker claims per round, classified in parallel (1–100) |
| `WORKER_POLL_INTERVAL_MS` | no | `1000` | Wait before looking again when nothing is due |
| `WORKER_MAX_ATTEMPTS` | no | `5` | Attempts per record before it is `failed` (1–20) |
| `WORKER_RETRY_BASE_MS` | no | `2000` | First retry wait; doubles after each failed attempt |
| `WORKER_RETRY_MAX_MS` | no | `60000` | Longest retry wait (≥ base) |
| `WORKER_STALE_LOCK_MS` | no | `60000` | A record locked longer is taken over (crashed worker); must be above `CLASSIFIER_MAX_DELAY_MS` |
| `TEST_DATABASE_URL` | for integration tests | – | Test database; must differ from `DATABASE_URL` |
| `POSTGRES_USER` | for Docker | – | Postgres user created by Docker Compose |
| `POSTGRES_PASSWORD` | for Docker | – | Postgres password created by Docker Compose |
| `POSTGRES_PORT` | no | `5432` | Host port for Postgres |

The app checks these at startup and refuses to start if any are missing or invalid, listing every problem in one error.

### Run

```bash
npm run start:dev          # API, watch mode
npm run start:worker:dev   # worker, watch mode (second terminal)
# or
npm run build
npm start                  # API
npm run start:worker       # worker
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
| `npm test` | Unit tests (`tests/unit/`): logic, with fakes | nothing |
| `npm run test:integration` | Integration tests (`tests/integration/`): the full app or the worker on the real test DB — SQL, constraints, transactions, concurrency | Postgres running (`docker compose up -d --wait postgres`), `TEST_DATABASE_URL` in `.env` |
| `npm run test:api-flow` | The whole flow over HTTP (`tests/api-flow/`): import → worker → feedback → search → review → correct → retry | The service running (`docker compose up -d --build --wait`, or `start:dev` + `start:worker:dev`); uses `API_KEY` / `PORT` from `.env`, or `API_BASE_URL` |

- Integration tests always use `TEST_DATABASE_URL` (set before the app loads) and stop if it equals `DATABASE_URL`, so they never touch the dev database. They use their own fixed test API key, not the one in `.env`. Each test cleans up the rows it wrote.
- The worker tests use a scriptable fake classifier (success, needs review, failures, slow calls, a takeover mid-call) instead of the random mock.
- The API-flow test uses a new `source` on every run, so it can run against a database that already has data.

What is covered, by area:

| Area | Tested behaviour (examples) |
|---|---|
| Validation | Every field rule at the limit and one past it, wrong types, impossible dates, time zones, non-object items, batch size |
| Duplicates | In-batch and against stored records, duplicate vs conflict, never overwritten, **two concurrent imports of the same records → one row each** |
| Worker | Claim / classify / save, retries with backoff, final failure, crash recovery, late result dropped, **3 concurrent workers → each record classified exactly once** |
| Corrections | Original unchanged (and the DB refuses `UPDATE` / `DELETE`), chains, **concurrent corrections → none lost**, `409` / `404` / `400` |
| Retry | Only `failed` records touched, everything else byte-for-byte unchanged, **concurrent retries → requeued once** |
| API | Auth on every route, error shape, filters, paging, `404` for unknown and malformed ids |

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

### `GET /records`: search stored records

Filters (all optional, combined with AND):

| Param | Matches |
|---|---|
| `source` | exact source |
| `category` | current classification's category (after a correction, the corrected one) |
| `status` | `pending` / `processing` / `classified` / `needs_review` / `failed` |
| `needsReview` | `true` = needs manual review, `false` = everything else |
| `importId` | records created by that import |
| `from`, `to` | record `date` range, both ends included; a date-only `to` covers the whole day |
| `q` | title contains the text (case-insensitive; `%` and `_` are plain characters) |
| `limit`, `offset` | page size 1–200 (default 50), offset (default 0) |

Newest stored first. A bad param → `400 invalid_query`.

```json
{
  "items": [
    {
      "id": "a41f…", "externalId": "e-1", "source": "partner-a",
      "title": "Football camp", "description": "Summer camp for kids",
      "date": "2026-07-01T00:00:00.000Z", "importId": "7c1e…",
      "status": "classified", "attempts": 1, "lastError": null,
      "createdAt": "2026-10-30T09:12:44.120Z",
      "classification": { "id": "5d0b…", "category": "sports", "confidence": 1, "needsReview": false, "kind": "auto", "createdAt": "…" }
    }
  ],
  "total": 1, "limit": 50, "offset": 0
}
```

`classification` is `null` until the record is classified.

### `GET /records/:id`: one record with its classification history

Same fields as a list item, plus `history`: every classification the record ever had, oldest first (automatic results and corrections, each with `kind`, `correctsId`, `reason`). The current one is in `classification`. Unknown id → `404`.

### `GET /reviews`: the manual review queue

Records whose classification needs a person (`status: needs_review`), **longest waiting first** (by when they were flagged). Items and paging are the same as `/records`; the `/records` filters (`source`, `category`, `importId`, `from`, `to`, `q`) also work here. `status` and `needsReview` are refused (`400`): the list is review-only by definition. A record leaves the queue once it no longer needs review (e.g. after a correction).

### `POST /records/:id/corrections`: correct a classification

```bash
curl -X POST http://localhost:3000/records/<id>/corrections \
  -H "X-API-Key: <API_KEY>" -H "Content-Type: application/json" \
  -d '{"category": "health", "reason": "It is a clinic open day"}'
```

`201` with the record as `GET /records/:id` now returns it:

- The correction is saved as a **new** classification (`kind: "correction"`, `correctsId` → the result it corrects, `reason`, `confidence: null`). The original is never changed or deleted; it stays in `history`.
- The correction becomes the current classification; the record's status becomes `classified`, so it leaves the review queue.
- Keeping the same category is allowed (it confirms the result). A correction can be corrected again; each one points to the previous, so the full chain is kept. Concurrent corrections of one record are applied one after the other, none is lost.

| Case | Response |
|---|---|
| `category` not one of the 6, or `reason` missing / empty / over 1000 chars | `400 invalid_body` (checked first) |
| Unknown record | `404` |
| Record not classified yet (`pending`, `processing`, `failed`) | `409 conflict` |

### Recovering failed records

A record is `failed` after `WORKER_MAX_ATTEMPTS` failed classification attempts (e.g. the service was down). Once the cause is fixed, put it back in the queue:

| Endpoint | Does | Response |
|---|---|---|
| `POST /records/:id/retry` | Requeues one `failed` record | `202` + the record (as `GET /records/:id`) |
| `POST /imports/:id/retry` | Requeues every `failed` record that import created | `202 { "importId": "…", "requeued": 3 }` |

- A requeued record goes back to `pending` with **attempts reset to 0** and is due at once; the worker classifies it as usual. Its `lastError` stays visible until the next attempt.
- **No duplicated data:** no record or classification is created by a retry.
- **No repeated work:** only `failed` records are touched; `classified`, `needs_review`, `pending` and `processing` ones are left exactly as they are.
- **Safe to repeat:** retrying a record that is no longer failed → `409`; a second (or concurrent) import retry requeues `0` more.
- An import retry covers the records that import created; a record it only found as a duplicate belongs to the earlier import.

### API collection

Two ready-to-run collections, in flow order (import → progress → feedback → search → review → correct → retry → errors). Both save ids between requests.

- **[`api.http`](api.http)**: VS Code (REST Client extension) or JetBrains IDEs. Set `@apiKey` at the top to the `API_KEY` in your `.env`, then click "Send Request" top to bottom.
- **[`postman/ingestion-classification-service.postman_collection.json`](postman/ingestion-classification-service.postman_collection.json)**: import into Postman, set the collection variable `apiKey`, run the collection. Every request checks its response, and the progress request waits until the worker has finished. From the command line:

  ```bash
  npx newman run postman/ingestion-classification-service.postman_collection.json --env-var apiKey=<API_KEY>
  ```

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
| 400 | `invalid_body` | A body field is missing or wrong (e.g. unknown category) |
| 401 | `unauthorized` | Missing or wrong `X-API-Key` |
| 404 | `not_found` | Unknown route or id |
| 409 | `conflict` | The action doesn't fit the record's state (e.g. correcting an unclassified record, retrying one that isn't failed) |
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

## Background worker

A separate process (`worker` container) classifies records. Its life cycle for each record:

```
pending ──claim──▶ processing ──ok──▶ classified / needs_review
   ▲                  │
   └──retry later─────┤ failed attempt (attempts < max)
                      └──────────────▶ failed (attempts = max)
```

- **No double work:** records are claimed with `SELECT … FOR UPDATE SKIP LOCKED`, so any number of workers never take the same record. Records that are `classified`, `needs_review` or `failed` are never picked up again.
- **Short transactions:** the slow classifier call happens outside any transaction; the result and the record's new status are then saved together in one short transaction.
- **Retries:** a failed call puts the record back to `pending` with `last_error` and a wait that doubles each time (`WORKER_RETRY_BASE_MS` … `WORKER_RETRY_MAX_MS`). After `WORKER_MAX_ATTEMPTS` the record is `failed`.
- **Crash recovery:** an attempt is counted when a record is claimed. A record left in `processing` longer than `WORKER_STALE_LOCK_MS` (worker crashed or was killed) is claimed again, or `failed` if it has no attempts left.
- **No double results:** every write checks the claim. A late result from a worker whose record was taken over is dropped, so a record never gets two automatic results for one claim.
- **Graceful stop:** on `docker stop` / Ctrl+C the worker stops claiming and finishes the current round.

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
  common/      error filter, error types, query-param checks
  imports/     POST /imports, GET /imports/:id(/items), validation, duplicates
  records/     GET /records(/:id), GET /reviews, corrections, retry, RecordEntity
  classification/ Classification entity, categories, mock classifier
  health/      GET /health
  worker/      background classification worker (own process)
  core.module.ts  config + DB, shared by API and worker
  app.module.ts
  main.ts      API entry
tests/
  unit/        fast tests, fake DB
  integration/ real test DB
  api-flow/    whole flows over HTTP
  helpers/
docker/
  postgres/init/  creates the test DB on first start
postman/           Postman collection
api.http           example requests (VS Code / JetBrains)
Dockerfile         production image (multi-stage, non-root)
docker-compose.yml postgres + migrate + api + worker
```

## Technical decisions

| Decision | Why |
|---|---|
| **NestJS + TypeORM + PostgreSQL** | NestJS gives modules, DI and a clear request pipeline (guard, filter); TypeORM has an official Nest module and supports the two SQL features this design leans on (`SKIP LOCKED`, `ON CONFLICT`). Migrations are hand-written SQL; auto-sync is off. |
| **Postgres as the job queue** (no Redis / broker) | The queue *is* the `records` table: a record's status says whether it needs work. Claiming with `FOR UPDATE SKIP LOCKED` lets any number of workers share it safely. One less moving part, jobs survive restarts, and status and queue can never disagree. |
| **Worker as a separate process** | Slow classification never blocks HTTP requests; workers scale on their own (`--scale worker=N`) and can crash without taking the API down. |
| **Duplicates decided by the DB** | A unique key on (`source`, `external_id`) plus `INSERT … ON CONFLICT DO NOTHING` is the only check that holds under concurrent imports; an app-level "look then insert" would race. Inserts are sorted so overlapping imports wait instead of deadlocking. |
| **Duplicate vs conflict by content hash** | Same id + same content is a harmless resend; same id + different content is reported as `conflict` and the stored record is never silently overwritten. |
| **Import = one transaction** | The import, its records and its per-item feedback are saved together or not at all: no half-imported batch. |
| **Per-record validation, not per-batch** | One bad record doesn't block 999 good ones; each gets field-level errors. Only a malformed request (not `{ records: [...] }`, or over 1000) is refused as a whole. |
| **Classifier called outside any transaction** | No DB locks are held during a slow call. The result is saved in one short transaction afterwards. |
| **Claim token on every worker write** | If a slow worker's record was taken over after its lock went stale, its late result is dropped instead of saved twice. |
| **Attempts counted at claim time** | A crash still uses up an attempt, so a record that keeps killing workers ends `failed` instead of looping forever. |
| **Append-only classifications, enforced by a trigger** | "Preserve the original result" is guaranteed by the database, not just by code paths. Corrections are new rows pointing to what they correct; the record points to the current one. |
| **Import status derived on read** | Counted from the records each time, so it can't go stale (e.g. after a retry). |
| **Retry = one guarded `UPDATE … WHERE status = 'failed'`** | Idempotent and concurrency-safe by construction: nothing else can be touched, nothing is created. |
| **Mock classifier: deterministic answers, random timing / failures** | Answers are explainable and testable; delays and failures exercise the worker's retry and recovery paths like a real flaky service would. Behind a `Classifier` interface. |
| **Single API key from `.env`** | The assignment has no users; one key protects the API with the least setup. |
| **One error shape** `{ error: { code, message } }` | Clients handle every error the same way; unexpected errors are logged and never leak internals. |
| **Docker: one command** | `migrate` runs before `api` / `worker`; a fresh clone works with `docker compose up` and a `.env`. |

## Assumptions

- **A record's identity is (`source`, `externalId`).** The same `externalId` from two sources is two records.
- **"Duplicate" means same identity.** Same identity and same title / description / date → `duplicate`; same identity, different content → `conflict`, reported and **not** applied (there's no rule for which version wins).
- **All five fields are required**, as Task.txt lists them for every record. Limits (255 / 100 / 200 / 5000 chars) are reasonable caps, not given.
- **Dates:** ISO 8601; a date without a time means midnight UTC; a date-time must carry a time zone; future dates are allowed (an "effective date" can be ahead).
- **Categories:** `sports`, `culture`, `education`, `business`, `health`, `other`: a fixed list, since none was given. Changing it needs a migration (the DB enforces it).
- **Manual review** is needed when confidence < 0.7, on a tie, or when nothing matched.
- **Corrections:** any key holder may correct; a reason is required; confirming the same category is allowed.
- **Retry** resets attempts so a recovered record gets a full set of tries.
- **No real users and no production data**, so no data migration concerns.

## Limitations

- **One shared API key:** no per-user accounts, so imports and corrections aren't attributed to a person; rotating the key needs a restart.
- **Imports up to 1000 records / 10 MB per request**, processed synchronously; bigger loads must be split by the client.
- **Text search** (`q`) is a case-insensitive "contains" on the title only, without an index: fine at this scale, slow on millions of rows.
- **Offset paging:** deep pages get slower, and rows added between page requests can shift results.
- **Within one import, `/records` order is stable but not submission order** (records of an import share the same stored time).
- **A conflict is only reported:** there's no endpoint to accept the new version.
- **Polling, not push:** clients poll `GET /imports/:id`; there are no webhooks or events.
- **The mock classifier** uses keyword rules, not a model.
- **Classification metrics / tracing** aren't exported (logs only).

## Possible improvements

- **Per-client API keys or OAuth**, with "who imported / who corrected" recorded (the schema had it before the single-key decision).
- **Large imports:** accept a file (CSV / NDJSON) or a URL, process it in the background and stream progress.
- **Conflict resolution:** an endpoint to accept the incoming version, keeping the old one in history.
- **Search:** Postgres full-text search or trigram indexes on title and description.
- **Keyset (cursor) paging** for large lists.
- **Webhooks / server-sent events** when an import completes or a record needs review.
- **A real classifier** behind the `Classifier` interface, with a circuit breaker and rate limiting.
- **Observability:** Prometheus metrics (queue depth, attempts, failure rate, review rate), structured JSON logs, tracing.
- **Dead-letter view:** list `failed` records with their errors (today: `GET /records?status=failed`).
- **OpenAPI / Swagger** docs generated from the code.
- **CI:** run lint, type check, unit, integration and API-flow tests on every PR (all are already scripted).
