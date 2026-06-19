
let db = null;

export async function writeAiLog(payload) {
    if (!db) return;
    try {
        await db.collection('ai_logs').insertOne({
            timestamp: payload.timestamp ? new Date(payload.timestamp) : new Date(),
            level: payload.level,
            text: payload.text,
            architect: payload.architect || 'AetherNexus-Core'
        });
    } catch (e) {
        console.error("[writeAiLog] Error inserting AI log:", e);
    }
}

export async function getLiveTelemetry() {
    if (!db) return null;
    try {
        const pipeline = [
            { $sort: { timestamp: -1 } },
            {
                $group: {
                    _id: '$region',
                    computeLoadPercentage: { $first: '$computeLoadPercentage' },
                    volatileMemoryAllocationGb: { $first: '$volatileMemoryAllocationGb' },
                    clusterOperationalStatus: { $first: '$clusterOperationalStatus' },
                },
            },
        ];
        const results = await db.collection('server_health').aggregate(pipeline).toArray();
        const infrastructureState = {
            usEastCluster: { computeLoadPercentage: 0, volatileMemoryAllocationGb: 0, clusterOperationalStatus: 'STABLE' },
            euWestCluster: { computeLoadPercentage: 0, volatileMemoryAllocationGb: 0, clusterOperationalStatus: 'STABLE' },
            apSouthCluster: { computeLoadPercentage: 0, volatileMemoryAllocationGb: 0, clusterOperationalStatus: 'STABLE' },
        };
        results.forEach((r) => {
            const mappedId = r._id === 'US-East' ? 'usEastCluster' 
                           : r._id === 'EU-West' ? 'euWestCluster'
                           : r._id === 'AP-South' ? 'apSouthCluster'
                           : r._id;
            if (infrastructureState[mappedId]) {
                infrastructureState[mappedId] = {
                    computeLoadPercentage: r.computeLoadPercentage,
                    volatileMemoryAllocationGb: r.volatileMemoryAllocationGb,
                    clusterOperationalStatus: r.clusterOperationalStatus,
                };
            }
        });
        return infrastructureState;
    } catch (e) {
        console.error("[getLiveTelemetry] MongoDB error:", e);
        return null;
    }
}
// ─── Socket.io Shared Reference ───────────────────────────────────────────────
let aetherNexusSocketIoEgressServer = null;
export function setSharedSocket(ioInstance) {
    aetherNexusSocketIoEgressServer = ioInstance;
}
// ─── Egress Broadcast Function ─────────────────────────────────────────────────
export function emitArchitecturalThoughtStreamPacket(architecturalThoughtStreamPacket) {
    try {
        if (aetherNexusSocketIoEgressServer) {
            aetherNexusSocketIoEgressServer.emit("aethernexus-telemetry-broadcast", architecturalThoughtStreamPacket);
            console.error(`[SOCKET_BROADCAST_EMITTED] Event: aethernexus-telemetry-broadcast | ThreatLevel: ${architecturalThoughtStreamPacket.incidentThreatLevelColor} | Action: ${architecturalThoughtStreamPacket.executedMitigationAction}`);
        }

        // Emit tagged AI insight to MongoDB
        const level = architecturalThoughtStreamPacket.incidentThreatLevelColor === 'CRITICAL_RED' ? 'critical'
            : architecturalThoughtStreamPacket.incidentThreatLevelColor === 'WARNING_AMBER' ? 'warning'
            : architecturalThoughtStreamPacket.incidentThreatLevelColor === 'NOMINAL_GREEN' ? 'success'
            : 'info';

        if (aetherNexusSocketIoEgressServer) {
            aetherNexusSocketIoEgressServer.emit("ai-log", {
                text: `[AI] ${architecturalThoughtStreamPacket.executedMitigationAction}`,
                level
            });
        }

        writeAiLog({
            text: `[AI] ${architecturalThoughtStreamPacket.executedMitigationAction}`,
            level,
            timestamp: architecturalThoughtStreamPacket.eventTimestamp ?? new Date().toISOString(),
            architect: architecturalThoughtStreamPacket.principalArchitect ?? 'AetherNexus-Core',
        });
    }
    catch (socketBroadcastException) {
        console.error("[SOCKET_BROADCAST_EXCEPTION]", socketBroadcastException);
    }
}
// ─── HTTP Transport Bootstrap ──────────────────────────────────────────────────
export function setSharedDb(databaseInstance) {
    db = databaseInstance;
}
//# sourceMappingURL=egressBroadcaster.js.map