from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession

from database import get_db
from models import Session, FatigueEvent
from schemas import EventCreate, EventOut

router = APIRouter(prefix="/events", tags=["Events"])

@router.post("", response_model=EventOut, status_code=201)
def create_event(body: EventCreate, db: DBSession = Depends(get_db)):
    session_db = db.query(Session).filter(Session.id == body.session_id).first()
    if not session_db:
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

# We also move the session events getter here under an alternate path, 
# or keep it in sessions. For clarity, we'll expose a cross-router dependency in sessions, 
# but for now let's just place it here as /v1/events/session/{id} or similar.
# The original path was /api/sessions/{session_id}/events, so we'll 
# define it in sessions.py in the next step, or bind it directly to the app. 
# We'll export the function to `main.py` directly or bind it to the `sessions` router.
