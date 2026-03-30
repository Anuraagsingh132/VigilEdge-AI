import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from main import app
from database import Base, get_db

# Use an in-memory SQLite database for tests
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_vigiledge.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

@pytest.fixture(autouse=True)
def run_around_tests():
    # Setup: clean database before each test
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    # Teardown

def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_create_session():
    response = client.post("/api/sessions")
    assert response.status_code == 201
    data = response.json()
    assert "id" in data
    assert data["status"] == "active"

def test_create_event():
    # 1. Create session
    sess_res = client.post("/api/sessions")
    sess_id = sess_res.json()["id"]

    # 2. Add event to session
    event_payload = {
        "session_id": sess_id,
        "event_type": "yawn",
        "severity": "medium",
        "ear_value": 0.28,
        "mar_value": 0.85,
        "fatigue_score": 10.5
    }
    ev_res = client.post("/api/events", json=event_payload)
    assert ev_res.status_code == 201
    ev_data = ev_res.json()
    assert ev_data["event_type"] == "yawn"
    assert ev_data["session_id"] == sess_id

def test_reports_summary():
    # Create test data
    sess = client.post("/api/sessions").json()
    sess_id = sess["id"]
    client.post("/api/events", json={
        "session_id": sess_id,
        "event_type": "micro_sleep",
        "severity": "high",
        "ear_value": 0.15,
        "mar_value": 0.2,
        "fatigue_score": 85
    })
    
    res = client.get("/api/reports/summary")
    assert res.status_code == 200
    data = res.json()
    assert data["total_sessions"] == 1
    assert data["total_events"] == 1
    assert data["micro_sleeps"] == 1
    assert data["yawns"] == 0

def test_csv_export():
    sess = client.post("/api/sessions").json()
    client.post("/api/events", json={
        "session_id": sess["id"],
        "event_type": "distraction",
        "severity": "low"
    })
    
    res = client.get("/api/reports/export")
    assert res.status_code == 200
    assert res.headers["content-type"] == "text/csv; charset=utf-8"
    assert "attachment; filename=" in res.headers["content-disposition"]
    text = res.text
    assert "Event ID,Session ID,Event Type" in text  # headers present
    assert "distraction,low" in text                 # row present
