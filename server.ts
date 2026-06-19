import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { MongoClient, Db } from 'mongodb';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

// NOTE: mcpServer.js is deprecated. The system utilizes the inline dispatchMcpToolCall in orchestrator.js for tool execution.
import {
  recalculateRouting,
  getDistributionMap,
  normalizeRegion,
  TrafficDistributionMap
} from './loadbalancer';
// @ts-ignore - Bypassing TS strict mode for compiled JS module
import { bootOrchestrator } from './dist/orchestrator.js';
// @ts-ignore - Bypassing TS strict mode for patched JS export
import { setSharedSocket, setSharedDb } from './dist/egressBroadcaster.js';
// Local region type — microservices run as separate processes
type Region = 'usEastCluster' | 'euWestCluster' | 'apSouthCluster';

// Load environment variables
dotenv.config();

const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});
setSharedSocket(io);
const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI;

// Microservice URLs — driven by environment variables for production (Render)
const MICROSERVICE_URLS: Record<string, string> = {
  usEastCluster: process.env.US_EAST_URL || 'http://localhost:3001',
  euWestCluster: process.env.EU_WEST_URL || 'http://localhost:3002',
  apSouthCluster: process.env.AP_SOUTH_URL || 'http://localhost:3003',
};

// Region name → JSON key mapping (for real data)
const REGION_TO_KEY: Record<string, string> = {
  'US-East': 'usEastCluster',
  'EU-West': 'euWestCluster',
  'AP-South': 'apSouthCluster',
};

// Domain 2 camelCase cluster identifier → server_health region name mapping
const CLUSTER_ID_TO_REGION: Record<string, string> = {
  usEastCluster: 'US-East',
  euWestCluster: 'EU-West',
  apSouthCluster: 'AP-South',
};
// ── DISTRIBUTED NETWORK BRIDGES ──────────────────────────────────────────
// These functions replace the old local clusterManager. 
// They convert internal gateway commands into physical HTTP network requests sent across the globe.

async function mitigateCluster(region: Region) {
  const targetUrl = MICROSERVICE_URLS[region];
  console.log(`[Gateway] Routing mitigation command across the internet to ${targetUrl}`);
  try {
    await fetch(`${targetUrl}/mitigate`, { method: 'POST' });
  } catch (err) {
    console.error(`[Gateway] Failed to reach ${region} at ${targetUrl}`);
  }
}

async function injectFault(region: Region, faultType: string) {
  const targetUrl = MICROSERVICE_URLS[region];
  console.log(`[Gateway] Routing chaos command across the internet to ${targetUrl}`);
  try {
    await fetch(`${targetUrl}/inject-fault`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetClusterRegion: region, faultType })
    });
  } catch (err) {
    console.error(`[Gateway] Failed to reach ${region} at ${targetUrl}`);
  }
}


// ─────────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

let db: Db;
let mongoConnected = false;

