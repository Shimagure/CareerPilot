"""Add User.name, User.role, and job_sources table

Revision ID: 2b3c4d5e6f78
Revises: 1a2b3c4d5e6f
Create Date: 2026-09-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2b3c4d5e6f78'
down_revision: Union[str, None] = '1a2b3c4d5e6f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### User.name and User.role ###
    op.add_column(
        'users',
        sa.Column('name', sa.String(length=255), nullable=False, server_default=''),
    )
    op.add_column(
        'users',
        sa.Column('role', sa.Enum('user', 'admin', name='userrole'), nullable=False, server_default='user'),
    )
    # Remove server_default after backfill (skip for SQLite which doesn't support ALTER COLUMN ... DROP DEFAULT)
    from alembic.runtime.environment import get_context
    context = get_context()
    if context is not None and context.connection is not None:
        dialect = context.connection.dialect.name
        if dialect != 'sqlite':
            op.alter_column('users', 'name', server_default=None)
            op.alter_column('users', 'role', server_default=None)

    # ### job_sources table ###
    op.create_table(
        'job_sources',
        sa.Column('id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False, unique=True),
        sa.Column('display_name', sa.String(length=150), nullable=False),
        sa.Column('base_url', sa.String(length=500), nullable=False),
        sa.Column('domain', sa.String(length=255), nullable=False, index=True),
        sa.Column('source_type', sa.Enum('direct_employer', 'job_board', 'government_portal', 'custom_feed', name='jobsourcetype'), nullable=False, server_default='job_board'),
        sa.Column('status', sa.Enum('discovered', 'analyzing', 'ready_for_review', 'approved', 'enabled', 'disabled', name='jobsourceStatus'), nullable=False, server_default='discovered', index=True),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='false', index=True),
        sa.Column('analysis_data', sa.JSON(), nullable=True),
        sa.Column('adapter_name', sa.String(length=100), nullable=True),
        sa.Column('health_status', sa.String(length=50), nullable=True, server_default='insufficient_evidence'),
        sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by_user_id', sa.UUID(as_uuid=False), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), onupdate=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_job_sources_name', 'job_sources', ['name'], unique=True)
    op.create_index('ix_job_sources_status', 'job_sources', ['status'])
    op.create_index('ix_job_sources_enabled', 'job_sources', ['enabled'])
    op.create_index('ix_job_sources_domain', 'job_sources', ['domain'])
    op.create_index('ix_job_sources_source_type', 'job_sources', ['source_type'])
    op.create_index('ix_job_sources_created_by_user_id', 'job_sources', ['created_by_user_id'])


def downgrade() -> None:
    op.drop_index('ix_job_sources_created_by_user_id', table_name='job_sources')
    op.drop_index('ix_job_sources_source_type', table_name='job_sources')
    op.drop_index('ix_job_sources_domain', table_name='job_sources')
    op.drop_index('ix_job_sources_enabled', table_name='job_sources')
    op.drop_index('ix_job_sources_status', table_name='job_sources')
    op.drop_index('ix_job_sources_name', table_name='job_sources')
    op.drop_table('job_sources')
    op.drop_column('users', 'role')
    op.drop_column('users', 'name')