/* ═══════════════════════════════════════════════════════
   CoroVer Band — Web BLE Dashboard App
   ═══════════════════════════════════════════════════════ */

// ─── BLE Constants ───
const SERVICE_UUID      = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const TRIGGER_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const STATUS_CHAR_UUID  = 'beb5483f-36e1-4688-b7f5-ea07361b26a9';

const CMD = {
  IGN_ON: 0x01, IGN_OFF: 0x02,
  IDLING_START: 0x03, IDLING_STOP: 0x04,
  SPEED_START: 0x05, SPEED_STOP: 0x06,
  HARSH_BRAKE: 0x07, LEVEL_UP: 0x08,
};

const STATUS_ACK = 0x01;

// ─── Level Definitions ───
const LEVELS = [
  { name: 'Rookie',       min: 0,    color: '#9ca3af', cls: 'lvl-rookie' },
  { name: 'Beginner',     min: 100,  color: '#22c55e', cls: 'lvl-beginner' },
  { name: 'Intermediate', min: 300,  color: '#3b82f6', cls: 'lvl-intermediate' },
  { name: 'Advanced',     min: 600,  color: '#a855f7', cls: 'lvl-advanced' },
  { name: 'Expert',       min: 1000, color: '#f59e0b', cls: 'lvl-expert' },
  { name: 'Master',       min: 1500, color: '#ef4444', cls: 'lvl-master' },
];

// ─── Sample Leaderboard Drivers ───
const SAMPLE_DRIVERS = [
  { name: 'Rajesh Kumar',   score: 2150, km: 28450, penalties: 12, trend: 'up' },
  { name: 'Ananya Singh',   score: 1890, km: 24200, penalties: 18, trend: 'same' },
  { name: 'Vikram Reddy',   score: 1650, km: 21100, penalties: 15, trend: 'up' },
  { name: 'Meera Nair',     score: 1420, km: 18900, penalties: 22, trend: 'down' },
  { name: 'Arun Patel',     score: 1180, km: 15600, penalties: 25, trend: 'up' },
  { name: 'Sneha Gupta',    score: 950,  km: 12800, penalties: 28, trend: 'same' },
  { name: 'Karthik Menon',  score: 720,  km: 9500,  penalties: 35, trend: 'down' },
  { name: 'Priya Sharma',   score: 480,  km: 6200,  penalties: 42, trend: 'up' },
  { name: 'Deepak Verma',   score: 250,  km: 3100,  penalties: 50, trend: 'same' },
];

// ─── App State ───
const state = {
  connected: false,
  ignitionOn: false,
  isIdling: false,
  isSpeeding: false,
  isHarshBraking: false,
  idlingAcked: false,
  drivingStartTime: null,
  scoreTimer: null,
  kmTimer: null,
  sessionActive: false,
};

// ─── Persistent Data ───
let driverData = loadDriverData();
let logs = loadLogs();

// ─── BLE References ───
let bleDevice = null;
let triggerChar = null;
let statusChar = null;

// ─── DOM References ───
const $ = (id) => document.getElementById(id);
const btnConnect    = $('btnConnect');
const btnIgnition   = $('btnIgnition');
const btnIdling     = $('btnIdling');
const btnSpeeding   = $('btnSpeeding');
const btnHarshBrake = $('btnHarshBrake');
const btnLevelUp    = $('btnLevelUp');
const logBody       = $('logBody');
const logEmpty      = $('logEmpty');

// ═══════════════════════════════════════════════════════
// BLE Connection
// ═══════════════════════════════════════════════════════

async function connectBLE() {
  if (state.connected) { disconnectBLE(); return; }

  try {
    if (!navigator.bluetooth) {
      toast('Web Bluetooth not supported. Use Chrome on desktop/Android.', 'danger');
      return;
    }

    toast('Scanning for CoroVer Band...', 'info');
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ name: 'CoroVer-Band' }],
      optionalServices: [SERVICE_UUID],
    });

    bleDevice.addEventListener('gattserverdisconnected', onDisconnected);

    toast('Connecting...', 'info');
    const server = await bleDevice.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);

    triggerChar = await service.getCharacteristic(TRIGGER_CHAR_UUID);
    statusChar = await service.getCharacteristic(STATUS_CHAR_UUID);

    await statusChar.startNotifications();
    statusChar.addEventListener('characteristicvaluechanged', onStatusUpdate);

    state.connected = true;
    updateConnectionUI(true);
    addLog('🔗', 'Connected to CoroVer Band', 'success');
    toast('Connected to CoroVer Band!', 'success');
  } catch (err) {
    console.error('BLE Error:', err);
    if (err.name !== 'NotFoundError') {
      toast('Connection failed: ' + err.message, 'danger');
    }
  }
}

