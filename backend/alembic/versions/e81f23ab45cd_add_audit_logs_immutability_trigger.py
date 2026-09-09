"""add audit_logs immutability trigger

Revision ID: e81f23ab45cd
Revises: c708d9c9e82c
Create Date: 2026-09-09 15:40:00.000000

"""
from typing import Sequence, Union
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e81f23ab45cd'
down_revision: Union[str, None] = 'c708d9c9e82c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create PostgreSQL trigger function and trigger to deny UPDATE and DELETE on audit_logs (§13)
    op.execute("""
    CREATE OR REPLACE FUNCTION trg_audit_logs_immutable_func()
    RETURNS TRIGGER AS $$
    BEGIN
        RAISE EXCEPTION 'audit_logs table is strictly immutable: % operations are prohibited', TG_OP;
    END;
    $$ LANGUAGE plpgsql;
    """)

    op.execute("""
    CREATE TRIGGER trg_audit_logs_immutable
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION trg_audit_logs_immutable_func();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;")
    op.execute("DROP FUNCTION IF EXISTS trg_audit_logs_immutable_func();")
