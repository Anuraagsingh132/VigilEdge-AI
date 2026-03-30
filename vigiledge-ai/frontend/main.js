/* ═══════════════════════════════════════════════════════════════
   VigilEdge AI — Core Application Logic
   ═══════════════════════════════════════════════════════════════
   Handles: Webcam capture, MediaPipe Face Mesh, EAR/MAR
   calculation, fatigue state machine, audio alerts, backend API.
   ═══════════════════════════════════════════════════════════════ */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const CONFIG = {
  API_BASE: window.location.origin + "/api",

  // Calibration
  CALIBRATION_DURATION_MS: 3000,
  CALIBRATION_SAMPLE_INTERVAL: 100,

  // Thresholds (relative to calibrated baseline)
  EAR_THRESHOLD_RATIO: 0.72,   // 72% of resting EAR → eyes closing
  MAR_THRESHOLD_RATIO: 1.6,    // 160% of resting MAR → yawning

  // Fatigue State Machine
  FATIGUE_INCREMENT: 3.0,       // per drowsy frame
  FATIGUE_DECREMENT: 1.5,       // per alert frame
  FATIGUE_MAX: 100,
  ALERT_THRESHOLD: 75,          // trigger alert at 75% fatigue
  YAWN_HOLD_FRAMES: 12,         // consecutive frames to confirm a yawn

  // MediaPipe Face Mesh landmarks
  LEFT_EYE: [362, 385, 387, 263, 373, 380],
  RIGHT_EYE: [33, 160, 158, 133, 153, 144],
  MOUTH: [13, 14, 78, 308],     // top, bottom, left-corner, right-corner
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const STATE = {
  phase: "idle",          // idle | calibrating | active | alert | stopped
  sessionId: null,
  sessionStartTime: null,
  sessionTimer: null,

  // Calibration
  calibrationSamples: { ear: [], mar: [] },
  calibrationTimer: null,

  // Baseline
  baselineEAR: null,
  baselineMAR: null,
  thresholdEAR: null,
  thresholdMAR: null,

  // Fatigue
  fatigueScore: 0,
  yawnFrameCount: 0,
  alertActive: false,
  lastAlertTime: 0,

  // Stats
  alertCount: 0,
  yawnCount: 0,
  earHistory: [],

  // FPS
  frameCount: 0,
  lastFpsTime: performance.now(),
  currentFps: 0,

  // Audio
  alarmAudio: null,
  alarmPlaying: false,
};

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------
const DOM = {
  loadingScreen: document.getElementById("loading-screen"),
  app: document.getElementById("app"),
  webcam: document.getElementById("webcam"),
  canvas: document.getElementById("overlay-canvas"),
  videoContainer: document.getElementById("video-container"),

  systemStatus: document.getElementById("system-status"),
  calibrationOverlay: document.getElementById("calibration-overlay"),
  calibrationFill: document.getElementById("calibration-fill"),
  alertOverlay: document.getElementById("alert-overlay"),
  alertTitle: document.getElementById("alert-title"),
  alertSub: document.getElementById("alert-sub"),

  earValue: document.getElementById("ear-value"),
  marValue: document.getElementById("mar-value"),
  fpsValue: document.getElementById("fps-value"),

  fatigueFill: document.getElementById("fatigue-fill"),
  fatiguePct: document.getElementById("fatigue-pct"),

  btnStart: document.getElementById("btn-start"),
  btnStop: document.getElementById("btn-stop"),

  statSessionTime: document.getElementById("stat-session-time"),
  statAlerts: document.getElementById("stat-alerts"),
  statYawns: document.getElementById("stat-yawns"),
  statScore: document.getElementById("stat-score"),

  eventList: document.getElementById("event-list"),
  eventCountBadge: document.getElementById("event-count-badge"),

  baselineEAR: document.getElementById("baseline-ear"),
  baselineMAR: document.getElementById("baseline-mar"),
  thresholdEAR: document.getElementById("threshold-ear"),
  thresholdMAR: document.getElementById("threshold-mar"),
};

const canvasCtx = DOM.canvas.getContext("2d");

// ---------------------------------------------------------------------------
// Utility: Euclidean distance
// ---------------------------------------------------------------------------
function dist(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// EAR Calculation (Eye Aspect Ratio)
// ---------------------------------------------------------------------------
function calculateEAR(landmarks, eyeIndices) {
  const [p1, p2, p3, p4, p5, p6] = eyeIndices.map(i => landmarks[i]);
  const vertical1 = dist(p2, p6);
  const vertical2 = dist(p3, p5);
  const horizontal = dist(p1, p4);
  return (vertical1 + vertical2) / (2.0 * horizontal + 1e-6);
}

// ---------------------------------------------------------------------------
// MAR Calculation (Mouth Aspect Ratio)
// ---------------------------------------------------------------------------
function calculateMAR(landmarks) {
  const top = landmarks[CONFIG.MOUTH[0]];
  const bottom = landmarks[CONFIG.MOUTH[1]];
  const left = landmarks[CONFIG.MOUTH[2]];
  const right = landmarks[CONFIG.MOUTH[3]];
  const vertical = dist(top, bottom);
  const horizontal = dist(left, right);
  return vertical / (horizontal + 1e-6);
}

// ---------------------------------------------------------------------------
// System Status
// ---------------------------------------------------------------------------
function setSystemStatus(status, text) {
  DOM.systemStatus.className = `status-badge status-${status}`;
  DOM.systemStatus.innerHTML = `<span class="status-dot"></span>${text}`;
}

// ---------------------------------------------------------------------------
// Fatigue Bar
// ---------------------------------------------------------------------------
function updateFatigueBar() {
  const pct = Math.min(Math.max(STATE.fatigueScore, 0), CONFIG.FATIGUE_MAX);
  DOM.fatigueFill.style.width = pct + "%";
  DOM.fatiguePct.textContent = Math.round(pct) + "%";

  DOM.fatigueFill.classList.remove("level-ok", "level-warning", "level-danger", "level-critical");
  if (pct < 30) DOM.fatigueFill.classList.add("level-ok");
  else if (pct < 55) DOM.fatigueFill.classList.add("level-warning");
  else if (pct < 75) DOM.fatigueFill.classList.add("level-danger");
  else DOM.fatigueFill.classList.add("level-critical");
}

// ---------------------------------------------------------------------------
// Event Log
// ---------------------------------------------------------------------------
function addEventToLog(eventType, severity, details) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour12: false });

  const item = document.createElement("div");
  item.className = "event-item";
  item.innerHTML = `
    <span class="event-dot ${eventType}"></span>
    <div class="event-info">
      <div class="event-type">${eventType.replace("_", "-")}</div>
      <div class="event-meta">${timeStr} — ${details}</div>
    </div>
    <span class="event-severity ${severity}">${severity}</span>
  `;

  // Remove empty state
  const emptyState = DOM.eventList.querySelector(".event-empty");
  if (emptyState) emptyState.remove();

  DOM.eventList.prepend(item);

  const totalEvents = DOM.eventList.querySelectorAll(".event-item").length;
  DOM.eventCountBadge.textContent = totalEvents;
}

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------
async function apiPost(path, body) {
  try {
    const resp = await fetch(CONFIG.API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await resp.json();
  } catch (e) {
    console.warn("API call failed:", path, e.message);
    return null;
  }
}

async function apiPatch(path, body) {
  try {
    const resp = await fetch(CONFIG.API_BASE + path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await resp.json();
  } catch (e) {
    console.warn("API call failed:", path, e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Audio Alarm
// ---------------------------------------------------------------------------
function initAudioAlarm() {
  // Generate a simple oscillating alarm using Web Audio API
  STATE.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playAlarm() {
  if (STATE.alarmPlaying) return;
  STATE.alarmPlaying = true;

  const ctx = STATE.audioCtx;
  if (!ctx) return;

  // Create a pulsing alarm sound
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = "square";
  osc1.frequency.value = 880;
  osc2.type = "square";
  osc2.frequency.value = 660;

  gain.gain.value = 0.15;

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);

  // Alternate between tones
  const now = ctx.currentTime;
  osc1.frequency.setValueAtTime(880, now);
  osc1.frequency.setValueAtTime(660, now + 0.3);
  osc1.frequency.setValueAtTime(880, now + 0.6);
  osc1.frequency.setValueAtTime(660, now + 0.9);

  osc1.start(now);
  osc2.start(now);

  STATE.alarmOsc1 = osc1;
  STATE.alarmOsc2 = osc2;
  STATE.alarmGain = gain;

  // Loop the alarm by restarting
  STATE.alarmInterval = setInterval(() => {
    if (!STATE.alarmPlaying) return;
    const t = ctx.currentTime;
    osc1.frequency.setValueAtTime(880, t);
    osc1.frequency.setValueAtTime(660, t + 0.3);
  }, 600);
}

function stopAlarm() {
  if (!STATE.alarmPlaying) return;
  STATE.alarmPlaying = false;

  clearInterval(STATE.alarmInterval);
  try {
    STATE.alarmOsc1?.stop();
    STATE.alarmOsc2?.stop();
  } catch (e) { /* already stopped */ }
}

// ---------------------------------------------------------------------------
// Session Timer
// ---------------------------------------------------------------------------
function startSessionTimer() {
  STATE.sessionStartTime = Date.now();
  STATE.sessionTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - STATE.sessionStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const secs = String(elapsed % 60).padStart(2, "0");
    DOM.statSessionTime.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopSessionTimer() {
  clearInterval(STATE.sessionTimer);
}

// ---------------------------------------------------------------------------
// FPS Counter
// ---------------------------------------------------------------------------
function updateFPS() {
  STATE.frameCount++;
  const now = performance.now();
  if (now - STATE.lastFpsTime >= 1000) {
    STATE.currentFps = STATE.frameCount;
    STATE.frameCount = 0;
    STATE.lastFpsTime = now;
    DOM.fpsValue.textContent = STATE.currentFps;
  }
}

// ---------------------------------------------------------------------------
// Draw face mesh on canvas
// ---------------------------------------------------------------------------
function drawFaceMesh(landmarks, w, h) {
  canvasCtx.clearRect(0, 0, w, h);

  // Draw eye landmarks
  const allEyePoints = [...CONFIG.LEFT_EYE, ...CONFIG.RIGHT_EYE];
  canvasCtx.fillStyle = "rgba(99, 102, 241, 0.8)";
  for (const idx of allEyePoints) {
    const pt = landmarks[idx];
    canvasCtx.beginPath();
    canvasCtx.arc(pt.x * w, pt.y * h, 2.5, 0, 2 * Math.PI);
    canvasCtx.fill();
  }

  // Draw eye contours
  canvasCtx.strokeStyle = "rgba(129, 140, 248, 0.5)";
  canvasCtx.lineWidth = 1.5;
  for (const eyeIndices of [CONFIG.LEFT_EYE, CONFIG.RIGHT_EYE]) {
    canvasCtx.beginPath();
    for (let i = 0; i < eyeIndices.length; i++) {
      const pt = landmarks[eyeIndices[i]];
      if (i === 0) canvasCtx.moveTo(pt.x * w, pt.y * h);
      else canvasCtx.lineTo(pt.x * w, pt.y * h);
    }
    canvasCtx.closePath();
    canvasCtx.stroke();
  }

  // Draw mouth landmarks
  canvasCtx.fillStyle = "rgba(245, 158, 11, 0.7)";
  for (const idx of CONFIG.MOUTH) {
    const pt = landmarks[idx];
    canvasCtx.beginPath();
    canvasCtx.arc(pt.x * w, pt.y * h, 2.5, 0, 2 * Math.PI);
    canvasCtx.fill();
  }
}

// ---------------------------------------------------------------------------
// MediaPipe Face Mesh — onResults callback
// ---------------------------------------------------------------------------
function onFaceMeshResults(results) {
  if (STATE.phase === "idle" || STATE.phase === "stopped") return;

  const w = DOM.canvas.width;
  const h = DOM.canvas.height;

  updateFPS();

  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    canvasCtx.clearRect(0, 0, w, h);
    return;
  }

  const landmarks = results.multiFaceLandmarks[0];

  // Calculate EAR (average of both eyes)
  const leftEAR = calculateEAR(landmarks, CONFIG.LEFT_EYE);
  const rightEAR = calculateEAR(landmarks, CONFIG.RIGHT_EYE);
  const ear = (leftEAR + rightEAR) / 2;

  // Calculate MAR
  const mar = calculateMAR(landmarks);

  // Draw face mesh
  drawFaceMesh(landmarks, w, h);

  // Update telemetry
  DOM.earValue.textContent = ear.toFixed(3);
  DOM.marValue.textContent = mar.toFixed(3);

  // ── CALIBRATION PHASE ──
  if (STATE.phase === "calibrating") {
    STATE.calibrationSamples.ear.push(ear);
    STATE.calibrationSamples.mar.push(mar);
    return;
  }

  // ── ACTIVE MONITORING PHASE ──
  if (STATE.phase === "active" || STATE.phase === "alert") {
    STATE.earHistory.push(ear);

    const eyesClosed = ear < STATE.thresholdEAR;
    const mouthOpen = mar > STATE.thresholdMAR;

    // Fatigue score update
    if (eyesClosed) {
      STATE.fatigueScore = Math.min(STATE.fatigueScore + CONFIG.FATIGUE_INCREMENT, CONFIG.FATIGUE_MAX);
    } else {
      STATE.fatigueScore = Math.max(STATE.fatigueScore - CONFIG.FATIGUE_DECREMENT, 0);
    }

    // Yawn detection
    if (mouthOpen) {
      STATE.yawnFrameCount++;
      if (STATE.yawnFrameCount === CONFIG.YAWN_HOLD_FRAMES) {
        STATE.yawnCount++;
        DOM.statYawns.textContent = STATE.yawnCount;
        addEventToLog("yawn", "medium", `MAR: ${mar.toFixed(3)}`);

        // Log to backend
        apiPost("/events", {
          session_id: STATE.sessionId,
          event_type: "yawn",
          severity: "medium",
          ear_value: ear,
          mar_value: mar,
          fatigue_score: STATE.fatigueScore,
          duration_ms: Math.round(STATE.yawnFrameCount * (1000 / 30)),
        });
      }
    } else {
      STATE.yawnFrameCount = 0;
    }

    // Alert logic
    if (STATE.fatigueScore >= CONFIG.ALERT_THRESHOLD && !STATE.alertActive) {
      triggerAlert(ear, mar);
    } else if (STATE.fatigueScore < CONFIG.ALERT_THRESHOLD * 0.5 && STATE.alertActive) {
      clearAlert();
    }

    // Update average score
    if (STATE.earHistory.length > 0) {
      const avg = STATE.earHistory.reduce((a, b) => a + b, 0) / STATE.earHistory.length;
      DOM.statScore.textContent = avg.toFixed(3);
    }

    updateFatigueBar();
  }
}

// ---------------------------------------------------------------------------
// Alert Management
// ---------------------------------------------------------------------------
function triggerAlert(ear, mar) {
  STATE.alertActive = true;
  STATE.phase = "alert";
  STATE.alertCount++;
  DOM.statAlerts.textContent = STATE.alertCount;

  const severity = STATE.fatigueScore >= 90 ? "critical" : "high";
  addEventToLog("micro_sleep", severity, `EAR: ${ear.toFixed(3)} | Score: ${Math.round(STATE.fatigueScore)}%`);

  // UI
  setSystemStatus("alert", "DROWSINESS ALERT");
  DOM.alertOverlay.classList.remove("hidden");
  DOM.videoContainer.classList.add("alert-flash");

  // Audio
  playAlarm();

  // Log to backend
  apiPost("/events", {
    session_id: STATE.sessionId,
    event_type: "micro_sleep",
    severity: severity,
    ear_value: ear,
    mar_value: mar,
    fatigue_score: STATE.fatigueScore,
    duration_ms: null,
  });

  STATE.lastAlertTime = Date.now();
}

function clearAlert() {
  STATE.alertActive = false;
  STATE.phase = "active";

  DOM.alertOverlay.classList.add("hidden");
  DOM.videoContainer.classList.remove("alert-flash");
  setSystemStatus("active", "MONITORING");
  stopAlarm();
}

// ---------------------------------------------------------------------------
// Calibration Process
// ---------------------------------------------------------------------------
async function startCalibration() {
  STATE.phase = "calibrating";
  STATE.calibrationSamples = { ear: [], mar: [] };

  setSystemStatus("calibrating", "CALIBRATING");
  DOM.calibrationOverlay.classList.remove("hidden");

  // Animate calibration bar
  const startTime = Date.now();
  const duration = CONFIG.CALIBRATION_DURATION_MS;

  const progressInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const pct = Math.min((elapsed / duration) * 100, 100);
    DOM.calibrationFill.style.width = pct + "%";
  }, 50);

  return new Promise(resolve => {
    setTimeout(() => {
      clearInterval(progressInterval);
      DOM.calibrationFill.style.width = "100%";

      // Calculate baselines
      const earSamples = STATE.calibrationSamples.ear;
      const marSamples = STATE.calibrationSamples.mar;

      if (earSamples.length < 5) {
        console.warn("Not enough calibration samples, using defaults.");
        STATE.baselineEAR = 0.25;
        STATE.baselineMAR = 0.3;
      } else {
        // Use median to resist outliers
        earSamples.sort((a, b) => a - b);
        marSamples.sort((a, b) => a - b);
        STATE.baselineEAR = earSamples[Math.floor(earSamples.length / 2)];
        STATE.baselineMAR = marSamples[Math.floor(marSamples.length / 2)];
      }

      STATE.thresholdEAR = STATE.baselineEAR * CONFIG.EAR_THRESHOLD_RATIO;
      STATE.thresholdMAR = STATE.baselineMAR * CONFIG.MAR_THRESHOLD_RATIO;

      // Update UI
      DOM.baselineEAR.textContent = STATE.baselineEAR.toFixed(3);
      DOM.baselineMAR.textContent = STATE.baselineMAR.toFixed(3);
      DOM.thresholdEAR.textContent = STATE.thresholdEAR.toFixed(3);
      DOM.thresholdMAR.textContent = STATE.thresholdMAR.toFixed(3);

      // Hide calibration overlay
      DOM.calibrationOverlay.classList.add("hidden");

      resolve();
    }, duration);
  });
}

// ---------------------------------------------------------------------------
// Start Monitoring
// ---------------------------------------------------------------------------
async function startMonitoring() {
  // Create backend session
  const sessionData = await apiPost("/sessions", {});
  STATE.sessionId = sessionData?.id || null;

  // Init audio
  initAudioAlarm();

  // Run calibration
  await startCalibration();

  // Start active monitoring
  STATE.phase = "active";
  STATE.fatigueScore = 0;
  STATE.alertCount = 0;
  STATE.yawnCount = 0;
  STATE.earHistory = [];
  STATE.yawnFrameCount = 0;
  STATE.alertActive = false;
  DOM.statAlerts.textContent = "0";
  DOM.statYawns.textContent = "0";
  DOM.statScore.textContent = "—";

  setSystemStatus("active", "MONITORING");
  startSessionTimer();

  DOM.btnStart.classList.add("hidden");
  DOM.btnStop.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Stop Monitoring
// ---------------------------------------------------------------------------
async function stopMonitoring() {
  STATE.phase = "stopped";
  clearAlert();
  stopAlarm();
  stopSessionTimer();

  setSystemStatus("stopped", "SESSION ENDED");
  DOM.btnStop.classList.add("hidden");
  DOM.btnStart.classList.remove("hidden");

  // End session on backend
  if (STATE.sessionId) {
    const avgEar = STATE.earHistory.length > 0
      ? STATE.earHistory.reduce((a, b) => a + b, 0) / STATE.earHistory.length
      : null;
    await apiPatch(`/sessions/${STATE.sessionId}/end`, {
      avg_ear: avgEar,
      avg_mar: STATE.baselineMAR,
    });
  }

  canvasCtx.clearRect(0, 0, DOM.canvas.width, DOM.canvas.height);
}

// ---------------------------------------------------------------------------
// Initialize MediaPipe Face Mesh
// ---------------------------------------------------------------------------
let faceMesh;
let camera;

async function initFaceMesh() {
  faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
  });

  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  faceMesh.onResults(onFaceMeshResults);
}

// ---------------------------------------------------------------------------
// Initialize Camera
// ---------------------------------------------------------------------------
async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, facingMode: "user" },
    audio: false,
  });
  DOM.webcam.srcObject = stream;

  // Wait for video metadata
  await new Promise(resolve => {
    DOM.webcam.onloadedmetadata = () => {
      DOM.canvas.width = DOM.webcam.videoWidth;
      DOM.canvas.height = DOM.webcam.videoHeight;
      resolve();
    };
  });

  // Use MediaPipe Camera utility
  camera = new Camera(DOM.webcam, {
    onFrame: async () => {
      await faceMesh.send({ image: DOM.webcam });
    },
    width: 1280,
    height: 720,
  });
  camera.start();
}

// ---------------------------------------------------------------------------
// Boot Sequence
// ---------------------------------------------------------------------------
async function boot() {
  try {
    await initFaceMesh();
    await initCamera();

    // Dismiss loading screen
    setTimeout(() => {
      DOM.loadingScreen.classList.add("fade-out");
      DOM.app.classList.remove("hidden");
      setSystemStatus("initializing", "READY — PRESS START");
    }, 2800);
  } catch (err) {
    console.error("Boot failed:", err);
    DOM.loadingScreen.querySelector(".loader-sub").textContent =
      "Error: " + (err.message || "Camera access denied");
    DOM.loadingScreen.querySelector(".loader-bar-fill").style.background = "var(--red)";
  }
}

// ---------------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------------
DOM.btnStart.addEventListener("click", startMonitoring);
DOM.btnStop.addEventListener("click", stopMonitoring);

// Start the application
boot();