function disconnectBLE() {
  if (bleDevice && bleDevice.gatt.connected) {
    bleDevice.gatt.disconnect();
  }
}

function onDisconnected() {
  state.connected = false;
  updateConnectionUI(false);
  addLog('🔌', 'Disconnected from CoroVer Band', 'warning');
  toast('Device disconnected', 'warning');
  // Keep state as-is so the UI shows last known state
}

async function sendCommand(cmd) {
  if (!state.connected || !triggerChar) {
    toast('Not connected to device', 'danger');
    return false;
  }
  try {
    await triggerChar.writeValue(new Uint8Array([cmd]));
    return true;
  } catch (err) {
    console.error('Send error:', err);
    toast('Failed to send command', 'danger');
    return false;
  }
}

function onStatusUpdate(event) {
  const data = new DataView(event.target.value.buffer);
  if (data.byteLength < 6) return;

  const statusCode = data.getUint8(0);
  const ignition   = data.getUint8(1) === 1;
  const idling     = data.getUint8(2) === 1;
  const speeding   = data.getUint8(3) === 1;
  const harshBrake = data.getUint8(4) === 1;
  const idleAcked  = data.getUint8(5) === 1;

  // Sync state from device
  state.ignitionOn = ignition;
  state.isIdling = idling;
  state.isSpeeding = speeding;
  state.isHarshBraking = harshBrake;
  state.idlingAcked = idleAcked;

  if (statusCode === STATUS_ACK) {
    addLog('✅', 'Idling acknowledged (Boot button pressed)', 'success');
    toast('Idling acknowledged on device', 'success');
  }

  updateAllUI();
}

// ═══════════════════════════════════════════════════════
// Command Handlers with Intelligence
// ═══════════════════════════════════════════════════════

async function toggleIgnition() {
  if (state.ignitionOn) {
    // Turn OFF
    const sent = await sendCommand(CMD.IGN_OFF);
    if (sent) {
      // Stop all
      stopScoreTimer();
      stopKmTimer();
      state.ignitionOn = false;
      state.isIdling = false;
      state.isSpeeding = false;
      state.isHarshBraking = false;
      state.idlingAcked = false;
      if (state.sessionActive) {
        driverData.sessions++;
        state.sessionActive = false;
      }
      state.drivingStartTime = null;
      addLog('🔑', 'Ignition OFF — All systems deactivated', 'info');
      saveDriverData();
      updateAllUI();
    }
  } else {
    // Turn ON
    const sent = await sendCommand(CMD.IGN_ON);
    if (sent) {
      state.ignitionOn = true;
      state.drivingStartTime = Date.now();
      state.sessionActive = true;
      startScoreTimer();
      startKmTimer();
      addLog('🔑', 'Ignition ON — Systems active, startup melody playing', 'success');
      updateAllUI();
    }
  }
}

async function toggleIdling() {
  if (!state.ignitionOn) return;

  if (state.isIdling) {
    // Stop idling
    const sent = await sendCommand(CMD.IDLING_STOP);
    if (sent) {
      state.isIdling = false;
      state.idlingAcked = false;
      addLog('⏳', 'Idling stopped — Vehicle moving', 'info');
      updateAllUI();
    }
  } else {
    // Start idling — intelligence: stop speeding first
    if (state.isSpeeding) {
      await sendCommand(CMD.SPEED_STOP);
      state.isSpeeding = false;
      addLog('🏎️', 'Speeding auto-cleared (now idling)', 'info');
    }
    const sent = await sendCommand(CMD.IDLING_START);
    if (sent) {
      state.isIdling = true;
      state.idlingAcked = false;
      driverData.penalties.idling++;
      driverData.score = Math.max(0, driverData.score - 5);
      addLog('⏳', 'Idling detected — Vibration feedback activated', 'warning');
      saveDriverData();
      updateAllUI();
    }
  }
}

