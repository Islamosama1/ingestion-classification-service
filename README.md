# Data Ingestion & Classification Service

A backend service that imports records from external sources, validates and stores them, and assigns each one a category in the background.

> **Status:** project setup only. The service starts, connects to PostgreSQL and answers `GET /health`. Imports, classification and the rest of the API are being built.

## Stack

- Node.js 20 + TypeScript
- NestJS 11
- PostgreSQL 16 (Docker Compose)
- TypeORM
- Jest + Supertest

## Prerequisites

- Node.js 20 or newer
- Docker Desktop (or Docker Engine with Compose)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your local env file and set your own DB password
cp .env.example .env
#    Replace every CHANGE_ME in .env with the same password.

# 3. Start PostgreSQL (creates the "ingestion" and "ingestion_test" databases)
docker compose up -d --wait
```

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

## Run

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
```

## Coming next

Database schema and migrations, API keys, imports with validation and duplicate detection, import progress, background classification with retries, record search, manual review, corrections and recovery of failed records. Technical decisions, assumptions, limitations and example API requests will be added here as they're built.
