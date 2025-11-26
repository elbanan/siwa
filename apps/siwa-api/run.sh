#!/usr/bin/env bash
# Simple local dev runner (no Docker).
export $(cat .env | xargs)
uvicorn app.main:app --reload --port 8000