async function toggleSpeeding() {
  if (!state.ignitionOn) return;

  if (state.isSpeeding) {
    // Stop speeding
    const sent = await sendCommand(CMD.SPEED_STOP);
    if (sent) {
      state.isSpeeding = false;
      addLog('🏎️', 'Speed normalized — Buzzer deactivated', 'success');
      updateAllUI();
    }
  } else {
    // Start speeding — intelligence: stop idling first
    if (state.isIdling) {
      await sendCommand(CMD.IDLING_STOP);
      state.isIdling = false;
      state.idlingAcked = false;
      addLog('⏳', 'Idling auto-cleared (now moving/speeding)', 'info');
    }
    const sent = await sendCommand(CMD.SPEED_START);
    if (sent) {
      state.isSpeeding = true;
      driverData.penalties.speeding++;
      driverData.score = Math.max(0, driverData.score - 15);
      addLog('🏎️', 'Speeding detected — Buzzer feedback activated', 'danger');
      saveDriverData();
      updateAllUI();
    }
  }
}

async function triggerHarshBrake() {
  if (!state.ignitionOn) return;

  // Intelligence: if idling, clear it (braking implies movement)
  if (state.isIdling) {
    await sendCommand(CMD.IDLING_STOP);
    state.isIdling = false;
    state.idlingAcked = false;
    addLog('⏳', 'Idling auto-cleared (braking detected)', 'info');
  }

  const sent = await sendCommand(CMD.HARSH_BRAKE);
  if (sent) {
    state.isHarshBraking = true;
    driverData.penalties.harshBraking++;
    driverData.score = Math.max(0, driverData.score - 10);
    addLog('🛑', 'Harsh braking detected — Beep-beep pattern activated', 'danger');
    saveDriverData();
    updateAllUI();

    // Harsh brake is a short event — auto-clear after pattern duration (~2.4s)
    setTimeout(() => {
      state.isHarshBraking = false;
      updateAllUI();
    }, 2500);
  }
}

async function triggerLevelUp() {
  if (!state.ignitionOn) return;

  const sent = await sendCommand(CMD.LEVEL_UP);
  if (sent) {
    driverData.score += 50;
    addLog('🏆', 'Level Up! +50 points — Celebration melody playing!', 'accent');
    toast('🎉 Level Up! +50 points!', 'success');
    saveDriverData();
    updateAllUI();
  }
}

// ═══════════════════════════════════════════════════════
// Score & KM Timers
// ═══════════════════════════════════════════════════════

function startScoreTimer() {
  stopScoreTimer();
  state.scoreTimer = setInterval(() => {
    // +1 point per 10 seconds of safe driving (no active penalties)
    if (state.ignitionOn && !state.isIdling && !state.isSpeeding && !state.isHarshBraking) {
      driverData.score += 1;
      saveDriverData();
      updateLeaderboard();
    }
    // Update drive time
    if (state.drivingStartTime) {
      updateDriveTimeDisplay();
    }
  }, 10000);
}

function stopScoreTimer() {
  if (state.scoreTimer) { clearInterval(state.scoreTimer); state.scoreTimer = null; }
}

function startKmTimer() {
  stopKmTimer();
  state.kmTimer = setInterval(() => {
    // Simulate ~40 km/h when not idling, ~0 when idling
    if (state.ignitionOn && !state.isIdling) {
      driverData.kmTravelled += 0.11; // ~40km/h in 10s increments
      driverData.totalDriveTimeSec += 10;
      saveDriverData();
      updateLeaderboard();
    } else if (state.ignitionOn && state.isIdling) {
      driverData.totalDriveTimeSec += 10;
    }
  }, 10000);
}

function stopKmTimer() {
  if (state.kmTimer) { clearInterval(state.kmTimer); state.kmTimer = null; }
}

