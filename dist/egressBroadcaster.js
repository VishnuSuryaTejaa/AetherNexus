import { createServer as createHttpServer } from "http";
import { Server as SocketIoServer } from "socket.io";
// ─── Socket.io Server Initialization ──────────────────────────────────────────
const resolvedEgressSocketPort = parseInt(process.env["AETHERNEXUS_SOCKET_EGRESS_PORT"] ?? "4000", 10);
const aetherNexusHttpTransportServer = createHttpServer();
const aetherNexusSocketIoEgressServer = new SocketIoServer(aetherNexusHttpTransportServer, {
    cors: {
        origin: process.env["DOMAIN3_FRONTEND_ORIGIN"] ?? "*",
        methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
});
// ─── Connection Lifecycle Telemetry ───────────────────────────────────────────
aetherNexusSocketIoEgressServer.on("connection", (ingressClientSocket) => {
    console.error(`[SOCKET_CLIENT_CONNECTED] Socket ID: ${ingressClientSocket.id} | Active connections: ${aetherNexusSocketIoEgressServer.engine.clientsCount}`);
    ingressClientSocket.on("disconnect", (disconnectReason) => {
        console.error(`[SOCKET_CLIENT_DISCONNECTED] Socket ID: ${ingressClientSocket.id} | Reason: ${disconnectReason}`);
    });
});
// ─── Egress Broadcast Function ─────────────────────────────────────────────────
export function emitArchitecturalThoughtStreamPacket(architecturalThoughtStreamPacket) {
    try {
        aetherNexusSocketIoEgressServer.emit("aethernexus-telemetry-broadcast", architecturalThoughtStreamPacket);
        console.error(`[SOCKET_BROADCAST_EMITTED] Event: aethernexus-telemetry-broadcast | ThreatLevel: ${architecturalThoughtStreamPacket.incidentThreatLevelColor} | Action: ${architecturalThoughtStreamPacket.executedMitigationAction}`);
    }
    catch (socketBroadcastException) {
        console.error("[SOCKET_BROADCAST_EXCEPTION]", socketBroadcastException);
    }
}
// ─── HTTP Transport Bootstrap ──────────────────────────────────────────────────
export function bootstrapEgressBroadcastServer() {
    return new Promise((resolveBootstrap, rejectBootstrap) => {
        try {
            aetherNexusHttpTransportServer.listen(resolvedEgressSocketPort, () => {
                console.error(`[SOCKET_SERVER_BOOTSTRAP_SUCCESS] AetherNexus Egress Broadcaster — Listening on port ${resolvedEgressSocketPort}.`);
                resolveBootstrap();
            });
            aetherNexusHttpTransportServer.on("error", (httpServerBindException) => {
                console.error("[SOCKET_SERVER_BOOTSTRAP_EXCEPTION]", httpServerBindException);
                rejectBootstrap(httpServerBindException);
            });
        }
        catch (egressServerInitException) {
            console.error("[SOCKET_SERVER_INIT_EXCEPTION]", egressServerInitException);
            rejectBootstrap(egressServerInitException);
        }
    });
}
//# sourceMappingURL=egressBroadcaster.js.map