"""
Job schemas.
"""

from pydantic import BaseModel


class JobOut(BaseModel):
    id: str
    type: str
    status: str
    progress: int
    logs: list
    payload: dict
