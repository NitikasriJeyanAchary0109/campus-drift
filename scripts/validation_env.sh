#!/usr/bin/env bash
# Stand up an isolated, repeatable environment for stakeholder-validation sessions.
#   ./scripts/validation_env.sh start   create DB campus_drift_validation, migrate, seed, run the scenario, start API :8020 + UI :5200
#   ./scripts/validation_env.sh reset   re-run the scenario (do this before EVERY participant)
#   ./scripts/validation_env.sh stop    stop the API and UI
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d .venv ] || { echo "Create the virtualenv first (see README)"; exit 2; }
# shellcheck disable=SC1091
source .venv/bin/activate
PGPORT_HOST="$(grep '^POSTGRES_PORT=' .env 2>/dev/null | cut -d= -f2 || true)"; PGPORT_HOST="${PGPORT_HOST:-5432}"
export DATABASE_URL="postgresql+psycopg2://postgres:postgres@localhost:${PGPORT_HOST}/campus_drift_validation"
PIDS=.validation_pids
NODE_BIN="${NODE_BIN:-}"; [ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"

case "${1:-start}" in
  start)
    docker compose up -d --build postgres redis sim_switch_classroom sim_switch_hostel sim_router_lab >/dev/null
    for _ in $(seq 1 30); do docker exec campus_drift_postgres pg_isready -U postgres >/dev/null 2>&1 && break || sleep 1; done
    docker exec campus_drift_postgres psql -U postgres -c "DROP DATABASE IF EXISTS campus_drift_validation" >/dev/null
    docker exec campus_drift_postgres psql -U postgres -c "CREATE DATABASE campus_drift_validation" >/dev/null
    (cd backend && alembic upgrade head >/dev/null)
    python database/seed/seed_data.py >/dev/null
    python scripts/validation_setup.py
    ./scripts/validation_env.sh stop >/dev/null 2>&1 || true
    (cd backend && nohup uvicorn app.main:app --port 8020 > ../.validation_api.log 2>&1 & echo $! >> ../$PIDS)
    (cd frontend && BACKEND_URL=http://localhost:8020 nohup ./node_modules/.bin/vite --port 5200 --host 127.0.0.1 > ../.validation_ui.log 2>&1 & echo $! >> ../$PIDS)
    sleep 4
    echo; echo "Ready: open http://127.0.0.1:5200  (demo logins: admin/admin123, neteng/neteng123, viewer/viewer123)"
    ;;
  reset) python scripts/validation_setup.py ;;
  stop)  [ -f "$PIDS" ] && { xargs kill < "$PIDS" 2>/dev/null || true; rm -f "$PIDS"; }; echo stopped ;;
  *) echo "usage: $0 start|reset|stop"; exit 2 ;;
esac
