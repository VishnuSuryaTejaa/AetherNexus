export type ThreatLevel = 'NOMINAL_GREEN' | 'WARNING_AMBER' | 'CRITICAL_RED';

export interface TelemetryPacket {
  eventTimestamp: string;
  principalArchitect: string;
  executedMitigationAction: string;
  incidentThreatLevelColor: ThreatLevel;
}

export interface NodeStatus {
  region: string;
  threatLevel: ThreatLevel;
}
