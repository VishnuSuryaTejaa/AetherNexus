"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRegion = normalizeRegion;
exports.recalculateRouting = recalculateRouting;
exports.getDistributionMap = getDistributionMap;
/**
 * Normalizes user-facing/telemetry region names to a standard key format.
 */
function normalizeRegion(region) {
    const r = region.trim().toUpperCase();
    if (r === 'US-EAST' || r === 'US-EAST-1' || r === 'USEASTCLUSTER')
        return 'US-East';
    if (r === 'EU-WEST' || r === 'EU-WEST-1' || r === 'EUWESTCLUSTER')
        return 'EU-West';
    if (r === 'AP-SOUTH' || r === 'AP-SOUTH-1' || r === 'APSOUTHCLUSTER')
        return 'AP-South';
    return region;
}
/**
 * Recalculates live paths and redistributes the traffic weight.
 * If US-East-1 drops or crashes (e.g. status is CRITICAL_NETWORK_DOWN),
 * traffic weight is equally distributed between EU-West-1 and AP-South-1 (50% each).
 * Otherwise, traffic is divided evenly among all three regions (33.3% each).
 * Saves the state directly to the database in load_balancer_state collection.
 */
async function recalculateRouting(db) {
    const regions = ['US-East', 'EU-West', 'AP-South'];
    const statusMap = {
        'US-East': true, // true = active/healthy, false = crashed/down
        'EU-West': true,
        'AP-South': true
    };
    // Query latest status for all three regions
    for (const r of regions) {
        const latest = await db.collection('server_health')
            .findOne({ region: r }, { sort: { timestamp: -1 } });
        if (latest) {
            const status = latest.clusterOperationalStatus;
            if (status === 'CRITICAL_NETWORK_DOWN' || latest.networkPackets === 0) {
                statusMap[r] = false;
            }
        }
    }
    // Calculate active regions list
    const activeRegions = Object.keys(statusMap).filter(r => statusMap[r]);
    let distributionMap;
    if (activeRegions.length === 3) {
        // Normal operation: divided evenly among all three regions
        distributionMap = {
            'US-East-1': 33.3,
            'EU-West-1': 33.3,
            'AP-South-1': 33.3,
        };
        console.log('[loadbalancer] All regions healthy. Even split: 33.3% each.');
    }
    else if (activeRegions.length === 2) {
        // One region is down: redistribute traffic weight equally between the other two (50% each)
        distributionMap = {
            'US-East-1': statusMap['US-East'] ? 50 : 0,
            'EU-West-1': statusMap['EU-West'] ? 50 : 0,
            'AP-South-1': statusMap['AP-South'] ? 50 : 0,
        };
        console.log(`[loadbalancer] Failover: One region down. Active: ${activeRegions.join(', ')}. Split: 50% / 50%.`);
    }
    else if (activeRegions.length === 1) {
        // Two regions are down: route 100% of traffic to the single remaining healthy region
        distributionMap = {
            'US-East-1': statusMap['US-East'] ? 100 : 0,
            'EU-West-1': statusMap['EU-West'] ? 100 : 0,
            'AP-South-1': statusMap['AP-South'] ? 100 : 0,
        };
        console.log(`[loadbalancer] Critical Failover: Two regions down. Active: ${activeRegions[0]}. Routing 100% to active region.`);
    }
    else {
        // All regions are down: fallback to default split to attempt recovery routing
        distributionMap = {
            'US-East-1': 33.3,
            'EU-West-1': 33.3,
            'AP-South-1': 33.3,
        };
        console.log('[loadbalancer] Emergency: All regions down. Fallback to even split.');
    }
    // Save the state directly to database, changing tracking variable called traffic_distribution_map
    await db.collection('load_balancer_state').updateOne({ _id: 'current_state' }, {
        $set: {
            traffic_distribution_map: distributionMap,
            updatedAt: new Date(),
        },
    }, { upsert: true });
    return distributionMap;
}
/**
 * Retrieves the current traffic distribution map from the database.
 * If not set, defaults to the normal even distribution.
 */
async function getDistributionMap(db) {
    const stateDoc = await db.collection('load_balancer_state').findOne({ _id: 'current_state' });
    if (stateDoc && stateDoc.traffic_distribution_map) {
        return stateDoc.traffic_distribution_map;
    }
    return {
        'US-East-1': 33.3,
        'EU-West-1': 33.3,
        'AP-South-1': 33.3,
    };
}
