#!/usr/bin/env bash
# One command: bring up the lab, seed it, run the rollback demonstration, save evidence.
#   ./scripts/demo_rollback.sh            (evidence: evaluation/results/rollback_demo/)
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d .venv ] || { echo "Create the virtualenv first: python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt"; exit 2; }
# shellcheck disable=SC1091
source .venv/bin/activate
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL="$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)"
fi
export DATABASE_URL="${DATABASE_URL:-postgresql+psycopg2://postgres:postgres@localhost:5432/campus_drift}"

echo ">> starting Postgres, Redis and the sw-hostel-01 simulator"
docker compose up -d --build postgres redis sim_switch_hostel >/dev/null
echo ">> waiting for Postgres"
for _ in $(seq 1 30); do
  python - <<'PY' && break || sleep 1
import os, sys
from sqlalchemy import create_engine, text
try:
    create_engine(os.environ["DATABASE_URL"]).connect().execute(text("select 1"))
except Exception:
    sys.exit(1)
PY
done

echo ">> migrating and seeding"
(cd backend && alembic upgrade head >/dev/null)
python database/seed/seed_data.py >/dev/null

python scripts/demo_rollback.py "$@"
