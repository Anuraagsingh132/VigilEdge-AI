import io
import csv
from typing import List

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import func

from database import get_db
from models import Session, FatigueEvent

router = APIRouter(prefix="/reports", tags=["Reports"])

@router.get("/summary")
def report_summary(db: DBSession = Depends(get_db)):
    total_sessions = db.query(func.count(Session.id)).scalar() or 0
    total_events = db.query(func.count(FatigueEvent.id)).scalar() or 0
    micro_sleeps = db.query(func.count(FatigueEvent.id)).filter(FatigueEvent.event_type == "micro_sleep").scalar() or 0
    yawns = db.query(func.count(FatigueEvent.id)).filter(FatigueEvent.event_type == "yawn").scalar() or 0
    critical_events = db.query(func.count(FatigueEvent.id)).filter(FatigueEvent.severity == "critical").scalar() or 0

    severity_counts = db.query(FatigueEvent.severity, func.count(FatigueEvent.id)).group_by(FatigueEvent.severity).all()
    severity_map = {s: c for s, c in severity_counts}

    recent = db.query(FatigueEvent).order_by(FatigueEvent.timestamp.desc()).limit(50).all()

    return {
        "total_sessions": total_sessions,
        "total_events": total_events,
        "micro_sleeps": micro_sleeps,
        "yawns": yawns,
        "critical_events": critical_events,
        "severity_breakdown": severity_map,
        "recent_events": [e.to_dict() for e in recent],
    }

@router.get("/export")
def export_csv(db: DBSession = Depends(get_db)):
    """Export all events as a CSV file."""
    events = db.query(FatigueEvent).order_by(FatigueEvent.timestamp.desc()).all()
    
    stream = io.StringIO()
    writer = csv.writer(stream)
    
    # Header
    writer.writerow([
        "Event ID", "Session ID", "Event Type", "Severity", 
        "EAR Value", "MAR Value", "Fatigue Score", "Timestamp"
    ])
    
    # Data rows
    for e in events:
        writer.writerow([
            e.id, 
            e.session_id, 
            e.event_type, 
            e.severity,
            e.ear_value, 
            e.mar_value, 
            e.fatigue_score, 
            e.timestamp.isoformat() if e.timestamp else ""
        ])
    
    stream.seek(0)
    
    response = StreamingResponse(iter([stream.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=vigiledge_events.csv"
    return response
