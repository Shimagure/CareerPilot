"""Create global jobs mirror table

Revision ID: 1a2b3c4d5e6f
Revises: 0a7f3c2d15e8
Create Date: 2026-09-10
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1a2b3c4d5e6f'
down_revision: str = '0a7f3c2d15e8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'jobs',
        sa.Column('stable_id', sa.String(64), nullable=False),
        sa.Column('source_key', sa.String(255), nullable=True),
        sa.Column('portal', sa.String(100), nullable=True),
        sa.Column('processing_state', sa.String(32), nullable=False),
        sa.Column('status', sa.String(64), nullable=True),
        sa.Column('first_seen', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_verified', sa.DateTime(timezone=True), nullable=True),
        sa.Column('blocked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('blocked_reason', sa.String(100), nullable=True),
        sa.Column('changed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_active_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('company', sa.String(500), nullable=False),
        sa.Column('location', sa.String(500), nullable=True),
        sa.Column('salary', sa.String(255), nullable=True),
        sa.Column('url', sa.String(2000), nullable=False),
        sa.Column('arrangement', sa.String(32), nullable=True),
        sa.Column('work_mode', sa.String(64), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('fingerprint', sa.String(64), nullable=True),
        sa.Column('previous_fingerprint', sa.String(64), nullable=True),
        sa.Column('changed_fields', sa.Text(), nullable=True),
        sa.Column('rank', sa.Integer(), nullable=True),
        sa.Column('rank_score', sa.Integer(), nullable=True),
        sa.Column('rank_verdict', sa.String(100), nullable=True),
        sa.Column('rank_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('fit', sa.String(32), nullable=True),
        sa.Column('priority_tier', sa.Integer(), nullable=True),
        sa.Column('strengths', sa.Text(), nullable=True),
        sa.Column('gaps', sa.Text(), nullable=True),
        sa.Column('evaluation', sa.Text(), nullable=True),
        sa.Column('source_updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('synced_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('sync_run_id', sa.String(64), nullable=True),
        sa.Column('source_schema_version', sa.String(32), nullable=True),
        sa.Column('is_tombstone', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.PrimaryKeyConstraint('stable_id'),
    )
    op.create_index('ix_jobs_processing_state', 'jobs', ['processing_state'])
    op.create_index('ix_jobs_processing_state_rank', 'jobs', ['processing_state', 'rank_score'])
    op.create_index('ix_jobs_portal', 'jobs', ['portal'])
    op.create_index('ix_jobs_last_active_at', 'jobs', ['last_active_at'])
    op.create_index('ix_jobs_sync_run_id', 'jobs', ['sync_run_id'])


def downgrade() -> None:
    op.drop_index('ix_jobs_sync_run_id', table_name='jobs')
    op.drop_index('ix_jobs_last_active_at', table_name='jobs')
    op.drop_index('ix_jobs_portal', table_name='jobs')
    op.drop_index('ix_jobs_processing_state_rank', table_name='jobs')
    op.drop_index('ix_jobs_processing_state', table_name='jobs')
    op.drop_table('jobs')