// Connect to MongoDB Atlas
async function connectDb() {
  if (!MONGODB_URI) {
    console.error('[server] Error: MONGODB_URI is not set in environment variables!');
    process.exit(1);
  }

  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db();
    setSharedDb(db);
    mongoConnected = true;
    console.log('[server] Connected to MongoDB Atlas successfully.');
    
    // Initialize the routing table on startup
    await recalculateRouting(db);

    // Boot the AI evaluation engine inside the main process
    await bootOrchestrator();
    console.log('[server] AI Orchestrator engine initialized and running.');
    
    // High-frequency telemetry broadcast loop
    setInterval(async () => {
      try {
        await ensureDbConnection();
        const liveData = await getLatestMetrics();
        if (liveData) io.emit('live-metrics-stream', liveData);
      } catch (err: any) {
        mongoConnected = false;
        console.error('[Socket] Broadcast error:', err.message);
      }
    }, 2000);
  } catch (err: any) {
    console.error('[server] MongoDB connection failed:', err.message);
    process.exit(1);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function ensureDbConnection() {
  if (!mongoConnected) {
    await connectDb();
  }
  return mongoConnected;
}

async function getLatestMetrics() {
  if (!await ensureDbConnection()) return null;

  const pipeline = [
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: '$region',
        computeLoadPercentage: { $first: '$computeLoadPercentage' },
        volatileMemoryAllocationGb: { $first: '$volatileMemoryAllocationGb' },
        clusterOperationalStatus: { $first: '$clusterOperationalStatus' },
        timestamp: { $first: '$timestamp' },
      },
    },
  ];

  const results = await db.collection<any>('server_health').aggregate(pipeline).toArray();

  const infrastructureState: Record<string, any> = {
    usEastCluster: {
      computeLoadPercentage: 0,
      volatileMemoryAllocationGb: 0,
      clusterOperationalStatus: 'STABLE',
    },
    euWestCluster: {
      computeLoadPercentage: 0,
      volatileMemoryAllocationGb: 0,
      clusterOperationalStatus: 'STABLE',
    },
    apSouthCluster: {
      computeLoadPercentage: 0,
      volatileMemoryAllocationGb: 0,
      clusterOperationalStatus: 'STABLE',
    },
  };

  for (const doc of results) {
    const key = REGION_TO_KEY[doc._id];
    if (key && infrastructureState[key]) {
      infrastructureState[key] = {
        computeLoadPercentage: doc.computeLoadPercentage,
        volatileMemoryAllocationGb: doc.volatileMemoryAllocationGb,
        clusterOperationalStatus: doc.clusterOperationalStatus,
      };
    }
  }

  return infrastructureState;
}

// ── Telemetry API (Port 4000 primary endpoint) ──────────────────────────────

/**
 * GET /api/telemetry
 * Returns real telemetry states in the exact JSON format expected by the AI.
 */
app.get('/api/telemetry', async (req: Request, res: Response) => {
  try {
    const infrastructureState = await getLatestMetrics();
    if (!infrastructureState) {
      return res.status(503).json({ error: 'MongoDB connection not ready' });
    }
    return res.json({ infrastructureState });
  } catch (err: any) {
    console.error('[server] Telemetry fetch error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch telemetry' });
  }
});

/**
 * POST /api/mitigate
 * Mitigates cache issues by forwarding request to the target regional health node.
 */
app.post('/api/mitigate', async (req: Request, res: Response) => {
  const { targetClusterRegion, cacheLayerNamespace } = req.body || {};

  if (!targetClusterRegion || !cacheLayerNamespace) {
    return res.status(400).json({
      success: false,
      message: 'Missing targetClusterRegion or cacheLayerNamespace',
    });
  }

  try {
    // Execute mitigation: clear memory arrays, stop math loops, restore network
    await mitigateCluster(targetClusterRegion as Region);
    
    if (await ensureDbConnection()) {
      await recalculateRouting(db);
    }

    console.log(`[mitigate] Autonomous mitigation executed on ${targetClusterRegion}: ${cacheLayerNamespace}`);
    return res.json({
      success: true,
      message: `Mitigation successful on ${targetClusterRegion}.`,
    });
  } catch (err: any) {
    console.error(`[mitigate] Failed to mitigate ${targetClusterRegion}:`, err.message);
    return res.status(500).json({
      success: false,
      message: `Internal error during mitigation: ${err.message}`,
    });
  }
});

/**
 * POST /api/rebalance
 * Domain 2 AI Core integration endpoint.
 * Accepts { sourceRegion, targetRegion, trafficShiftPercentage } as dispatched
 * by the executeLoadBalancing MCP tool and updates the in-memory routing weights
 * persisted to MongoDB load_balancer_state.
 */
