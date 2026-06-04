"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const mongodb_1 = require("mongodb");
const dotenv_1 = __importDefault(require("dotenv"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const loadbalancer_1 = require("./loadbalancer");
// Load environment variables
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.LOCAL_PORT || process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;
// Deployed health node URLs
const NODE_URLS = {
    usEastCluster: process.env.NODE_US_URL || 'https://oweyr-health-node-us-east.hf.space',
    euWestCluster: process.env.NODE_EU_URL || 'https://oweyr-health-node-eu-west.hf.space',
    apSouthCluster: process.env.NODE_ASIA_URL || 'https://oweyr-health-node-ap-south.hf.space',
};
// Region name → JSON key mapping (for real data)
const REGION_TO_KEY = {
    'US-East': 'usEastCluster',
    'EU-West': 'euWestCluster',
    'AP-South': 'apSouthCluster',
};
// Domain 2 camelCase cluster identifier → server_health region name mapping
const CLUSTER_ID_TO_REGION = {
    usEastCluster: 'US-East',
    euWestCluster: 'EU-West',
    apSouthCluster: 'AP-South',
};
app.use((0, cors_1.default)());
app.use(express_1.default.json());
let db;
let mongoConnected = false;
// Connect to MongoDB Atlas
async function connectDb() {
    if (!MONGODB_URI) {
        console.error('[server] Error: MONGODB_URI is not set in environment variables!');
        process.exit(1);
    }
    try {
        const client = new mongodb_1.MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db();
        mongoConnected = true;
        console.log('[server] Connected to MongoDB Atlas successfully.');
        // Initialize the routing table on startup
        await (0, loadbalancer_1.recalculateRouting)(db);
    }
    catch (err) {
        console.error('[server] MongoDB connection failed:', err.message);
        process.exit(1);
    }
}
// ── Helpers ─────────────────────────────────────────────────────────────────
async function getLatestMetrics() {
    if (!mongoConnected)
        return null;
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
    const results = await db.collection('server_health').aggregate(pipeline).toArray();
    const infrastructureState = {
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
app.get('/api/telemetry', async (req, res) => {
    try {
        const infrastructureState = await getLatestMetrics();
        if (!infrastructureState) {
            return res.status(503).json({ error: 'MongoDB connection not ready' });
        }
        return res.json({ infrastructureState });
    }
    catch (err) {
        console.error('[server] Telemetry fetch error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch telemetry' });
    }
});
/**
 * POST /api/mitigate
 * Mitigates cache issues by forwarding request to the target regional health node.
 */
app.post('/api/mitigate', async (req, res) => {
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
        const response = await (0, node_fetch_1.default)(`${nodeUrl}/api/flush-cache`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cacheLayerNamespace }),
        });
        const result = await response.json();
        console.log(`[mitigate] Sent flush-cache to ${targetClusterRegion}: ${cacheLayerNamespace}`);
        return res.json(result);
    }
    catch (err) {
        console.error(`[mitigate] Failed to reach ${targetClusterRegion}:`, err.message);
        return res.status(502).json({
            success: false,
            message: `Failed to reach ${targetClusterRegion}: ${err.message}`,
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
app.post('/api/rebalance', async (req, res) => {
    const { sourceRegion, targetRegion, trafficShiftPercentage } = req.body || {};
    if (!sourceRegion || !targetRegion || typeof trafficShiftPercentage !== 'number') {
        return res.status(400).json({
            success: false,
            message: 'Missing or invalid payload. Required: sourceRegion (string), targetRegion (string), trafficShiftPercentage (number).',
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
        const currentDistribution = await (0, loadbalancer_1.getDistributionMap)(db);
        // Map server_health region names back to TrafficDistributionMap keys
        const regionToDistKey = {
            'US-East': 'US-East-1',
            'EU-West': 'EU-West-1',
            'AP-South': 'AP-South-1',
        };
        const sourceDistKey = regionToDistKey[resolvedSourceRegion];
        const targetDistKey = regionToDistKey[resolvedTargetRegion];
        const updatedDistribution = { ...currentDistribution };
        const shiftAmount = Math.min(trafficShiftPercentage, updatedDistribution[sourceDistKey]);
        const mutatedSourceWeight = parseFloat(Math.max(0, updatedDistribution[sourceDistKey] - shiftAmount).toFixed(4));
        const mutatedTargetWeight = parseFloat(Math.min(100, updatedDistribution[targetDistKey] + shiftAmount).toFixed(4));
        // Derive the third unaffected region's weight as the 100-sum remainder
        // to guarantee the distribution always sums to exactly 100.
        const thirdDistKey = Object.keys(updatedDistribution)
            .find((k) => k !== sourceDistKey && k !== targetDistKey);
        const derivedThirdWeight = parseFloat((100 - mutatedSourceWeight - mutatedTargetWeight).toFixed(4));
        updatedDistribution[sourceDistKey] = mutatedSourceWeight;
        updatedDistribution[targetDistKey] = mutatedTargetWeight;
        updatedDistribution[thirdDistKey] = derivedThirdWeight;
        if (mongoConnected) {
            await db.collection('load_balancer_state').updateOne({ _id: 'current_state' }, {
                $set: {
                    traffic_distribution_map: updatedDistribution,
                    updatedAt: new Date(),
                },
            }, { upsert: true });
        }
        console.log(`[rebalance] Domain 2 directive applied — ${trafficShiftPercentage}% shifted from ${sourceRegion} to ${targetRegion}. New distribution:`, updatedDistribution);
        return res.json({
            success: true,
            message: `Traffic rebalanced: ${trafficShiftPercentage}% shifted from ${sourceRegion} to ${targetRegion}.`,
            traffic_distribution_map: updatedDistribution,
        });
    }
    catch (rebalanceOperationException) {
        console.error('[rebalance] Failed to apply Domain 2 rebalance directive:', rebalanceOperationException.message);
        return res.status(500).json({
            success: false,
            message: 'Internal error applying rebalance directive.',
        });
    }
});
// ── Chaos Endpoints ─────────────────────────────────────────────────────────
/**
 * POST /api/chaos/spike-cpu
 * Takes a specific region name in the request body (e.g. { "region": "US-East-1" })
 * and instantly locks that region's CPU tracking variable to 99.8%.
 */
app.post('/api/chaos/spike-cpu', async (req, res) => {
    if (!mongoConnected) {
        return res.status(503).json({ error: 'Database connection not ready' });
    }
    const { region } = req.body;
    if (!region) {
        return res.status(400).json({ error: 'Missing "region" parameter in request body' });
    }
    const normRegion = (0, loadbalancer_1.normalizeRegion)(region);
    try {
        const metricDoc = {
            timestamp: new Date(),
            region: normRegion,
            computeLoadPercentage: 99.8,
            volatileMemoryAllocationGb: 12.0,
            clusterOperationalStatus: 'CRITICAL',
        };
        await db.collection('server_health').insertOne(metricDoc);
        await db.collection('chaos_locks').updateOne({ region: normRegion }, {
            $set: {
                type: 'cpu_lock',
                computeLoadPercentage: 99.8,
                updatedAt: new Date(),
            },
        }, { upsert: true });
        const distribution = await (0, loadbalancer_1.recalculateRouting)(db);
        console.log(`[chaos] CPU spiked to 99.8% for region ${normRegion} (${region})`);
        return res.json({
            success: true,
            message: `CPU spiked and locked to 99.8% for region ${normRegion}`,
            latestMetric: metricDoc,
            traffic_distribution_map: distribution,
        });
    }
    catch (err) {
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
app.post('/api/chaos/kill-network', async (req, res) => {
    if (!mongoConnected) {
        return res.status(503).json({ error: 'Database connection not ready' });
    }
    const { region = 'US-East-1' } = req.body;
    const normRegion = (0, loadbalancer_1.normalizeRegion)(region);
    try {
        const metricDoc = {
            timestamp: new Date(),
            region: normRegion,
            computeLoadPercentage: 0.0,
            volatileMemoryAllocationGb: 0.0,
            networkPackets: 0,
            clusterOperationalStatus: 'CRITICAL_NETWORK_DOWN',
        };
        await db.collection('server_health').insertOne(metricDoc);
        await db.collection('chaos_locks').updateOne({ region: normRegion }, {
            $set: {
                type: 'network_lock',
                networkPackets: 0,
                clusterOperationalStatus: 'CRITICAL_NETWORK_DOWN',
                updatedAt: new Date(),
            },
        }, { upsert: true });
        const distribution = await (0, loadbalancer_1.recalculateRouting)(db);
        console.log(`[chaos] Network dropped (CRITICAL_NETWORK_DOWN) for region ${normRegion} (${region})`);
        return res.json({
            success: true,
            message: `Network killed for region ${normRegion}. Status set to CRITICAL_NETWORK_DOWN.`,
            latestMetric: metricDoc,
            traffic_distribution_map: distribution,
        });
    }
    catch (err) {
        console.error('[chaos] Kill network error:', err.message);
        return res.status(500).json({ error: 'Failed to kill network' });
    }
});
/**
 * POST /api/chaos/reset
 * Administrative endpoint to clear all CPU and network chaos locks,
 * returning the load balancer back to its normal 33.3% distribution.
 */
app.post('/api/chaos/reset', async (req, res) => {
    if (!mongoConnected) {
        return res.status(503).json({ error: 'Database connection not ready' });
    }
    try {
        await db.collection('chaos_locks').deleteMany({});
        const regions = ['US-East', 'EU-West', 'AP-South'];
        const restoreTime = new Date();
        for (const r of regions) {
            await db.collection('server_health').insertOne({
                timestamp: restoreTime,
                region: r,
                computeLoadPercentage: 25.0,
                volatileMemoryAllocationGb: 4.5,
                clusterOperationalStatus: 'STABLE',
            });
        }
        const distribution = await (0, loadbalancer_1.recalculateRouting)(db);
        console.log('[chaos] All chaos locks cleared and infrastructure restored.');
        return res.json({
            success: true,
            message: 'All system chaos locks reset. Normal telemetry restored.',
            traffic_distribution_map: distribution,
        });
    }
    catch (err) {
        console.error('[chaos] Reset error:', err.message);
        return res.status(500).json({ error: 'Failed to reset chaos status' });
    }
});
// ── Infrastructure Telemetry Endpoint ───────────────────────────────────────
/**
 * GET /api/infrastructure/telemetry
 * Reads the database and returns the current metric arrays for all three regions.
 */
app.get('/api/infrastructure/telemetry', async (req, res) => {
    if (!mongoConnected) {
        return res.status(503).json({ error: 'Database connection not ready' });
    }
    try {
        const regionKeys = ['US-East', 'EU-West', 'AP-South'];
        const telemetryArrays = {};
        for (const r of regionKeys) {
            const records = await db.collection('server_health')
                .find({ region: r })
                .sort({ timestamp: -1 })
                .limit(10)
                .toArray();
            const ordered = records.reverse();
            const outputKey = r === 'US-East' ? 'US-East-1' : r === 'EU-West' ? 'EU-West-1' : 'AP-South-1';
            telemetryArrays[outputKey] = ordered;
        }
        const distribution = await (0, loadbalancer_1.getDistributionMap)(db);
        return res.json({
            telemetry: telemetryArrays,
            traffic_distribution_map: distribution,
        });
    }
    catch (err) {
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
