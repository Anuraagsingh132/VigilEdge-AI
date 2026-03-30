from typing import Optional
from pydantic import BaseModel, Field

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
