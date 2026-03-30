/* ═══════════════════════════════════════════════════════════════
   VigilEdge AI — Dashboard Logic
   ═══════════════════════════════════════════════════════════════ */

const API_BASE = window.location.origin + "/api";

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------
const DOM = {
  totalSessions: document.getElementById("dash-total-sessions"),
  totalEvents: document.getElementById("dash-total-events"),
  microSleeps: document.getElementById("dash-micro-sleeps"),
  yawns: document.getElementById("dash-yawns"),
  critical: document.getElementById("dash-critical"),

  sevCritical: document.getElementById("sev-critical"),
  sevHigh: document.getElementById("sev-high"),
  sevMedium: document.getElementById("sev-medium"),
  sevLow: document.getElementById("sev-low"),
  sevCriticalCount: document.getElementById("sev-critical-count"),
  sevHighCount: document.getElementById("sev-high-count"),
  sevMediumCount: document.getElementById("sev-medium-count"),
  sevLowCount: document.getElementById("sev-low-count"),

  sessionsList: document.getElementById("sessions-list"),
  eventTimeline: document.getElementById("event-timeline"),
  timelineCount: document.getElementById("timeline-count"),
};

// ---------------------------------------------------------------------------
// Fetch Data
// ---------------------------------------------------------------------------
async function fetchSummary() {
  try {
    const resp = await fetch(`${API_BASE}/reports/summary`);
    return await resp.json();
  } catch (e) {
    console.warn("Failed to fetch summary:", e);
    return null;
  }
}

async function fetchSessions() {
  try {
    const resp = await fetch(`${API_BASE}/sessions?limit=20`);
    return await resp.json();
  } catch (e) {
    console.warn("Failed to fetch sessions:", e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Render Summary
// ---------------------------------------------------------------------------
function renderSummary(data) {
  if (!data) return;

  DOM.totalSessions.textContent = data.total_sessions;
  DOM.totalEvents.textContent = data.total_events;
  DOM.microSleeps.textContent = data.micro_sleeps;
  DOM.yawns.textContent = data.yawns;
  DOM.critical.textContent = data.critical_events;

  // Severity bars
  const breakdown = data.severity_breakdown || {};
  const total = data.total_events || 1;

  const sevs = {
    critical: breakdown.critical || 0,
    high: breakdown.high || 0,
    medium: breakdown.medium || 0,
    low: breakdown.low || 0,
  };

  for (const [key, count] of Object.entries(sevs)) {
    const pct = Math.round((count / total) * 100);
    document.getElementById(`sev-${key}`).style.width = pct + "%";
    document.getElementById(`sev-${key}-count`).textContent = count;
  }

  // Event timeline
  if (data.recent_events && data.recent_events.length > 0) {
    DOM.timelineCount.textContent = data.recent_events.length;
    DOM.eventTimeline.innerHTML = data.recent_events.map(evt => {
      const ts = new Date(evt.timestamp);
      const timeStr = ts.toLocaleTimeString("en-US", { hour12: false });
      const dateStr = ts.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const detail = [];
      if (evt.ear_value != null) detail.push(`EAR: ${evt.ear_value.toFixed(3)}`);
      if (evt.mar_value != null) detail.push(`MAR: ${evt.mar_value.toFixed(3)}`);

      return `
        <div class="timeline-row">
          <span class="timeline-time">${dateStr} ${timeStr}</span>
          <span class="timeline-type">
            <span class="timeline-type-dot ${evt.event_type}"></span>
            ${evt.event_type.replace("_", "-")}
          </span>
          <span class="timeline-detail">${detail.join(" | ")}</span>
          <span class="timeline-score">${evt.fatigue_score != null ? Math.round(evt.fatigue_score) + "%" : "—"}</span>
          <span class="event-severity ${evt.severity}">${evt.severity}</span>
        </div>
      `;
    }).join("");
  }
}

// ---------------------------------------------------------------------------
// Render Sessions
// ---------------------------------------------------------------------------
function renderSessions(sessions) {
  if (!sessions || sessions.length === 0) return;

  DOM.sessionsList.innerHTML = sessions.map(s => {
    const started = new Date(s.started_at);
    const dateStr = started.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return `
      <div class="session-row">
        <div class="session-info">
          <span class="session-id">Session #${s.id}</span>
          <span class="session-time">${dateStr}</span>
        </div>
        <span class="session-events">${s.event_count} events</span>
        <span class="session-badge ${s.status}">${s.status}</span>
      </div>
    `;
  }).join("");
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function loadDashboard() {
  const [summary, sessions] = await Promise.all([fetchSummary(), fetchSessions()]);
  renderSummary(summary);
  renderSessions(sessions);
}

loadDashboard();

// Auto-refresh every 10 seconds
setInterval(loadDashboard, 10000);
