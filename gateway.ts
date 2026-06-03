import express, { Request, Response } from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { MongoClient, Db } from 'mongodb';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.GATEWAY_PORT || 3003;
const MONGODB_URI = process.env.MONGODB_URI;

// Target Node URLs from environment variables
const NODE_URLS = {
  'US-East-1': process.env.NODE_US_URL || 'https://oweyr-health-node-us-east.hf.space',
  'EU-West-1': process.env.NODE_EU_URL || 'https://oweyr-health-node-eu-west.hf.space',
  'AP-South-1': process.env.NODE_ASIA_URL || 'https://oweyr-health-node-ap-south.hf.space',
};

interface RoutingTable {
  'US-East-1': number;
  'EU-West-1': number;
  'AP-South-1': number;
}

// In-memory routing table initialized to nominal even weights
let routingTable: RoutingTable = {
  'US-East-1': 33.3,
  'EU-West-1': 33.3,
  'AP-South-1': 33.3,
};

let db: Db;
let mongoConnected = false;

// Normalize input keys to standard 'US-East-1', 'EU-West-1', 'AP-South-1'
function normalizeRoutingKey(key: string): keyof RoutingTable | null {
  const k = key.trim().toUpperCase();
  if (k === 'US' || k === 'US-EAST' || k === 'US-EAST-1') return 'US-East-1';
  if (k === 'EU' || k === 'EU-WEST' || k === 'EU-WEST-1') return 'EU-West-1';
  if (k === 'ASIA' || k === 'AP' || k === 'AP-SOUTH' || k === 'AP-SOUTH-1') return 'AP-South-1';
  return null;
}

// Connect to MongoDB Atlas and synchronize initial weights
async function connectDb() {
  if (MONGODB_URI) {
    try {
      const client = new MongoClient(MONGODB_URI);
      await client.connect();
      db = client.db();
      mongoConnected = true;
      console.log('[gateway] Connected to MongoDB Atlas successfully.');

      // Load initial distribution map from the database if it exists
      const stateDoc = await db.collection<any>('load_balancer_state').findOne({ _id: 'current_state' });
      if (stateDoc && stateDoc.traffic_distribution_map) {
        routingTable = stateDoc.traffic_distribution_map;
        console.log('[gateway] Initialized routing table from database:', routingTable);
      }
    } catch (err: any) {
      console.warn('[gateway] Database sync failed. Using default in-memory weights:', err.message);
    }
  } else {
    console.warn('[gateway] MONGODB_URI not found. Running in standalone in-memory mode.');
  }
}

// Dynamic Weighted Target Selection Algorithm
function selectTargetRegion(): keyof RoutingTable {
  const rand = Math.random() * 100;
  let runningSum = 0;
  
  const keys = Object.keys(routingTable) as (keyof RoutingTable)[];
  for (const key of keys) {
    runningSum += routingTable[key];
    if (rand < runningSum) {
      return key;
    }
  }

  // Fallback to first region with a non-zero weight, or EU-West-1
  for (const key of keys) {
    if (routingTable[key] > 0) return key;
  }
  return 'EU-West-1';
}

// ── Admin Rebalance Secret Door ─────────────────────────────────────────────

app.use(cors());

// Parse JSON specifically for the rebalance endpoint
app.post('/api/admin/rebalance', express.json(), async (req: Request, res: Response) => {
  const rawMap = req.body.traffic_distribution_map || req.body;

  if (!rawMap || typeof rawMap !== 'object') {
    return res.status(400).json({ error: 'Invalid or missing traffic distribution map payload' });
  }

  // Parse and normalize the incoming distribution percentages
  const newWeights: Partial<RoutingTable> = {};
  for (const rawKey of Object.keys(rawMap)) {
    const normalizedKey = normalizeRoutingKey(rawKey);
    if (normalizedKey) {
      newWeights[normalizedKey] = parseFloat(rawMap[rawKey]);
    }
  }

  // Verify we received all three weights
  if (
    typeof newWeights['US-East-1'] !== 'number' ||
    typeof newWeights['EU-West-1'] !== 'number' ||
    typeof newWeights['AP-South-1'] !== 'number'
  ) {
    return res.status(400).json({
      error: 'Incomplete routing map. US-East-1, EU-West-1, and AP-South-1 weights must be provided.',
      received: newWeights,
    });
  }

  // Update in-memory weights
  routingTable = {
    'US-East-1': newWeights['US-East-1'],
    'EU-West-1': newWeights['EU-West-1'],
    'AP-South-1': newWeights['AP-South-1'],
  };

  console.log('[gateway] Routing table updated by admin rebalance command:', routingTable);

  // Sync to database if available
  if (mongoConnected) {
    try {
      await db.collection<any>('load_balancer_state').updateOne(
        { _id: 'current_state' },
        {
          $set: {
            traffic_distribution_map: routingTable,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
      console.log('[gateway] Persisted updated routing table to database.');
    } catch (err: any) {
      console.error('[gateway] Failed to persist routing table to DB:', err.message);
    }
  }

  return res.json({
    success: true,
    message: 'Routing weights successfully updated.',
    traffic_distribution_map: routingTable,
  });
});

// ── http-proxy-middleware Gateway Setup ─────────────────────────────────────

const proxyMiddleware = createProxyMiddleware({
  target: 'https://oweyr-health-node-eu-west.hf.space', // Default fallback target
  router: (req) => {
    const targetRegion = selectTargetRegion();
    const targetUrl = NODE_URLS[targetRegion];
    return targetUrl;
  },
  changeOrigin: true,
  on: {
    proxyReq: (proxyReq, req, res) => {
      // Add custom header to track proxy path routing for diagnostics
      proxyReq.setHeader('x-gateway-routed-by', 'altrosyn-load-balancer');
    },
    error: (err, req, res: any) => {
      console.error('[gateway] Proxy forwarding failure:', err.message);
      if (res.writeHead) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Gateway: Regional node unreachable', details: err.message }));
      }
    }
  }
});

// Catch all traffic and forward it through http-proxy-middleware
app.use('/', proxyMiddleware);

// Boot the Server
async function start() {
  await connectDb();
  app.listen(PORT, () => {
    console.log(`[gateway] Gateway Proxy Load Balancer running on port ${PORT}`);
    console.log('[gateway] Configuration URLs:');
    console.log(`  US-East-1  → ${NODE_URLS['US-East-1']}`);
    console.log(`  EU-West-1  → ${NODE_URLS['EU-West-1']}`);
    console.log(`  AP-South-1 → ${NODE_URLS['AP-South-1']}`);
  });
}

start();
