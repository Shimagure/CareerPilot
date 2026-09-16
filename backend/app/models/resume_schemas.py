"""Pydantic schemas for the resume endpoint."""
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class ResumeResponse(BaseModel):
    """Public resume metadata for the authenticated user.

    Exposes only what the frontend needs. The storage key, filesystem path,
    and any storage internals are intentionally absent.
    """
    id: str
    filename: str = Field(validation_alias="original_filename")
    content_type: str = Field(validation_alias="file_type")
    file_size: int
    status: str
    uploaded_at: datetime

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)