"""PostgreSQL-only guarantees of the migration d4e5f6a7b8c9: hash chain, write-once tables, TRUNCATE refusal."""

import pytest
from app.models.audit import AuditLog
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def test_audit_rows_are_chained_and_the_chain_verifies(db_session):
    for i in range(3):
        db_session.add(AuditLog(user_id=None, action=f"CHAIN_TEST_{i}", target_type="test", after_state={"i": i}))
    db_session.commit()
    # every row points at the row written just before it (other writers may add rows in between, so look at the table itself)
    rows = db_session.execute(text(
        "SELECT seq, prev_hash, lag(row_hash) OVER (ORDER BY seq) AS before_hash, row_hash FROM audit_logs "
        "WHERE row_hash IS NOT NULL ORDER BY seq DESC LIMIT 25")).all()
    assert len(rows) >= 3 and all(r.row_hash and len(r.row_hash) == 64 for r in rows)
    assert all(r.prev_hash == r.before_hash for r in rows[:-1])
    verdict = db_session.execute(text("SELECT ok, first_bad_seq FROM audit_verify_chain()")).one()
    assert verdict.ok is True and verdict.first_bad_seq is None


def test_even_a_superuser_who_disables_the_trigger_leaves_a_broken_chain(db_session):
    db_session.add(AuditLog(user_id=None, action="CHAIN_TAMPER_TEST", target_type="test"))
    db_session.commit()
    conn = db_session.get_bind().connect()
    tx = conn.begin()
    try:
        conn.execute(text("ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_immutable"))
        conn.execute(text("UPDATE audit_logs SET action = 'EDITED' WHERE action = 'CHAIN_TAMPER_TEST'"))
        verdict = conn.execute(text("SELECT ok, first_bad_seq FROM audit_verify_chain()")).one()
        assert verdict.ok is False and verdict.first_bad_seq is not None
    finally:
        tx.rollback()                                           # nothing of this is kept
        conn.close()


@pytest.mark.parametrize("statement", [
    "TRUNCATE audit_logs",
    "DELETE FROM audit_logs WHERE action = 'CHAIN_TEST_0'",
    "UPDATE audit_logs SET action = 'X' WHERE action = 'CHAIN_TEST_0'",
])
def test_audit_trail_refuses_update_delete_and_truncate(db_session, statement):
    with pytest.raises(DBAPIError, match="immutable"):
        db_session.execute(text(statement))
    db_session.rollback()


@pytest.mark.parametrize("statement", [
    "UPDATE approvals SET decision = 'APPROVED'",
    "DELETE FROM approvals",
    "TRUNCATE approvals",
    "UPDATE backups SET config_blob = 'x'",
    "DELETE FROM backups",
])
def test_approvals_and_backups_are_write_once(db_session, statement):
    with pytest.raises(DBAPIError, match="write-once"):
        db_session.execute(text(statement))
    db_session.rollback()


def test_a_plans_commands_cannot_be_changed_after_it_is_written(db_session):
    plan_id = db_session.execute(text("SELECT id FROM remediation_plans LIMIT 1")).scalar()
    if plan_id is None:
        pytest.skip("no remediation plan in this database")
    with pytest.raises(DBAPIError, match="cannot be changed"):
        db_session.execute(text("UPDATE remediation_plans SET proposed_commands = ARRAY['username x secret y'] WHERE id = :i"), {"i": plan_id})
    db_session.rollback()
    # status changes are still allowed (the workflow needs them): same row, commands untouched
    db_session.execute(text("UPDATE remediation_plans SET status = status WHERE id = :i"), {"i": plan_id})
    db_session.rollback()
