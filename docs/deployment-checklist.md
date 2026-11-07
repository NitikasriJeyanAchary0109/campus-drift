# Deployment checklist

Everything below was checked on the Review 3 code. Numbers marked *measured* come from the commands shown; nothing is estimated
unless it says so.

## 1. Hardware footprint (measured, 2026-11-05)

Host: Apple Silicon Mac running Docker Desktop (5.8 GiB VM). Idle stack after a few API calls, three simulated SSH devices.

| Component | Memory | How measured |
|---|---:|---|
| PostgreSQL 16 (container) | 99 MiB | `docker stats --no-stream campus_drift_postgres` |
| Redis 7 (container) | 11 MiB | `docker stats --no-stream campus_drift_redis` |
| FastAPI / uvicorn (1 process) | 107 MB RSS | `ps -o rss` after `/api/health`, `/api/dashboard/summary`, `/api/devices`, `/api/drift`, `/api/alerts` |
| Celery worker (parent + 2 children) | 143 MB RSS | `ps -o rss` summed over the process group (shared pages are counted more than once, so this is an upper bound) |
| 3 simulated switches / routers | 2 MiB each | `docker stats` |
| **Total without Celery Beat** | **about 365 MB** | sum of the rows above |

Not measured: Celery Beat (a single small process, expected to be similar to an idle worker parent), the Vite dev server, and a
free-tier cloud run. The earlier "under 400 MB" claim is therefore consistent with the measurement only when Beat is included
and the frontend is served as static files. `docker-compose.prod.yml` caps the containers at 256 MB (API, worker), 128 MB (Beat),
256 MB (Postgres) and 96 MB (Redis).

## 2. Secrets (enforced at startup)

With `ENVIRONMENT=production` the application refuses to start (`backend/app/core/config.py`, tests in
`backend/tests/unit/test_config_security.py`) unless:

- [ ] `SECRET_KEY` is set, not the committed default, at least 32 characters (signs JWTs)
- [ ] `VAULT_KEY` is set, at least 32 characters and different from `SECRET_KEY` (encrypts device credentials; Fernet = AES-128-CBC + HMAC-SHA256)
- [ ] `ITSM_WEBHOOK_SECRET` is not the committed default
- [ ] `DEBUG=false`
- [ ] `SSH_STRICT_HOST_KEYS=true` and `SSH_KNOWN_HOSTS_FILE` set (device host keys are verified; see section 2a)
- [ ] `ALLOW_TEST_HOOKS=false` (the default in production: no `?force_fail=` on apply, no simulator reset command sent to devices)
- [ ] `ITSM_REQUIRE_TIMESTAMP=true` (the default in production; the ITSM sender signs `<timestamp>.<body>`, see `docs/itsm-integration.md`)

Changing `VAULT_KEY` makes existing stored device credentials unreadable. Rotate by re-entering credentials, and keep the key
backed up separately from database dumps. Generate values with `python -c "import secrets; print(secrets.token_urlsafe(48))"`.

### 2a. Device host keys
Pin each device's key once, from a trusted network position, then keep the file read-only for the application user:

```bash
ssh-keyscan -p 22 10.10.2.10 >> /etc/campus_drift/known_hosts          # a device on another port is stored as [host]:port
```

An unknown or changed key refuses the connection (the collection or remediation reports it as an SSH failure). A key that legitimately
changed after a device replacement is re-pinned by an administrator; it is never accepted automatically.

### 2b. Database accounts and the audit trail
`scripts/db_harden_roles.sql` creates an application role that cannot disable triggers, truncate or alter tables. Run the migrations as the
owner and the application as that role. The chain makes tampering visible even for the owner: `GET /api/audit/verify` (Admin) recomputes it
and names the first bad row; call it from a monitor. Point the `campus_drift.audit` logger at syslog or a collector that the database
administrators cannot write to, so a copy of every entry also exists outside the database.

## 3. Stack

- [ ] Use `docker-compose.prod.yml` (no bind mounts, Postgres and Redis not published, mandatory secrets, memory caps):
  `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`
- [ ] Run migrations once: `docker compose -f docker-compose.prod.yml exec backend alembic upgrade head`
- [ ] Build the frontend (`cd frontend && npm run build`) and serve `dist/` from a web server that terminates TLS and proxies `/api` to the backend
- [ ] Set `CORS_ORIGINS` to the real site origin only
- [ ] Management VLAN only: the API, Postgres, Redis and the workers must reach network devices over SSH, nothing else should

## 4. Backup and restore

```bash
./scripts/db_backup.sh backups                      # verified .sql.gz dump (tested against the running database)
RESTORE_CONFIRM=yes ./scripts/db_restore.sh backups/<file>.sql.gz   # destructive; prompts unless confirmed
```

- [ ] Schedule the backup (cron / systemd timer) and copy dumps off the host
- [ ] Back up `VAULT_KEY` separately
- [ ] Rehearse one restore into a scratch database before relying on it (the restore script was syntax-checked, not run against production data)

## 5. Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request: ruff + 267 offline unit tests, frontend lint +
type-check + build + component tests, and the 30 integration tests against Postgres, Redis and the simulated devices.
The workflow file has not been executed on GitHub yet; the same commands pass locally.

## 6. Open items

- [ ] Free-tier cloud deployment has not been tried
- [ ] gNMI / OpenConfig ingest is still a roadmap stub (`HTTP 501`)
- [ ] Stakeholder validation sessions have not been run (`docs/validation/results.md` is empty by design)

## Queues and sign-in protection
- Run at least one worker that consumes both queues: `celery -A app.core.celery_app.celery_app worker -Q celery,remediation` (the compose files already do). Without it, polling and queued remediation never run.
- `REMEDIATION_USE_QUEUE` defaults to on in production: apply and rollback return `202` and a task id; `GET /api/remediation/jobs/{id}` reports the result. Check `/api/health` shows `redis: connected`.
- Keep Redis private to the compose network: it carries job payloads and the sign-in throttle counters.
- Sign-in throttle: `LOGIN_MAX_FAILURES` (5) wrong passwords per username and address lock sign-in for `LOGIN_FAILURE_WINDOW_SECONDS` (900). Failures appear in the audit trail as `LOGIN_FAILED`.
