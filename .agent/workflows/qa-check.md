---
description: Validate AetherNexus system health — cross-layer consistency check
---

Read GLOBAL_CONTEXT.md, GLOBAL_WORKFLOW.md, and BUG_REPORT.md.
Run the following consistency checks across all layers. Report each as PASS or FAIL.


LAYER 1 — Socket Event Contract Consistency
Read: dist/egressBroadcaster.js (emitter), dashboard/src/App.jsx (receiver)

 aethernexus-telemetry-broadcast — payload fields emitted match fields consumed in App.jsx
 live-metrics-stream — fields in getLatestMetrics() match what App.jsx live-metrics-stream handler reads
 ai-log — payload shape from writeAiLog matches App.jsx ai-log handler
 App.jsx handles ALL status strings that nodes can write: STABLE, CRITICAL, CRITICAL_NETWORK_DOWN, DEGRADED, HEALING — BUG-011 check


LAYER 2 — API Endpoint Contract Consistency
Read: server.ts endpoints, dashboard/src/App.jsx REST calls, dist/orchestrator.js tool dispatches

 POST /api/mitigate — request body shape matches between: App.jsx → server.ts → node /mitigate
 POST /api/rebalance — sourceRegion/targetRegion are camelCase cluster IDs in ALL callers
 POST /api/chaos/spike-cpu — region field format consistent
 POST /api/chaos/kill-network — region field format consistent
 AI tool executeClusterCacheFlush sends fields matching /api/mitigate expected body
 AI tool executeLoadBalancing sends fields matching /api/rebalance expected body


LAYER 3 — Region Name Format Consistency
Check the 4-format mapping table in GLOBAL_WORKFLOW.md Section 8:

 server_health MongoDB writes (nodes) use: 'US-East', 'EU-West', 'AP-South'
 loadbalancer.ts TrafficDistributionMap uses: 'US-East-1', 'EU-West-1', 'AP-South-1'
 egressBroadcaster.js getLiveTelemetry() converts DB format → camelCase correctly
 server.ts REGION_TO_KEY and CLUSTER_ID_TO_REGION maps cover all 3 regions in both directions


LAYER 4 — MongoDB Collection Consistency
Read: each writer and reader of every collection

 server_health writers: all 3 nodes + chaos endpoints in server.ts write identical field names
 server_health readers: getLiveTelemetry(), getLatestMetrics(), recalculateRouting() all read same field names
 load_balancer_state doc _id is always 'current_state' in every read/write
 ai_logs write schema matches what writeAiLog() sends
 chaos_locks read by reset endpoint — verify deleteMany filter matches write structure


LAYER 5 — AI Orchestrator Consistency
Read: dist/orchestrator.js tool manifest + system prompt + dispatchMcpToolCall

 Tool names in aetherNexusMcpToolManifest match exactly in dispatchMcpToolCall switch cases
 executeLoadBalancing tool description says ≥75/DEGRADED (not ≥90/CRITICAL) — BUG-008 check
 DOMAIN1_TELEMETRY_INGRESS_BASE_URL default is :4000 not :3001 — BUG-003 check
 isSystemPaused flag exists and is checked at top of executeEvaluationCycle()
 Groq key pool validation (gsk_ prefix) exists at boot


LAYER 6 — Boot Sequence Invariants
Read: server.ts boot section

 setSharedSocket(io) called before bootOrchestrator()
 setSharedDb(db) called before bootOrchestrator()
 recalculateRouting(db) called after setSharedDb(db) and before httpServer.listen()



Produce a QA Health Report:

## AetherNexus QA Report — [DATE]

### All Checks: [N PASS / N FAIL]

### PASSING
[list]

### FAILING
[list — each with: what's wrong + which bug ID if known + fix recommendation]

### NEW BUGS DISCOVERED
[list any issues found that are not in BUG_REPORT.md — add them there immediately]

### System Verdict
✅ CONSISTENT — all cross-layer contracts valid
⚠️ INCONSISTENCIES FOUND — [N] issues

For every NEW bug found: add it to BUG_REPORT.md immediately with severity, affected files, and description.
Ask: "Type /fix-next to begin fixing failing checks in priority order."