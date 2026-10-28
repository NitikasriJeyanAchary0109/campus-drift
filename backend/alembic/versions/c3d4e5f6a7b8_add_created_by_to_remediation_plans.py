"""add created_by to remediation_plans (four-eyes enforcement)

Revision ID: c3d4e5f6a7b8
Revises: b7c8d9e0f1a2
Create Date: 2026-10-28 09:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('remediation_plans', sa.Column('created_by', sa.Uuid(), nullable=True))
    op.create_foreign_key('fk_remediation_plans_created_by_users', 'remediation_plans', 'users', ['created_by'], ['id'])


def downgrade() -> None:
    op.drop_constraint('fk_remediation_plans_created_by_users', 'remediation_plans', type_='foreignkey')
    op.drop_column('remediation_plans', 'created_by')
