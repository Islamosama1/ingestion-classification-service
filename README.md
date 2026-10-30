# Data Ingestion & Classification Service

A backend service that imports records from external sources, validates and stores them, and assigns each one a category in the background.

> **Status:** setup and database schema done. The service starts, applies migrations, connects to PostgreSQL and answers `GET /health`. Imports, classification and the rest of the API are being built.

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
# Replace every CHANGE_ME in .env with the same password (letters and digits).

docker compose up -d --build --wait
curl http://localhost:3000/health
# {"status":"ok","db":"up"}
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

# 2. Create your local env file and set your own DB password
cp .env.example .env
#    Replace every CHANGE_ME in .env with the same password.

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

Integration tests always use `TEST_DATABASE_URL` and stop if it equals `DATABASE_URL`, so they never touch the dev database.

## Database schema

| Table | Holds |
|---|---|
| `api_keys` | Client keys (SHA-256 hash only), revocable |
| `imports` | One per submitted batch: status and counts |
| `import_items` | One per submitted record: outcome (`created` / `duplicate` / `conflict` / `invalid`) and field errors |
| `records` | Stored records; unique on (`source`, `external_id`); classification status, attempts, retry time |
| `classifications` | Every classification result and correction |

Rules the database enforces itself, not just the code:

- **No duplicates:** unique (`source`, `external_id`), safe under concurrent imports.
- **History is kept:** `classifications` is append-only; a trigger refuses `UPDATE` and `DELETE`. A correction is a new row pointing to the one it corrects; `records.current_classification_id` points to the latest.
- **Valid values only:** check constraints on statuses, outcomes, categories, confidence (0–1), and on what a correction must contain (original, reason, who).

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
  api-keys/    ApiKey entity
  imports/     Import, ImportItem entities
  records/     RecordEntity
  classification/ Classification entity, categories
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

API keys, imports with validation and duplicate detection, import progress, background classification with retries, record search, manual review, corrections and recovery of failed records. Technical decisions, assumptions, limitations and example API requests will be added here as they're built.
