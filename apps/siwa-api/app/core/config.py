"""
Central configuration for the FastAPI backend.

Loads environment variables via Pydantic Settings.
Keeps the app local-first by default. External connectors
can be enabled later through config flags.
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite:///./siwa.db"
    JWT_SECRET: str = "960f606566a924124722833b88746e4e33ebf33066301e4176b11ac9fc6951ca"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 120

    # Root folder where Siwa stores cached/prepared data, previews, etc.
    SIWA_HOME: str = str(Path(__file__).resolve().parents[3] / "siwa-data")

    # External data directory for user-mounted datasets
    EXTERNAL_DATA_PATH: str = ""
    # EXTERNAL_DATA_PATH: str = ""

    # Used for CORS; locked to localhost by default
    FRONTEND_ORIGIN: str = "http://localhost:3000"

    # Default HuggingFace cache directory for local models
    HUGGINGFACE_CACHE_DIR: str = str(
        Path.home() / ".cache" / "huggingface" / "hub"
    )


settings = Settings()
