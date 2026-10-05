"""add source and external_ref to change_tickets

Revision ID: a12b34c56d78
Revises: f92a10be51ac
Create Date: 2026-10-05 15:05:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a12b34c56d78'
down_revision: Union[str, None] = 'f92a10be51ac'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('change_tickets', sa.Column('source', sa.String(length=32), nullable=False, server_default='internal'))
    op.add_column('change_tickets', sa.Column('external_ref', sa.String(length=64), nullable=True))
    op.create_index(op.f('ix_change_tickets_external_ref'), 'change_tickets', ['external_ref'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_change_tickets_external_ref'), table_name='change_tickets')
    op.drop_column('change_tickets', 'external_ref')
    op.drop_column('change_tickets', 'source')
