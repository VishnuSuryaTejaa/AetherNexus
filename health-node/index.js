/**
 * health-node/index.js
 *
 * A tiny Express server deployed to 3 regions (US, EU, Asia).
 * 
 * What it does:
 *  1. Monitors real CPU and memory usage via Node.js `os` module
 *  2. Pushes health data to MongoDB Atlas `server_health` collection every 5 seconds
 *  3. Exposes GET  /api/health        — returns current health snapshot
 *  4. Exposes POST /api/load-balance  — accepts fix commands from the AI
 *  5. Exposes POST /api/flush-cache   — mitigation endpoint for cache flush simulation
 *
 * Environment variables:
 *   MONGODB_URI  — MongoDB Atlas connection string
 *   REGION       — Region identifier: US-East, EU-West, or AP-South
 *   PORT         — Port to listen on (Koyeb/Render sets this automatically)
 */

const os = require('os');
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

// Load .env for local development (Koyeb injects env vars in production)
try { require('dotenv').config(); } catch (e) { /* dotenv optional in prod */ }

const app = express();
const PORT = process.env.PORT || 3000;
const REGION = process.env.REGION || 'UNKNOWN';
const MONGODB_URI = process.env.MONGODB_URI;
const PUSH_INTERVAL_MS = 5000;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── State ───────────────────────────────────────────────────────────────────
let db;
let collection;
let lastCpuInfo = os.cpus();
let simulatedExtraLoad = 0;
let cacheState = { flushed: false, lastFlushedNamespace: null };

// ── CPU Usage Calculation ───────────────────────────────────────────────────
function getCpuUsage() {
  const currentCpus = os.cpus();
  let totalIdleDelta = 0;
  let totalTickDelta = 0;

  for (let i = 0; i < currentCpus.length; i++) {
    const prev = lastCpuInfo[i] || currentCpus[i];
    const curr = currentCpus[i];

    const prevTotal = Object.values(prev.times).reduce((a, b) => a + b, 0);
    const currTotal = Object.values(curr.times).reduce((a, b) => a + b, 0);

    totalIdleDelta += curr.times.idle - prev.times.idle;
    totalTickDelta += currTotal - prevTotal;
  }

  lastCpuInfo = currentCpus;
  if (totalTickDelta === 0) return 0;

  const realUsage = ((1 - totalIdleDelta / totalTickDelta) * 100);
  return Math.min(100, Math.round((realUsage + simulatedExtraLoad) * 10) / 10);
}

function getMemoryUsage() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  return {
    used_gb: Math.round((usedMem / 1073741824) * 100) / 100,
    total_gb: Math.round((totalMem / 1073741824) * 100) / 100,
  };
}

/**
 * Status logic: STABLE / DEGRADED / CRITICAL
 * Matches the exact strings required by the AI frontend.
 */
function pickStatus(cpu) {
  if (cpu > 90) return 'CRITICAL';
  if (cpu > 75) return 'DEGRADED';
  return 'STABLE';
}

function buildHealthSnapshot() {
  const cpu = getCpuUsage();
  const memory = getMemoryUsage();
  const status = pickStatus(cpu);

  return {
    timestamp: new Date(),
    region: REGION,
    computeLoadPercentage: cpu,
    volatileMemoryAllocationGb: memory.used_gb,
    clusterOperationalStatus: status,
  };
}

// ── Push Metrics to MongoDB ─────────────────────────────────────────────────
async function pushMetrics() {
  if (!collection) return;

  const snapshot = buildHealthSnapshot();

  try {
    await collection.insertOne(snapshot);
    console.log(`[push] ${REGION} | CPU: ${snapshot.computeLoadPercentage}% | RAM: ${snapshot.volatileMemoryAllocationGb}GB | Status: ${snapshot.clusterOperationalStatus}`);
  } catch (err) {
    console.error('[push] MongoDB write failed:', err.message);
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────

// GET /api/health — current snapshot
app.get('/api/health', (req, res) => {
  res.json(buildHealthSnapshot());
});

// POST /api/load-balance — AI sends fix commands
app.post('/api/load-balance', (req, res) => {
  const { action } = req.body || {};

  switch (action) {
    case 'restart':
      simulatedExtraLoad = 0;
      console.log(`[fix] ${REGION}: Restart — extra load cleared`);
      res.json({ success: true, region: REGION, action: 'restart', message: 'Server restarted — load cleared' });
      break;

    case 'scale_down':
      simulatedExtraLoad = Math.max(0, simulatedExtraLoad - 30);
      console.log(`[fix] ${REGION}: Scale-down — extra load reduced to ${simulatedExtraLoad}%`);
      res.json({ success: true, region: REGION, action: 'scale_down', message: `Load reduced to ${simulatedExtraLoad}%` });
      break;

    case 'spike':
      simulatedExtraLoad = Math.min(100, simulatedExtraLoad + 50);
      console.log(`[fix] ${REGION}: Spike — extra load now ${simulatedExtraLoad}%`);
      res.json({ success: true, region: REGION, action: 'spike', message: `Load spiked to ${simulatedExtraLoad}%` });
      break;

    default:
      res.status(400).json({ success: false, message: `Unknown action: ${action}. Use "restart", "scale_down", or "spike".` });
  }
});

// POST /api/flush-cache — mitigation endpoint for the AI to flush cache
app.post('/api/flush-cache', (req, res) => {
  const { cacheLayerNamespace } = req.body || {};

  if (!cacheLayerNamespace) {
    return res.status(400).json({ success: false, message: 'Missing cacheLayerNamespace' });
  }

  // Simulate cache flush: reduce load
  simulatedExtraLoad = Math.max(0, simulatedExtraLoad - 40);
  cacheState = { flushed: true, lastFlushedNamespace: cacheLayerNamespace };

  console.log(`[fix] ${REGION}: Cache flushed for namespace "${cacheLayerNamespace}" — load reduced to ${simulatedExtraLoad}%`);
  res.json({
    success: true,
    region: REGION,
    action: 'flush_cache',
    cacheLayerNamespace,
    message: `Cache layer "${cacheLayerNamespace}" flushed. Load now: ${simulatedExtraLoad}%`,
  });
});

// GET / — alive check
app.get('/', (req, res) => {
  res.json({ service: 'health-node', region: REGION, status: 'running' });
});

// ── Startup ─────────────────────────────────────────────────────────────────
async function start() {
  if (!MONGODB_URI) {
    console.error('[error] MONGODB_URI is not set!');
    process.exit(1);
  }

  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db();
    collection = db.collection('server_health');
    console.log(`[db] Connected to MongoDB Atlas`);
  } catch (err) {
    console.error('[db] Connection failed:', err.message);
    process.exit(1);
  }

  pushMetrics();
  setInterval(pushMetrics, PUSH_INTERVAL_MS);
  console.log(`[push] Pushing metrics every ${PUSH_INTERVAL_MS / 1000}s for region: ${REGION}`);

  app.listen(PORT, () => {
    console.log(`[server] Health node (${REGION}) running on port ${PORT}`);
  });
}

start();