app.post('/api/rebalance', async (req: Request, res: Response) => {
  const { sourceRegion, targetRegion, trafficShiftPercentage } = req.body || {};

  if (!sourceRegion || !targetRegion || typeof trafficShiftPercentage !== 'number') {
    return res.status(400).json({
      success: false,
      message: 'Missing or invalid payload. Required: sourceRegion (string), targetRegion (string), trafficShiftPercentage (number).',
    });
  }

  if (sourceRegion === targetRegion) {
    return res.status(400).json({
      success: false,
      message: 'sourceRegion and targetRegion cannot be the same',
    });
  }

  const resolvedSourceRegion = CLUSTER_ID_TO_REGION[sourceRegion];
  const resolvedTargetRegion = CLUSTER_ID_TO_REGION[targetRegion];

  if (!resolvedSourceRegion || !resolvedTargetRegion) {
    return res.status(400).json({
      success: false,
      message: `Unrecognized cluster identifier. Valid sourceRegion/targetRegion values: usEastCluster, euWestCluster, apSouthCluster. Received: sourceRegion=${sourceRegion}, targetRegion=${targetRegion}`,
    });
  }

  if (trafficShiftPercentage < 1 || trafficShiftPercentage > 100) {
    return res.status(400).json({
      success: false,
      message: `trafficShiftPercentage must be between 1 and 100. Received: ${trafficShiftPercentage}`,
    });
  }

  try {
    const currentDistribution = await getDistributionMap(db);

    // Map server_health region names back to TrafficDistributionMap keys
    const regionToDistKey: Record<string, keyof typeof currentDistribution> = {
      'US-East': 'US-East-1',
      'EU-West': 'EU-West-1',
      'AP-South': 'AP-South-1',
    };

    const sourceDistKey = regionToDistKey[resolvedSourceRegion];
    const targetDistKey = regionToDistKey[resolvedTargetRegion];

    const updatedDistribution = { ...currentDistribution };
    const shiftAmount = Math.min(trafficShiftPercentage, updatedDistribution[sourceDistKey]);
    const mutatedSourceWeight = parseFloat(
      Math.max(0, updatedDistribution[sourceDistKey] - shiftAmount).toFixed(4)
    );
    const mutatedTargetWeight = parseFloat(
      Math.min(100, updatedDistribution[targetDistKey] + shiftAmount).toFixed(4)
    );
    // Derive the third unaffected region's weight as the 100-sum remainder
    // to guarantee the distribution always sums to exactly 100.
    const availableKeys = (Object.keys(updatedDistribution) as Array<keyof typeof updatedDistribution>).filter(k => k !== sourceDistKey && k !== targetDistKey);
    const thirdDistKey = availableKeys[0];
    const derivedThirdWeight = parseFloat((100 - mutatedSourceWeight - mutatedTargetWeight).toFixed(4));
    updatedDistribution[sourceDistKey] = mutatedSourceWeight;
    updatedDistribution[targetDistKey] = mutatedTargetWeight;
    updatedDistribution[thirdDistKey] = derivedThirdWeight;

    if (await ensureDbConnection()) {
      await db.collection<any>('load_balancer_state').updateOne(
        { _id: 'current_state' },
        {
          $set: {
            traffic_distribution_map: updatedDistribution,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
    }

    console.log(`[rebalance] Domain 2 directive applied — ${trafficShiftPercentage}% shifted from ${sourceRegion} to ${targetRegion}. New distribution:`, updatedDistribution);

    return res.json({
      success: true,
      message: `Traffic rebalanced: ${trafficShiftPercentage}% shifted from ${sourceRegion} to ${targetRegion}.`,
      traffic_distribution_map: updatedDistribution,
    });
  } catch (rebalanceOperationException: any) {
    console.error('[rebalance] Failed to apply Domain 2 rebalance directive:', rebalanceOperationException.message);
    return res.status(500).json({
      success: false,
      message: 'Internal error applying rebalance directive.',
    });
  }
});

// ── Chaos Endpoints ─────────────────────────────────────────────────────────

/**
 * POST /api/chaos/inject-fault
 * Executes programmatic resource fault-injection on isolated cluster workers.
 */
app.post('/api/chaos/inject-fault', async (req: Request, res: Response) => {
  const { targetClusterRegion, faultType } = req.body;
  if (!targetClusterRegion || !faultType) {
    return res.status(400).json({ error: 'Missing targetClusterRegion or faultType' });
  }

  try {
    await injectFault(targetClusterRegion as Region, faultType as any);
    if (await ensureDbConnection()) {
      let metricDoc: any = {
        timestamp: new Date(),
        region: normalizeRegion(targetClusterRegion),
      };
      if (faultType === 'NETWORK_DROPOUT') {
        metricDoc = { ...metricDoc, computeLoadPercentage: 0.0, volatileMemoryAllocationGb: 0.0, networkPackets: 0, clusterOperationalStatus: 'CRITICAL_NETWORK_DOWN' };
      } else if (faultType === 'MODERATE_LOAD') {
        metricDoc = { ...metricDoc, computeLoadPercentage: 82.0, volatileMemoryAllocationGb: 8.5, clusterOperationalStatus: 'DEGRADED' };
      } else {
        metricDoc = { ...metricDoc, computeLoadPercentage: 98.0, volatileMemoryAllocationGb: 14.0, clusterOperationalStatus: 'CRITICAL' };
      }
      await db.collection<any>('server_health').insertOne(metricDoc);
      await recalculateRouting(db);
    }

    console.log(`[chaos] Fault ${faultType} injected into ${targetClusterRegion}`);
    return res.json({
      success: true,
      message: `Successfully injected ${faultType} into ${targetClusterRegion}`,
    });
  } catch (err: any) {
    console.error('[chaos] Inject fault error:', err.message);
    return res.status(500).json({ error: 'Failed to inject fault' });
  }
});

/**
 * POST /api/chaos/spike-cpu
 * Takes a specific region name in the request body (e.g. { "region": "US-East-1" })
 * and instantly locks that region's CPU tracking variable to 99.8%.
 */
app.post('/api/chaos/spike-cpu', async (req: Request, res: Response) => {
  if (!await ensureDbConnection()) {
    return res.status(503).json({ error: 'Database connection not ready' });
  }

  const { region } = req.body;
  if (!region) {
    return res.status(400).json({ error: 'Missing "region" parameter in request body' });
  }

  let normRegion;
  try {
    normRegion = normalizeRegion(region);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const metricDoc = {
      timestamp: new Date(),
      region: normRegion,
      computeLoadPercentage: 99.8,
      volatileMemoryAllocationGb: 12.0,
      clusterOperationalStatus: 'CRITICAL',
    };
    await db.collection<any>('server_health').insertOne(metricDoc);

    await db.collection<any>('chaos_locks').updateOne(
      { region: normRegion },
      {
        $set: {
          type: 'cpu_lock',
          computeLoadPercentage: 99.8,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    const distribution = await recalculateRouting(db);

    console.log(`[chaos] CPU spiked to 99.8% for region ${normRegion} (${region})`);
    return res.json({
      success: true,
      message: `CPU spiked and locked to 99.8% for region ${normRegion}`,
      latestMetric: metricDoc,
      traffic_distribution_map: distribution,
    });
  } catch (err: any) {
    console.error('[chaos] Spike CPU error:', err.message);
    return res.status(500).json({ error: 'Failed to apply CPU spike' });
  }
});

/**
 * POST /api/chaos/kill-network
 * Simulates a dropped cable by forcing network packets to zero and changing
 * the cluster's status string to "CRITICAL_NETWORK_DOWN".
 * Defaults to "US-East-1" if no region is provided.
 */
app.post('/api/chaos/kill-network', async (req: Request, res: Response) => {
  if (!await ensureDbConnection()) {
    return res.status(503).json({ error: 'Database connection not ready' });
  }

  const { region = 'US-East-1' } = req.body;
  
  let normRegion;
  try {
    normRegion = normalizeRegion(region);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const metricDoc = {
      timestamp: new Date(),
      region: normRegion,
      computeLoadPercentage: 0.0,
      volatileMemoryAllocationGb: 0.0,
      networkPackets: 0,
      clusterOperationalStatus: 'CRITICAL_NETWORK_DOWN',
    };
    await db.collection<any>('server_health').insertOne(metricDoc);

    await db.collection<any>('chaos_locks').updateOne(
      { region: normRegion },
      {
        $set: {
          type: 'network_lock',
          networkPackets: 0,
          clusterOperationalStatus: 'CRITICAL_NETWORK_DOWN',
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    const distribution = await recalculateRouting(db);

    console.log(`[chaos] Network dropped (CRITICAL_NETWORK_DOWN) for region ${normRegion} (${region})`);
    return res.json({
      success: true,
      message: `Network killed for region ${normRegion}. Status set to CRITICAL_NETWORK_DOWN.`,
      latestMetric: metricDoc,
      traffic_distribution_map: distribution,
    });
  } catch (err: any) {
    console.error('[chaos] Kill network error:', err.message);
    return res.status(500).json({ error: 'Failed to kill network' });
  }
});

/**
 * POST /api/chaos/reset
 * Administrative endpoint to clear all CPU and network chaos locks,
 * returning the load balancer back to its normal 33.3% distribution.
 */
app.post('/api/chaos/reset', async (req: Request, res: Response) => {
  if (!await ensureDbConnection()) {
    return res.status(503).json({ error: 'Database connection not ready' });
  }

  try {
    await db.collection<any>('chaos_locks').deleteMany({});

    const regions = ['US-East', 'EU-West', 'AP-South'];
    const restoreTime = new Date();

    for (const r of regions) {
      await db.collection<any>('server_health').insertOne({
        timestamp: restoreTime,
        region: r,
        computeLoadPercentage: parseFloat((25.0 + Math.random() * 5.0).toFixed(1)),
        volatileMemoryAllocationGb: parseFloat((4.5 + Math.random() * 1.5).toFixed(1)),
        clusterOperationalStatus: 'STABLE',
      });
    }

    const distribution = await recalculateRouting(db);

    console.log('[chaos] All chaos locks cleared and infrastructure restored.');
    return res.json({
      success: true,
      message: 'All system chaos locks reset. Normal telemetry restored.',
      traffic_distribution_map: distribution,
    });
  } catch (err: any) {
    console.error('[chaos] Reset error:', err.message);
    return res.status(500).json({ error: 'Failed to reset chaos status' });
  }
});

// ── Infrastructure Telemetry Endpoint ───────────────────────────────────────

/**
 * GET /api/infrastructure/telemetry
 * Reads the database and returns the current metric arrays for all three regions.
 */
app.get('/api/infrastructure/telemetry', async (req: Request, res: Response) => {
  if (!await ensureDbConnection()) {
    return res.status(503).json({ error: 'Database connection not ready' });
  }

  try {
    const regionKeys = ['US-East', 'EU-West', 'AP-South'];
    const telemetryArrays: Record<string, any[]> = {};

    for (const r of regionKeys) {
      const records = await db.collection<any>('server_health')
        .find({ region: r })
        .sort({ timestamp: -1 })
        .limit(10)
        .toArray();

      const ordered = records.reverse();
      const outputKey = r === 'US-East' ? 'US-East-1' : r === 'EU-West' ? 'EU-West-1' : 'AP-South-1';
      telemetryArrays[outputKey] = ordered;
    }

    const distribution = await getDistributionMap(db);

    return res.json({
      telemetry: telemetryArrays,
      traffic_distribution_map: distribution,
    });
  } catch (err: any) {
    console.error('[telemetry] Retrieval error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch telemetry' });
  }
});

// Start the Server
async function start() {
  await connectDb();
  httpServer.listen(PORT, () => {
    console.log(`[chaos-server] Unified Admin & Telemetry server running on port ${PORT}`);
  });
}

start();
