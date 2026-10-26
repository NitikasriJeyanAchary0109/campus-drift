"""add collection_mode and shadow_mode to devices

Revision ID: b7c8d9e0f1a2
Revises: a12b34c56d78
Create Date: 2026-10-26 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, None] = 'a12b34c56d78'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('devices', sa.Column('collection_mode', sa.String(length=16), nullable=False, server_default='SSH_POLL'))
    op.add_column('devices', sa.Column('shadow_mode', sa.Boolean(), nullable=False, server_default=sa.text('false')))


def downgrade() -> None:
    op.drop_column('devices', 'shadow_mode')
    op.drop_column('devices', 'collection_mode')
