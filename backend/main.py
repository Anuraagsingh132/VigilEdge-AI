"""VigilEdge AI — FastAPI Backend Application."""

import pathlib
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

from database import engine, Base
from routes import sessions, events, reports
from config import settings

# ---------------------------------------------------------------------------
# Create all tables on startup
# ---------------------------------------------------------------------------
Base.metadata.create_all(bind=engine)

# Path to the frontend directory (sibling to backend/)
FRONTEND_DIR = pathlib.Path(__file__).resolve().parent.parent / "frontend"

# ---------------------------------------------------------------------------
# App Initialization
# ---------------------------------------------------------------------------
app = FastAPI(
    title="VigilEdge AI API",
    version="1.0.0",
    description="Backend API for the VigilEdge driver fatigue monitoring system.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Include API Routers
# ---------------------------------------------------------------------------
app.include_router(sessions.router, prefix="/api")
app.include_router(events.router, prefix="/api")
app.include_router(reports.router, prefix="/api")

# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "service": "VigilEdge AI API", "version": "1.0.0"}

# ---------------------------------------------------------------------------
# Static HTML Pages (served AFTER API routes to avoid conflicts)
# ---------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

@app.get("/", response_class=HTMLResponse)
def serve_index():
    return (FRONTEND_DIR / "index.html").read_text()

@app.get("/dashboard", response_class=HTMLResponse)
def serve_dashboard():
    return (FRONTEND_DIR / "dashboard.html").read_text()
