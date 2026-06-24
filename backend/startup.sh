#!/bin/bash
# Azure App Service startup script for the Grocery Finder backend.
# Azure injects PORT (default 8000); we bind uvicorn to it.
PORT="${PORT:-8000}"
exec uvicorn main:app --host 0.0.0.0 --port "$PORT"
