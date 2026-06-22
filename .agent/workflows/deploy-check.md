---
description: Full pre-deployment validation — run before every push to Render.com
---

Read render.yaml completely.
Read .env.example completely.
Read GLOBAL_WORKFLOW.md Section 5 (URL/Address Registry) and Section 3 (Boot Sequence).
Run all checks below. Report each as PASS or FAIL.


CHECK 1 — Environment Variable Keys in render.yaml
Verify render.yaml uses THESE exact key names (not GROQ_API_KEY):

 OPENAI_API_KEY (not GROQ_API_KEY) — BUG-002
 OPENAI_API_KEY2
 OPENAI_API_KEY3
 OPENAI_BASE_URL
 MONGODB_URI (present for ALL 4 services)
 AETHERNEXUS_ORCHESTRATOR_MODEL
 AETHERNEXUS_POLLING_INTERVAL_MS
 DOMAIN1_TELEMETRY_INGRESS_BASE_URL
 VITE_API_GATEWAY_URL (for frontend build, if applicable)


CHECK 2 — Port Assignments

 aethernexus-gateway (server.ts) → PORT=4000
 us-east-cluster (us-east-node.ts) → PORT=3001
 eu-west-cluster (eu-west-node.ts) → PORT=3002
 ap-south-cluster (ap-south-node.ts) → PORT=3004 (NOT 3003) — BUG-001
 gateway.ts service → GATEWAY_PORT=3003


CHECK 3 — DOMAIN1_TELEMETRY_INGRESS_BASE_URL

 Must point to server.ts (port 4000), NOT to a regional node (3001/3002/3004) — BUG-003

Local dev: http://localhost:4000
Render.com: https://aethernexus-gateway.onrender.com (or the correct Render URL for server.ts)




CHECK 4 — Start Commands in render.yaml

 aethernexus-gateway → npx ts-node server.ts
 us-east-cluster → npx ts-node nodes/us-east-node.ts
 eu-west-cluster → npx ts-node nodes/eu-west-node.ts
 ap-south-cluster → npx ts-node nodes/ap-south-node.ts
 No service starts a standalone orchestrator (bootOrchestrator runs inside server.ts) — BUG-004


CHECK 5 — package.json start:all

 Does NOT include a standalone node dist/orchestrator.js or equivalent — BUG-004
 Includes: ts-node server.ts, ts-node gateway.ts, all 3 nodes, dashboard dev


CHECK 6 — Cross-Region URL Consistency
Read server.ts. Verify MICROSERVICE_URLS map:

 usEastCluster → uses US_EAST_URL env var (NOT hardcoded localhost:3001)
 euWestCluster → uses EU_WEST_URL env var
 apSouthCluster → uses AP_SOUTH_URL env var (NOT localhost:3003) — BUG-001 impact


CHECK 7 — Critical Invariant Quick-Scan
Read server.ts boot sequence and verify:

 setSharedSocket(io) appears BEFORE bootOrchestrator()
 setSharedDb(db) appears BEFORE bootOrchestrator()



Produce a Deploy Readiness Report:

## Deploy Readiness Report — [DATE]

### PASSING
- [list of checks that passed]

### FAILING — MUST FIX BEFORE DEPLOY
- [list of checks that failed with exact issue]

### VERDICT
✅ READY TO DEPLOY — all checks passed
❌ NOT READY — [N] issues must be fixed

If any checks FAIL: say "Type /fix-bug BUG-XXX for each failing check, or I can fix them now — type FIX ALL."
If FIX ALL: fix each failing check, commit all changes:
// turbo
git add render.yaml package.json .env.example
// turbo
git commit -m "chore(deploy): pre-deployment fixes — all checks passing"