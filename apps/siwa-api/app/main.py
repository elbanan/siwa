"""
FastAPI application entrypoint.

Responsibilities:
- Create DB tables on startup for easy local dev.
- Configure CORS to local frontend only.
- Register routers.
"""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.db.session import engine
from app.db.base import Base
from app.api.routes import (
    admin_router,
    auth_router,
    browse_router,
    datasets_router,
    evaluations_router,
    jobs_router,
    annotations_classification_router,
    annotations_captioning_router,
    annotations_detection_router,
    annotations_grounding_router,
    annotations_text_classification_router,
    models_router,
    generate_router,
    generation_tasks_router,
)


def ensure_siwa_home():
    """Create local Siwa home directory if missing."""
    os.makedirs(settings.SIWA_HOME, exist_ok=True)
    os.makedirs(os.path.join(settings.SIWA_HOME, "datasets"), exist_ok=True)
    os.makedirs(os.path.join(settings.SIWA_HOME, "runs"), exist_ok=True)
    os.makedirs(os.path.join(settings.SIWA_HOME, "models"), exist_ok=True)


app = FastAPI(title="Siwa Local API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


from uuid import uuid4
from app.models.user import User
from app.core.security import hash_password
from app.db.session import SessionLocal

@app.on_event("startup")
def on_startup():
    ensure_siwa_home()
    # For v1 local dev we auto-create tables.
    # Later we will replace this with Alembic migrations.
    Base.metadata.create_all(bind=engine)

    # Seed default user if none exists
    db = SessionLocal()
    try:
        if not db.query(User).first():
            print("Creating default user: admin@local.dev / password")
            user = User(
                id=str(uuid4()),
                email="admin@local.dev",
                name="Siwa Admin",
                password_hash=hash_password("password"),
                role="owner",
                active=True,
            )
            db.add(user)
            db.commit()
    finally:
        db.close()



app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(browse_router)
app.include_router(datasets_router)
app.include_router(evaluations_router)
app.include_router(jobs_router)
app.include_router(annotations_classification_router)
app.include_router(annotations_captioning_router)
app.include_router(annotations_detection_router)
app.include_router(annotations_grounding_router)
app.include_router(annotations_text_classification_router)
app.include_router(models_router)
app.include_router(generate_router)
app.include_router(generation_tasks_router)



@app.get("/health")
def health():
    return {"ok": True}
