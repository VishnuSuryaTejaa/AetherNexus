/**
 * simulator.js
 * Generates fake server health logs for 3 regions every 2 seconds.
 * Chaos monkey spikes CPU to 99% roughly every 10 iterations.
 */

const logs = [];
const MAX_LOGS = 100;
let iteration = 0;

const REGIONS = ['US-East-1', 'EU-West-1', 'AP-South-1'];

/**
 * Pick a status based on CPU.
 */
function pickStatus(cpu) {
  if (cpu > 90) return 'CRITICAL';
  if (cpu > 75) return 'WARNING';
  return 'HEALTHY';
}

/**
 * Generate one log for one region.
 */
function generateLogForRegion(region) {
  let cpu;

  // Chaos monkey: ~10% chance, spike one random region to 99
  if (Math.random() < 0.1) {
    cpu = 99;
  } else {
    // Normal CPU: Math.random() * 30 + 20  -> 20 to 50
    cpu = Math.round((Math.random() * 30 + 20) * 10) / 10;
  }

  // RAM: 8.0 GB + random up to 2.0
  const ram_gb = Math.round((8.0 + Math.random() * 2.0) * 10) / 10;

  // Network packets per second: 500 to 3000
  const network_pps = Math.floor(Math.random() * 2501) + 500;

  const timestamp = new Date().toISOString();
  const status = pickStatus(cpu);

  return {
    timestamp,
    region,
    metrics: { cpu, ram_gb, network_pps },
    status,
  };
}

/**
 * Generate one log entry per region.
 */
function generateLog() {
  iteration++;

  for (const region of REGIONS) {
    const log = generateLogForRegion(region);
    logs.push(log);
  }

  // Cap at 100 entries
  while (logs.length > MAX_LOGS) {
    logs.shift();
  }

  console.log(`[simulator] generated logs for ${REGIONS.length} regions. Total: ${logs.length}`);
}

function start() {
  generateLog();
  setInterval(generateLog, 2000);
  console.log('[simulator] started — generating logs every 2s for US-East-1, EU-West-1, AP-South-1');
}

function getLatest(n = 10) {
  return logs.slice(-n);
}

function getAll() {
  return logs;
}

module.exports = { start, getLatest, getAll, REGIONS };
