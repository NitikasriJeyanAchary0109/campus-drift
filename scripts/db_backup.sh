#!/usr/bin/env bash
# Dump the database to a compressed, timestamped file.
#   ./scripts/db_backup.sh [output_dir]            (default: ./backups)
# Env: PG_CONTAINER (default campus_drift_postgres), POSTGRES_USER, POSTGRES_DB.
# The credential vault is encrypted with VAULT_KEY (or SECRET_KEY in development): back that key up separately,
# a dump restored without it cannot decrypt device credentials.
set -euo pipefail
OUT_DIR="${1:-backups}"
CONTAINER="${PG_CONTAINER:-campus_drift_postgres}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-campus_drift}"
mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/${DB_NAME}_$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" --no-owner --clean --if-exists "$DB_NAME" | gzip > "$FILE"
gzip -t "$FILE"
echo "backup written and verified: $FILE ($(wc -c < "$FILE") bytes)"
