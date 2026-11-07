#!/usr/bin/env bash
# Prepare an isolated database (campus_drift_e2e), seed it, build the known scenario, then serve the real API on :8030.
# Used by playwright.real.config.ts so black-box tests run against the real backend, database and simulated devices.
set -euo pipefail
cd "$(dirname "$0")/../.."
PY=./.venv/bin/python
export DATABASE_URL="postgresql+psycopg2://postgres:postgres@localhost:${POSTGRES_PORT:-5433}/campus_drift_e2e"
export CELERY_TASK_ALWAYS_EAGER=True   # poll tasks run inline: no Redis worker needed
export LOGIN_MAX_FAILURES=1000        # the browser tests sign in with wrong passwords on purpose
docker exec campus_drift_postgres psql -U postgres -c "DROP DATABASE IF EXISTS campus_drift_e2e WITH (FORCE)" >/dev/null
docker exec campus_drift_postgres psql -U postgres -c "CREATE DATABASE campus_drift_e2e" >/dev/null
(cd backend && ../.venv/bin/alembic upgrade head >/dev/null 2>&1)
(cd backend && ../.venv/bin/python ../database/seed/seed_data.py >/dev/null 2>&1)
$PY scripts/validation_setup.py --key /tmp/campus_drift_e2e_key.json >/dev/null 2>&1
cd backend
exec ../.venv/bin/uvicorn app.main:app --port 8030 --log-level warning
