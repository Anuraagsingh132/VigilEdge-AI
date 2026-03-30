"""VigilEdge AI — FastAPI Backend Application."""

import datetime
import pathlib
from typing import Optional, List

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import func

from database import engine, get_db, Base
from models import Session, FatigueEvent

# Path to the frontend directory (sibling to backend/)
FRONTEND_DIR = pathlib.Path(__file__).resolve().parent.parent / "frontend"

# ---------------------------------------------------------------------------
# Create all tables on startup
# ---------------------------------------------------------------------------
Base.metadata.create_all(bind=engine)

# ---------------------------------------------------------------------------
# App
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

# Mount the frontend directory as static files
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------

class SessionCreate(BaseModel):
    pass  # no fields needed; only starts the clock


class SessionEnd(BaseModel):
    avg_ear: Optional[float] = None
    avg_mar: Optional[float] = None


class EventCreate(BaseModel):
    session_id: int
    event_type: str = Field(..., pattern="^(micro_sleep|yawn|distraction)$")
    severity: str = Field(..., pattern="^(low|medium|high|critical)$")
    ear_value: Optional[float] = None
    mar_value: Optional[float] = None
    fatigue_score: Optional[float] = None
    duration_ms: Optional[int] = None
    notes: Optional[str] = None


class EventOut(BaseModel):
    id: int
    session_id: int
    event_type: str
    severity: str
    ear_value: Optional[float]
    mar_value: Optional[float]
    fatigue_score: Optional[float]
    duration_ms: Optional[int]
    timestamp: str
    notes: Optional[str]


class SessionOut(BaseModel):
    id: int
    started_at: str
    ended_at: Optional[str]
    status: str
    avg_ear: Optional[float]
    avg_mar: Optional[float]
    event_count: int


# ---------------------------------------------------------------------------
# Routes — Sessions
# ---------------------------------------------------------------------------

@app.post("/api/sessions", response_model=SessionOut, status_code=201)
def create_session(db: DBSession = Depends(get_db)):
    """Start a new monitoring session."""
    session = Session()
    db.add(session)
    db.commit()
    db.refresh(session)
    return session.to_dict()


@app.get("/api/sessions", response_model=List[SessionOut])
def list_sessions(
    limit: int = Query(20, ge=1, le=100),
    db: DBSession = Depends(get_db),
):
    """Return recent sessions, newest first."""
    sessions = (
        db.query(Session)
        .order_by(Session.started_at.desc())
        .limit(limit)
        .all()
    )
    return [s.to_dict() for s in sessions]


@app.get("/api/sessions/{session_id}", response_model=SessionOut)
def get_session(session_id: int, db: DBSession = Depends(get_db)):
    """Get a single session by ID."""
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.to_dict()


@app.patch("/api/sessions/{session_id}/end", response_model=SessionOut)
def end_session(session_id: int, body: SessionEnd, db: DBSession = Depends(get_db)):
    """End a monitoring session."""
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.ended_at = datetime.datetime.utcnow()
    session.status = "ended"
    if body.avg_ear is not None:
        session.avg_ear = body.avg_ear
    if body.avg_mar is not None:
        session.avg_mar = body.avg_mar
    db.commit()
    db.refresh(session)
    return session.to_dict()


# ---------------------------------------------------------------------------
# Routes — Events
# ---------------------------------------------------------------------------

@app.post("/api/events", response_model=EventOut, status_code=201)
def create_event(body: EventCreate, db: DBSession = Depends(get_db)):
    """Log a fatigue event."""
    session = db.query(Session).filter(Session.id == body.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    event = FatigueEvent(
        session_id=body.session_id,
        event_type=body.event_type,
        severity=body.severity,
        ear_value=body.ear_value,
        mar_value=body.mar_value,
        fatigue_score=body.fatigue_score,
        duration_ms=body.duration_ms,
        notes=body.notes,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event.to_dict()


@app.get("/api/sessions/{session_id}/events", response_model=List[EventOut])
def list_events(session_id: int, db: DBSession = Depends(get_db)):
    """Get all events for a session."""
    events = (
        db.query(FatigueEvent)
        .filter(FatigueEvent.session_id == session_id)
        .order_by(FatigueEvent.timestamp.asc())
        .all()
    )
    return [e.to_dict() for e in events]


# ---------------------------------------------------------------------------
# Routes — Reports / Aggregates
# ---------------------------------------------------------------------------

@app.get("/api/reports/summary")
def report_summary(db: DBSession = Depends(get_db)):
    """Return aggregated statistics across all sessions."""
    total_sessions = db.query(func.count(Session.id)).scalar() or 0
    total_events = db.query(func.count(FatigueEvent.id)).scalar() or 0
    micro_sleeps = (
        db.query(func.count(FatigueEvent.id))
        .filter(FatigueEvent.event_type == "micro_sleep")
        .scalar()
        or 0
    )
    yawns = (
        db.query(func.count(FatigueEvent.id))
        .filter(FatigueEvent.event_type == "yawn")
        .scalar()
        or 0
    )
    critical_events = (
        db.query(func.count(FatigueEvent.id))
        .filter(FatigueEvent.severity == "critical")
        .scalar()
        or 0
    )

    # Severity breakdown
    severity_counts = (
        db.query(FatigueEvent.severity, func.count(FatigueEvent.id))
        .group_by(FatigueEvent.severity)
        .all()
    )
    severity_map = {s: c for s, c in severity_counts}

    # Recent events timeline (last 50)
    recent = (
        db.query(FatigueEvent)
        .order_by(FatigueEvent.timestamp.desc())
        .limit(50)
        .all()
    )

    return {
        "total_sessions": total_sessions,
        "total_events": total_events,
        "micro_sleeps": micro_sleeps,
        "yawns": yawns,
        "critical_events": critical_events,
        "severity_breakdown": severity_map,
        "recent_events": [e.to_dict() for e in recent],
    }


# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "VigilEdge AI API", "version": "1.0.0"}


# ---------------------------------------------------------------------------
# HTML Pages (served AFTER API routes to avoid conflicts)
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
def serve_index():
    return (FRONTEND_DIR / "index.html").read_text()


@app.get("/dashboard", response_class=HTMLResponse)
def serve_dashboard():
    return (FRONTEND_DIR / "dashboard.html").read_text()
