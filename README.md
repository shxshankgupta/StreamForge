# StreamForge

StreamForge is a production-oriented, full-stack, real-time event processing system built with FastAPI, Redis, Celery, PostgreSQL, and Next.js. It ingests event batches, processes them asynchronously, persists outcomes, exposes analytics APIs, and streams live stats to the frontend over Server-Sent Events.

## File Structure

```text
StreamForge/
├── .env
├── .env.example
├── .gitignore
├── README.md
├── docker-compose.yml
├── backend/
│   ├── .dockerignore
│   ├── Dockerfile
│   ├── pytest.ini
│   ├── requirements.txt
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── routes.py
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── celery_app.py
│   │   │   ├── config.py
│   │   │   └── logging.py
│   │   ├── db/
│   │   │   ├── __init__.py
│   │   │   └── base.py
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── dead_letter.py
│   │   │   └── event.py
│   │   ├── schemas/
│   │   │   ├── __init__.py
│   │   │   ├── event.py
│   │   │   └── stats.py
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── analytics.py
│   │   │   ├── events.py
│   │   │   └── redis_client.py
│   │   └── workers/
│   │       ├── __init__.py
│   │       └── tasks.py
│   └── tests/
│       ├── __init__.py
│       ├── conftest.py
│       ├── load_test.py
│       ├── test_analytics.py
│       └── test_api.py
└── frontend/
    ├── .dockerignore
    ├── Dockerfile
    ├── next-env.d.ts
    ├── next.config.ts
    ├── package.json
    ├── postcss.config.js
    ├── tailwind.config.ts
    ├── tsconfig.json
    ├── app/
    │   ├── globals.css
    │   ├── layout.tsx
    │   └── page.tsx
    ├── components/
    │   └── dashboard.tsx
    └── lib/
        └── types.ts
```

## Architecture

- FastAPI exposes ingestion, health, analytics, and SSE endpoints.
- Celery workers consume jobs from Redis and process events asynchronously.
- PostgreSQL stores processed event records and dead-letter entries.
- Redis is used for Celery brokering, short-lived stats caching, and pub/sub fan-out for live updates.
- Next.js renders the dashboard and subscribes to `/stats/stream` for real-time analytics.

## Requirements

- Python 3.11+
- Node.js 18+
- Docker

## Run With Docker

1. From the project root, build and start everything:

```bash
docker-compose up --build
```

2. Open the apps:

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend API: [http://localhost:8000](http://localhost:8000)
- Health check: [http://localhost:8000/health](http://localhost:8000/health)

## Local Development

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Worker

```bash
cd backend
celery -A app.core.celery_app.celery_app worker --loglevel=INFO --concurrency=4
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## API Endpoints

### `POST /events`

Accepts a validated batch of events and enqueues them for asynchronous processing.

Example request:

```bash
curl -X POST http://localhost:8000/events \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "event_id": "evt-1001",
        "category": "orders",
        "payload": {"amount": 125, "customer_id": "cust-17"}
      },
      {
        "event_id": "evt-1002",
        "category": "payments",
        "payload": {"amount": 54, "currency": "USD"}
      }
    ]
  }'
```

Example response:

```json
{
  "accepted": 2,
  "task_ids": [
    "44f7b58a-e719-4c6e-b023-567f5854ee50",
    "96b7222a-a790-410d-b8f8-5322f8de17eb"
  ],
  "request_id": "8d7f8130-4851-4683-b935-d9802294f6cb"
}
```

### `GET /stats`

Returns aggregate analytics.

Example response:

```json
{
  "total_events": 2400,
  "events_per_second": 40.0,
  "top_categories": [
    {"category": "orders", "count": 1200},
    {"category": "payments", "count": 700},
    {"category": "alerts", "count": 500}
  ]
}
```

### `GET /stats/stream`

Streams live analytics via Server-Sent Events.

Example:

```bash
curl -N http://localhost:8000/stats/stream
```

## Event Schema

Each event in `POST /events` supports:

```json
{
  "event_id": "string",
  "category": "string",
  "payload": {},
  "occurred_at": "2026-04-06T12:00:00+00:00"
}
```

## Failure Handling

- Celery retries failed jobs up to 3 times with exponential backoff.
- Events that still fail after the last retry are written to the `dead_letter_events` table.
- Failed events are also stored in `processed_events` with `status="failed"`.

To simulate a failure, send `{"force_fail": true}` inside an event payload.

## Design decisions

Redis is used for both the Celery queue and the stats pub/sub channel because StreamForge already depends on it as the fast in-memory coordination layer between the API, workers, and dashboard. Keeping queueing and live metric fanout in one operational dependency reduces setup complexity while still matching the needs of this project: durable enough task handoff through Celery and low-latency notifications for observability.

Retries are bounded with backoff so transient failures get another chance without letting a bad event consume worker capacity forever. The delay between attempts gives downstream systems time to recover, and the hard retry limit keeps the pipeline predictable under repeated failures.

Failed events are persisted to `dead_letter_events` instead of being dropped silently because failures are data the operator needs to inspect. A dead-letter table preserves the payload and error context for debugging, replay decisions, and proof that the system handled the failure deliberately.

Queue depth measures how many events are waiting in Redis before workers process them, which makes backlog pressure visible during bursts. The latency percentiles measure `processed_at - occurred_at` across the latest processed events; p50 shows the typical path, while p95 and p99 reveal slower tail behavior that averages can hide.

## Testing

### Unit and integration tests

```bash
cd backend
pytest
```

### Load test

This script is designed to push 1000+ events per second depending on machine capacity and Docker resource allocation.

```bash
cd backend
python tests/load_test.py --base-url http://localhost:8000 --total-events 20000 --batch-size 200 --concurrency 32
```

## Operational Notes

- Request IDs are attached to every API response as `X-Request-ID`.
- Application logs are emitted as structured JSON with level and request ID fields.
- Analytics are cached briefly in Redis to avoid repeated heavy aggregation under load.
- Database tables are initialized automatically on service startup.

## Environment Variables

The project reads configuration from the root `.env` file. Important variables:

- `DATABASE_URL`
- `REDIS_URL`
- `REDIS_ENABLED`
- `CELERY_TASK_ALWAYS_EAGER`
- `CELERY_RESULT_BACKEND`
- `WORKER_CONCURRENCY`
- `STATS_CACHE_TTL_SECONDS`
- `STATS_WINDOW_SECONDS`
- `CORS_ORIGINS`
- `NEXT_PUBLIC_API_BASE_URL`

## Summary

StreamForge runs end to end with a single `docker-compose up --build` command and includes:

- real-time event ingestion
- asynchronous processing with retries
- dead-letter handling
- PostgreSQL persistence
- live analytics over SSE
- a Next.js monitoring dashboard
- unit tests, API tests, and a load generator
