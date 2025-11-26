"""
User schemas returned to the frontend.
"""

from pydantic import BaseModel, EmailStr


class UserOut(BaseModel):
    id: str
    email: EmailStr
    name: str
    role: str
    active: bool = True
    can_access_eval: bool = False
