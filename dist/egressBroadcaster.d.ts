export interface ArchitecturalThoughtStreamPacket {
    eventTimestamp: string;
    principalArchitect: string;
    executedMitigationAction: string;
    incidentThreatLevelColor: "CRITICAL_RED" | "WARNING_AMBER" | "NOMINAL_GREEN";
}
export declare function emitArchitecturalThoughtStreamPacket(architecturalThoughtStreamPacket: ArchitecturalThoughtStreamPacket): void;
export declare function bootstrapEgressBroadcastServer(): Promise<void>;
//# sourceMappingURL=egressBroadcaster.d.ts.map