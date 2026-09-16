"""Add salary_period to search_preferences

Revision ID: 0a7f3c2d15e8
Revises: 84c84cccd871
Create Date: 2026-09-08

Makes salary units explicit so a monthly figure is never mistaken for
annual. Existing rows backfill to 'monthly' (the product convention).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0a7f3c2d15e8'
down_revision: Union[str, None] = '84c84cccd871'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'search_preferences',
        sa.Column('salary_period', sa.String(length=20), server_default='monthly', nullable=False),
    )


def downgrade() -> None:
    op.drop_column('search_preferences', 'salary_period')