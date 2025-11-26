from typing import List, Optional, Literal

from pydantic import BaseModel, EmailStr, Field

from app.schemas.user import UserOut


class DatasetRef(BaseModel):
    id: str
    name: str


AccessLevel = Literal["view", "editor"]


class DatasetAccessOut(BaseModel):
    id: str
    name: str
    access_level: AccessLevel


class AdminUserOut(BaseModel):
    id: str
    email: EmailStr
    name: str
    role: str
    active: bool
    dataset_access: List[DatasetAccessOut]
    dataset_ids: List[str]
    group_ids: List[str]
    group_names: List[str]
    can_access_eval: bool


class AdminUserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str = ""
    role: str = "viewer"
    active: bool = True
    can_access_eval: bool = False


class AdminUserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    can_access_eval: Optional[bool] = None


class AdminUserPasswordUpdate(BaseModel):
    password: str


class AdminUserDatasetAssignment(BaseModel):
    dataset_id: str
    access_level: AccessLevel


class AdminUserDatasetsUpdate(BaseModel):
    assignments: List[AdminUserDatasetAssignment] = Field(default_factory=list)


class AdminGroupOut(BaseModel):
    id: str
    name: str
    description: str
    datasets: List[DatasetRef]
    members: List[UserOut]


class AdminGroupCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    dataset_ids: List[str] = []
    member_ids: List[str] = []


class AdminGroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    dataset_ids: Optional[List[str]] = None
    member_ids: Optional[List[str]] = None
