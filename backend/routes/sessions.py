import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session as DBSession

from database import get_db
from models import Session
from schemas import SessionCreate, SessionEnd, SessionOut

router = APIRouter(prefix="/sessions", tags=["Sessions"])

@router.post("", response_model=SessionOut, status_code=201)
def create_session(db: DBSession = Depends(get_db)):
    session_db = Session()
    db.add(session_db)
    db.commit()
    db.refresh(session_db)
    return session_db.to_dict()

@router.get("", response_model=List[SessionOut])
def list_sessions(limit: int = Query(20, ge=1, le=100), db: DBSession = Depends(get_db)):
    sessions = db.query(Session).order_by(Session.started_at.desc()).limit(limit).all()
    return [s.to_dict() for s in sessions]

@router.get("/{session_id}", response_model=SessionOut)
def get_session(session_id: int, db: DBSession = Depends(get_db)):
    session_db = db.query(Session).filter(Session.id == session_id).first()
    if not session_db:
        raise HTTPException(status_code=404, detail="Session not found")
    return session_db.to_dict()

@router.patch("/{session_id}/end", response_model=SessionOut)
def end_session(session_id: int, body: SessionEnd, db: DBSession = Depends(get_db)):
    session_db = db.query(Session).filter(Session.id == session_id).first()
    if not session_db:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session_db.ended_at = datetime.datetime.utcnow()
    session_db.status = "ended"
    if body.avg_ear is not None:
        session_db.avg_ear = body.avg_ear
    if body.avg_mar is not None:
        session_db.avg_mar = body.avg_mar
        
    db.commit()
    db.refresh(session_db)
    return session_db.to_dict()