function updateDriveTimeDisplay() {
  const elapsed = Math.floor((Date.now() - state.drivingStartTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const hrs = Math.floor(mins / 60);
  const display = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m ${elapsed % 60}s`;
  $('lbDriveTime').textContent = display;
}

// ═══════════════════════════════════════════════════════
// UI Update Functions
// ═══════════════════════════════════════════════════════

function updateConnectionUI(connected) {
  const bleStatus = $('bleStatus');
  const bleDot = $('bleDot');
  const bleLabel = $('bleLabel');
  const liveBadge = $('liveBadge');

  if (connected) {
    bleStatus.classList.add('connected');
    bleLabel.textContent = 'Connected';
    btnConnect.innerHTML = '<span>🔌</span> Disconnect';
    btnConnect.classList.add('connected-btn');
    liveBadge.textContent = '● LIVE';
    liveBadge.classList.add('online');
  } else {
    bleStatus.classList.remove('connected');
    bleLabel.textContent = 'Disconnected';
    btnConnect.innerHTML = '<span>🔗</span> Connect BLE';
    btnConnect.classList.remove('connected-btn');
    liveBadge.textContent = '● OFFLINE';
    liveBadge.classList.remove('online');
  }
}

function updateAllUI() {
  updateIgnitionUI();
  updateTriggerButtons();
  updateStatusPanel();
  updateLeaderboard();
}

function updateIgnitionUI() {
  if (state.ignitionOn) {
    btnIgnition.classList.add('on');
    $('ignLabel').textContent = 'Ignition ON';
  } else {
    btnIgnition.classList.remove('on');
    $('ignLabel').textContent = 'Ignition OFF';
  }

  // Enable/disable trigger buttons based on ignition & connection
  const enabled = state.ignitionOn && state.connected;
  btnIdling.disabled = !enabled;
  btnSpeeding.disabled = !enabled;
  btnHarshBrake.disabled = !enabled;
  btnLevelUp.disabled = !enabled;
}

function updateTriggerButtons() {
  // Idling
  if (state.isIdling) {
    btnIdling.classList.add('active');
    $('idleStatus').textContent = state.idlingAcked ? 'Acknowledged' : 'ACTIVE';
  } else {
    btnIdling.classList.remove('active');
    $('idleStatus').textContent = 'Inactive';
  }

  // Speeding
  if (state.isSpeeding) {
    btnSpeeding.classList.add('active');
    $('speedStatus').textContent = 'ACTIVE';
  } else {
    btnSpeeding.classList.remove('active');
    $('speedStatus').textContent = 'Clear';
  }
}

function updateStatusPanel() {
  // Ignition
  setStatusItem('sIgnition', state.ignitionOn, state.ignitionOn ? 'ON' : 'OFF', 'sIgnVal', 'on');
  // LED
  setStatusItem('sLed', state.ignitionOn, state.ignitionOn ? 'ON' : 'OFF', 'sLedVal', 'on');
  // Idling/Vibration
  const idleState = state.isIdling ? (state.idlingAcked ? 'Acknowledged' : 'VIBRATING') : 'Inactive';
  const idleSeverity = state.isIdling && !state.idlingAcked ? 'warn' : (state.isIdling ? 'on' : 'off');
  setStatusItem('sIdling', state.isIdling, idleState, 'sIdleVal', idleSeverity);
  // Speeding/Buzzer
  setStatusItem('sSpeeding', state.isSpeeding, state.isSpeeding ? 'BUZZING' : 'Clear', 'sSpeedVal', state.isSpeeding ? 'danger' : 'off');
  // Harsh Brake
  setStatusItem('sBrake', state.isHarshBraking, state.isHarshBraking ? 'BEEPING' : 'Clear', 'sBrakeVal', state.isHarshBraking ? 'danger' : 'off');
  // Ack
  const ackText = !state.isIdling ? '—' : (state.idlingAcked ? 'Yes' : 'No');
  setStatusItem('sAck', state.idlingAcked, ackText, 'sAckVal', state.idlingAcked ? 'on' : 'off');
}

function setStatusItem(itemId, active, text, valId, severity) {
  const item = $(itemId);
  const val = $(valId);
  const iconWrap = item.querySelector('.s-icon-wrap');

  val.textContent = text;
  val.className = 's-value';
  iconWrap.className = 's-icon-wrap';

  switch (severity) {
    case 'on':     iconWrap.classList.add('s-on');     val.classList.add('v-on'); break;
    case 'warn':   iconWrap.classList.add('s-warn');   val.classList.add('v-warn'); break;
    case 'danger': iconWrap.classList.add('s-danger'); val.classList.add('v-danger'); break;
    default:       iconWrap.classList.add('s-off'); break;
  }
}

// ═══════════════════════════════════════════════════════
// Event Log
// ═══════════════════════════════════════════════════════

function addLog(icon, message, type) {
  const entry = {
    id: Date.now() + Math.random(),
    timestamp: new Date().toISOString(),
    icon,
    message,
    type,
  };
  logs.unshift(entry);
  if (logs.length > 500) logs.pop();
  saveLogs();
  renderLogEntry(entry, true);
}

function renderLogEntry(entry, prepend = false) {
  if (logEmpty) logEmpty.style.display = 'none';

  const div = document.createElement('div');
  div.className = 'log-entry';

  const time = new Date(entry.timestamp);
  const timeStr = time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const badgeClass = {
    info: 'badge-info', warning: 'badge-warning',
    danger: 'badge-danger', success: 'badge-success', accent: 'badge-accent',
  }[entry.type] || 'badge-info';

  const typeLabel = {
    info: 'INFO', warning: 'WARNING', danger: 'ALERT', success: 'OK', accent: 'REWARD',
  }[entry.type] || 'INFO';

  div.innerHTML = `
    <span class="log-icon">${entry.icon}</span>
    <span class="log-time">${timeStr}</span>
    <span class="log-msg">${entry.message}</span>
    <span class="log-badge ${badgeClass}">${typeLabel}</span>
  `;

  if (prepend) {
    logBody.insertBefore(div, logBody.firstChild);
  } else {
    logBody.appendChild(div);
  }
}

function renderAllLogs() {
  // Clear existing (except empty state)
  const entries = logBody.querySelectorAll('.log-entry');
  entries.forEach(e => e.remove());

  if (logs.length === 0) {
    if (logEmpty) logEmpty.style.display = '';
    return;
  }
  if (logEmpty) logEmpty.style.display = 'none';
  logs.forEach(entry => renderLogEntry(entry, false));
}

function clearLogs() {
  if (!confirm('Clear all event logs?')) return;
  logs = [];
  saveLogs();
  renderAllLogs();
  toast('Logs cleared', 'info');
}

function exportLogs() {
  const exportData = {
    version: '1.0',
    exportDate: new Date().toISOString(),
    driver: { ...driverData },
    logs: logs,
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `corover-data-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Data exported successfully', 'success');
}

function importLogs() {
  $('fileInput').click();
}

function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.logs) {
        logs = data.logs;
        saveLogs();
      }
      if (data.driver) {
        driverData = { ...driverData, ...data.driver };
        saveDriverData();
      }
      renderAllLogs();
      updateLeaderboard();
      toast('Data imported successfully', 'success');
    } catch (err) {
      toast('Invalid file format', 'danger');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ═══════════════════════════════════════════════════════
// Leaderboard
// ═══════════════════════════════════════════════════════

function getLevel(score) {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (score >= LEVELS[i].min) return LEVELS[i];
  }
  return LEVELS[0];
}

