#!/usr/bin/env bash
# Restore a dump made by db_backup.sh. DESTRUCTIVE: replaces the contents of the target database.
#   ./scripts/db_restore.sh backups/campus_drift_20261104T120000Z.sql.gz
# Pass RESTORE_CONFIRM=yes to skip the prompt (for automation).
set -euo pipefail
FILE="${1:?usage: db_restore.sh <backup.sql.gz>}"
CONTAINER="${PG_CONTAINER:-campus_drift_postgres}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-campus_drift}"
[ -f "$FILE" ] || { echo "no such file: $FILE" >&2; exit 1; }
gzip -t "$FILE"
if [ "${RESTORE_CONFIRM:-}" != "yes" ]; then
  read -r -p "This replaces database '$DB_NAME' in container '$CONTAINER'. Type 'restore' to continue: " ans
  [ "$ans" = "restore" ] || { echo "aborted"; exit 1; }
fi
gunzip -c "$FILE" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q
echo "restored $FILE into $DB_NAME"
