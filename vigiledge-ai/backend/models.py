"""SQLAlchemy ORM models for VigilEdge AI."""

import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from database import Base


class Session(Base):
    """Represents a single driving/monitoring session."""
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    started_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    ended_at = Column(DateTime, nullable=True)
    status = Column(String(20), default="active", nullable=False)  # active | ended
    avg_ear = Column(Float, nullable=True)
    avg_mar = Column(Float, nullable=True)

    events = relationship("FatigueEvent", back_populates="session", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "status": self.status,
            "avg_ear": self.avg_ear,
            "avg_mar": self.avg_mar,
            "event_count": len(self.events) if self.events else 0,
        }


class FatigueEvent(Base):
    """Records an individual fatigue incident (micro-sleep or yawn)."""
    __tablename__ = "fatigue_events"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    event_type = Column(String(30), nullable=False)  # micro_sleep | yawn | distraction
    severity = Column(String(10), nullable=False)     # low | medium | high | critical
    ear_value = Column(Float, nullable=True)
    mar_value = Column(Float, nullable=True)
    fatigue_score = Column(Float, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    notes = Column(Text, nullable=True)

    session = relationship("Session", back_populates="events")

    def to_dict(self):
        return {
            "id": self.id,
            "session_id": self.session_id,
            "event_type": self.event_type,
            "severity": self.severity,
            "ear_value": self.ear_value,
            "mar_value": self.mar_value,
            "fatigue_score": self.fatigue_score,
            "duration_ms": self.duration_ms,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "notes": self.notes,
        }
