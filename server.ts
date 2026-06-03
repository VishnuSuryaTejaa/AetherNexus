import express, { Request, Response } from 'express';
import cors from 'cors';
import { MongoClient, Db } from 'mongodb';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import {
  recalculateRouting,
  getDistributionMap,
  normalizeRegion,
  TrafficDistributionMap
} from './loadbalancer';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.LOCAL_PORT || process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;

// Deployed health node URLs
const NODE_URLS: Record<string, string> = {
  usEastCluster: process.env.NODE_US_URL || 'https://oweyr-health-node-us-east.hf.space',
  euWestCluster: process.env.NODE_EU_URL || 'https://oweyr-health-node-eu-west.hf.space',
  apSouthCluster: process.env.NODE_ASIA_URL || 'https://oweyr-health-node-ap-south.hf.space',
};

// Region name → JSON key mapping (for real data)
const REGION_TO_KEY: Record<string, string> = {
  'US-East': 'usEastCluster',
  'EU-West': 'euWestCluster',
  'AP-South': 'apSouthCluster',
};

app.use(cors());
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
    mongoConnected = true;
    console.log('[server] Connected to MongoDB Atlas successfully.');
    
    // Initialize the routing table on startup
    await recalculateRouting(db);
  } catch (err: any) {
    console.error('[server] MongoDB connection failed:', err.message);
    process.exit(1);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getLatestMetrics() {
  if (!mongoConnected) return null;

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

// ── Telemetry API (Port 3001 primary endpoint) ──────────────────────────────

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

  const nodeUrl = NODE_URLS[targetClusterRegion];
  if (!nodeUrl) {
    return res.status(400).json({
      success: false,
      message: `Unknown region: ${targetClusterRegion}. Valid: usEastCluster, euWestCluster, apSouthCluster`,
    });
  }

  try {
    const response = await fetch(`${nodeUrl}/api/flush-cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cacheLayerNamespace }),
    });
    const result = await response.json();
    console.log(`[mitigate] Sent flush-cache to ${targetClusterRegion}: ${cacheLayerNamespace}`);
    return res.json(result);
  } catch (err: any) {
    console.error(`[mitigate] Failed to reach ${targetClusterRegion}:`, err.message);
    return res.status(502).json({
      success: false,
      message: `Failed to reach ${targetClusterRegion}: ${err.message}`,
    });
  }
});

// ── Chaos Endpoints ─────────────────────────────────────────────────────────

/**
 * POST /api/chaos/spike-cpu
 * Takes a specific region name in the request body (e.g. { "region": "US-East-1" })
 * and instantly locks that region's CPU tracking variable to 99.8%.
 */
app.post('/api/chaos/spike-cpu', async (req: Request, res: Response) => {
  if (!mongoConnected) {
    return res.status(503).json({ error: 'Database connection not ready' });
  }

  const { region } = req.body;
  if (!region) {
    return res.status(400).json({ error: 'Missing "region" parameter in request body' });
  }

  const normRegion = normalizeRegion(region);

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
  if (!mongoConnected) {
    return res.status(503).json({ error: 'Database connection not ready' });
  }

  const { region = 'US-East-1' } = req.body;
  const normRegion = normalizeRegion(region);

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
  if (!mongoConnected) {
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
        computeLoadPercentage: 25.0,
        volatileMemoryAllocationGb: 4.5,
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
  if (!mongoConnected) {
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
  app.listen(PORT, () => {
    console.log(`[chaos-server] Unified Admin & Telemetry server running on port ${PORT}`);
  });
}

start();
