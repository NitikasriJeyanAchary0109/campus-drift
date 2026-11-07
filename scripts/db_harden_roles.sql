-- Run once as the database owner (superuser), after `alembic upgrade head`.
-- The application then connects as campus_app: it can read and write the working tables, append to the audit trail, and nothing else.
-- It cannot disable a trigger, truncate, drop or alter a table, or rewrite the audit trail, approvals or backups.
--   psql -U postgres -d campus_drift -v app_password="'<strong password>'" -f scripts/db_harden_roles.sql
-- Then set DATABASE_URL=postgresql+psycopg2://campus_app:<password>@<host>:5432/campus_drift for the API, worker and beat.

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'campus_app') THEN
        CREATE ROLE campus_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
END $$;

ALTER ROLE campus_app PASSWORD :app_password;

GRANT CONNECT ON DATABASE campus_drift TO campus_app;
GRANT USAGE ON SCHEMA public TO campus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO campus_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO campus_app;

-- append-only tables: no UPDATE, DELETE or TRUNCATE for the application, whatever the triggers say
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, approvals, backups FROM campus_app;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM campus_app;
