"""widen drift_details change_type to varchar 32

Revision ID: f92a10be51ac
Revises: e81f23ab45cd
Create Date: 2026-10-05 12:15:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f92a10be51ac'
down_revision: Union[str, None] = 'e81f23ab45cd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('drift_details', 'change_type',
                    existing_type=sa.String(length=16),
                    type_=sa.String(length=32),
                    existing_nullable=False)


def downgrade() -> None:
    op.alter_column('drift_details', 'change_type',
                    existing_type=sa.String(length=32),
                    type_=sa.String(length=16),
                    existing_nullable=False)
