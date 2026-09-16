"""Create missing job_sources table and normalize legacy enum data

Revision ID: 43aa7a6043ac
Revises: 2b3c4d5e6f78
Create Date: 2026-09-12 15:03:36.427878

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '43aa7a6043ac'
down_revision: Union[str, None] = '2b3c4d5e6f78'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### Data normalization for legacy enum values ###
    # Normalize users.status: ACTIVE->active, INACTIVE->inactive, SUSPENDED->suspended
    op.execute("UPDATE users SET status = 'active' WHERE status = 'ACTIVE'")
    op.execute("UPDATE users SET status = 'inactive' WHERE status = 'INACTIVE'")
    op.execute("UPDATE users SET status = 'suspended' WHERE status = 'SUSPENDED'")

    # Normalize resumes.status: UPLOADED->uploaded, PARSING->parsing, PARSED->parsed,
    # FAILED->failed, ACTIVE->active, ARCHIVED->archived
    op.execute("UPDATE resumes SET status = 'uploaded' WHERE status = 'UPLOADED'")
    op.execute("UPDATE resumes SET status = 'parsing' WHERE status = 'PARSING'")
    op.execute("UPDATE resumes SET status = 'parsed' WHERE status = 'PARSED'")
    op.execute("UPDATE resumes SET status = 'failed' WHERE status = 'FAILED'")
    op.execute("UPDATE resumes SET status = 'active' WHERE status = 'ACTIVE'")
    op.execute("UPDATE resumes SET status = 'archived' WHERE status = 'ARCHIVED'")

    # Normalize search_runs.status: QUEUED->queued, RUNNING->running, COMPLETED->completed,
    # FAILED->failed, CANCELLED->cancelled
    op.execute("UPDATE search_runs SET status = 'queued' WHERE status = 'QUEUED'")
    op.execute("UPDATE search_runs SET status = 'running' WHERE status = 'RUNNING'")
    op.execute("UPDATE search_runs SET status = 'completed' WHERE status = 'COMPLETED'")
    op.execute("UPDATE search_runs SET status = 'failed' WHERE status = 'FAILED'")
    op.execute("UPDATE search_runs SET status = 'cancelled' WHERE status = 'CANCELLED'")

    # Normalize user_jobs.status if any legacy uppercase values exist
    op.execute("UPDATE user_jobs SET status = 'saved' WHERE status = 'SAVED'")
    op.execute("UPDATE user_jobs SET status = 'viewed' WHERE status = 'VIEWED'")
    op.execute("UPDATE user_jobs SET status = 'interested' WHERE status = 'INTERESTED'")
    op.execute("UPDATE user_jobs SET status = 'dismissed' WHERE status = 'DISMISSED'")
    op.execute("UPDATE user_jobs SET status = 'analyzed' WHERE status = 'ANALYZED'")

    # Normalize applications.status if any legacy uppercase values exist
    op.execute("UPDATE applications SET status = 'draft' WHERE status = 'DRAFT'")
    op.execute("UPDATE applications SET status = 'submitted' WHERE status = 'SUBMITTED'")
    op.execute("UPDATE applications SET status = 'under_review' WHERE status = 'UNDER_REVIEW'")
    op.execute("UPDATE applications SET status = 'interview' WHERE status = 'INTERVIEW'")
    op.execute("UPDATE applications SET status = 'offer' WHERE status = 'OFFER'")
    op.execute("UPDATE applications SET status = 'rejected' WHERE status = 'REJECTED'")
    op.execute("UPDATE applications SET status = 'withdrawn' WHERE status = 'WITHDRAWN'")
    op.execute("UPDATE applications SET status = 'accepted' WHERE status = 'ACCEPTED'")

    # Note: users.role is already stored as 'user'/'admin' (values), no change needed

    # ### Create job_sources table if missing ###
    # Use raw SQL to check table existence for SQLite compatibility
    conn = op.get_bind()

    # Check if table exists using SQLite's sqlite_master
    result = conn.execute(sa.text(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='job_sources'"
    )).fetchone()

    if result is None:
        op.create_table(
            'job_sources',
            sa.Column('id', sa.UUID(as_uuid=False), nullable=False),
            sa.Column('name', sa.String(length=100), nullable=False, unique=True),
            sa.Column('display_name', sa.String(length=150), nullable=False),
            sa.Column('base_url', sa.String(length=500), nullable=False),
            sa.Column('domain', sa.String(length=255), nullable=False),
            sa.Column('source_type', sa.Enum(
                'direct_employer', 'job_board', 'government_portal', 'custom_feed',
                name='jobsourcetype', native_enum=False
            ), nullable=False, server_default='job_board'),
            sa.Column('status', sa.Enum(
                'discovered', 'analyzing', 'ready_for_review', 'approved', 'enabled', 'disabled',
                name='jobsourceStatus', native_enum=False
            ), nullable=False, server_default='discovered'),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('analysis_data', sa.JSON(), nullable=True),
            sa.Column('adapter_name', sa.String(length=100), nullable=True),
            sa.Column('health_status', sa.String(length=50), nullable=True, server_default='insufficient_evidence'),
            sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_by_user_id', sa.UUID(as_uuid=False), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), onupdate=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
            sa.PrimaryKeyConstraint('id'),
        )
        # Create indexes separately (no index=True on columns to avoid conflicts)
        op.create_index('ix_job_sources_name', 'job_sources', ['name'], unique=True)
        op.create_index('ix_job_sources_status', 'job_sources', ['status'])
        op.create_index('ix_job_sources_enabled', 'job_sources', ['enabled'])
        op.create_index('ix_job_sources_domain', 'job_sources', ['domain'])
        op.create_index('ix_job_sources_source_type', 'job_sources', ['source_type'])
        op.create_index('ix_job_sources_created_by_user_id', 'job_sources', ['created_by_user_id'])


def downgrade() -> None:
    # Drop job_sources table if it was created by this migration
    conn = op.get_bind()

    result = conn.execute(sa.text(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='job_sources'"
    )).fetchone()

    if result is not None:
        op.drop_index('ix_job_sources_created_by_user_id', table_name='job_sources')
        op.drop_index('ix_job_sources_source_type', table_name='job_sources')
        op.drop_index('ix_job_sources_domain', table_name='job_sources')
        op.drop_index('ix_job_sources_enabled', table_name='job_sources')
        op.drop_index('ix_job_sources_status', table_name='job_sources')
        op.drop_index('ix_job_sources_name', table_name='job_sources')
        op.drop_table('job_sources')

    # Note: Data normalization is not easily reversible without backup data.
    # The downgrade intentionally does not revert enum value changes.
    # If reversal is needed, restore from backup.