function getNextLevel(score) {
  for (let i = 0; i < LEVELS.length; i++) {
    if (score < LEVELS[i].min) return LEVELS[i];
  }
  return null;
}

function getLevelProgress(score) {
  const current = getLevel(score);
  const next = getNextLevel(score);
  if (!next) return 100;
  const range = next.min - current.min;
  const progress = score - current.min;
  return Math.min(100, Math.round((progress / range) * 100));
}

function getInitials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function updateLeaderboard() {
  const totalPenalties = driverData.penalties.speeding + driverData.penalties.harshBraking + driverData.penalties.idling;
  const level = getLevel(driverData.score);
  const nextLevel = getNextLevel(driverData.score);

  // Stats
  $('lbScore').textContent = driverData.score;
  $('lbLevel').textContent = level.name;
  $('lbKm').textContent = driverData.kmTravelled.toFixed(1);
  $('lbPenalties').textContent = totalPenalties;
  $('lbSessions').textContent = driverData.sessions;

  const driveMins = Math.floor(driverData.totalDriveTimeSec / 60);
  const driveHrs = Math.floor(driveMins / 60);
  $('lbDriveTime').textContent = driveHrs > 0 ? `${driveHrs}h ${driveMins % 60}m` : `${driveMins}m`;

  // Level progress
  $('lbLevelCur').textContent = level.name;
  $('lbLevelCur').style.color = level.color;
  $('lbLevelNext').textContent = nextLevel ? `→ ${nextLevel.name} (${nextLevel.min} pts)` : '★ MAX LEVEL';
  $('lbProgressFill').style.width = getLevelProgress(driverData.score) + '%';

  // Also update stats display
  $('statScore') && ($('statScore').textContent = driverData.score);

  // Build table
  const allDrivers = [
    ...SAMPLE_DRIVERS.map(d => ({ ...d, isMe: false })),
    {
      name: 'You',
      score: driverData.score,
      km: Math.round(driverData.kmTravelled),
      penalties: totalPenalties,
      trend: 'up',
      isMe: true,
    },
  ];
  allDrivers.sort((a, b) => b.score - a.score);

  const tbody = $('lbTableBody');
  tbody.innerHTML = '';

  allDrivers.forEach((driver, idx) => {
    const rank = idx + 1;
    const driverLevel = getLevel(driver.score);
    const tr = document.createElement('tr');
    if (driver.isMe) tr.classList.add('me');

    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
    const rankDisplay = medal ? `<span class="rank-medal">${medal}</span>` : `<span class="rank-num">#${rank}</span>`;

    const trendIcon = driver.trend === 'up' ? '↑' : driver.trend === 'down' ? '↓' : '–';
    const trendClass = driver.trend === 'up' ? 'trend-up' : driver.trend === 'down' ? 'trend-down' : 'trend-same';

    const avatarColor = driver.isMe ? 'linear-gradient(135deg, #00d4ff, #a855f7)' : `linear-gradient(135deg, ${driverLevel.color}88, ${driverLevel.color})`;
    const initials = driver.isMe ? '⭐' : getInitials(driver.name);

    tr.innerHTML = `
      <td>${rankDisplay}</td>
      <td>
        <div class="driver-cell">
          <div class="driver-avatar" style="background:${avatarColor}">${initials}</div>
          <span class="driver-name">${driver.name}${driver.isMe ? ' (You)' : ''}</span>
        </div>
      </td>
      <td><span class="level-badge ${driverLevel.cls}">${driverLevel.name}</span></td>
      <td style="font-weight:700; color:${driverLevel.color}">${driver.score.toLocaleString()}</td>
      <td>${driver.km.toLocaleString()} km</td>
      <td>${driver.penalties}</td>
      <td class="${trendClass}" style="font-size:18px;font-weight:700">${trendIcon}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ═══════════════════════════════════════════════════════
// Data Persistence
// ═══════════════════════════════════════════════════════

function loadDriverData() {
  const saved = localStorage.getItem('corover_driver');
  if (saved) {
    try { return JSON.parse(saved); } catch (e) {}
  }
  return {
    score: 0,
    kmTravelled: 0,
    totalDriveTimeSec: 0,
    sessions: 0,
    penalties: { speeding: 0, harshBraking: 0, idling: 0 },
  };
}

function saveDriverData() {
  localStorage.setItem('corover_driver', JSON.stringify(driverData));
}

function loadLogs() {
  const saved = localStorage.getItem('corover_logs');
  if (saved) {
    try { return JSON.parse(saved); } catch (e) {}
  }
  return [];
}

function saveLogs() {
  localStorage.setItem('corover_logs', JSON.stringify(logs));
}

// ═══════════════════════════════════════════════════════
// Toast Notifications
// ═══════════════════════════════════════════════════════

function toast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);

  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ═══════════════════════════════════════════════════════
// Event Listeners
// ═══════════════════════════════════════════════════════

btnConnect.addEventListener('click', connectBLE);
btnIgnition.addEventListener('click', async () => {
  if (!state.connected) { toast('Connect to device first', 'warning'); return; }
  await toggleIgnition();
});
btnIdling.addEventListener('click', () => toggleIdling());
btnSpeeding.addEventListener('click', () => toggleSpeeding());
btnHarshBrake.addEventListener('click', () => triggerHarshBrake());
btnLevelUp.addEventListener('click', () => triggerLevelUp());

$('btnClearLogs').addEventListener('click', clearLogs);
$('btnExport').addEventListener('click', exportLogs);
$('btnImport').addEventListener('click', importLogs);
$('fileInput').addEventListener('change', handleImport);

// ═══════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════

function init() {
  renderAllLogs();
  updateLeaderboard();
  updateAllUI();

  // Startup log
  if (logs.length === 0) {
    addLog('⚡', 'CoroVer Band Dashboard initialized', 'info');
  }
}

init();
