# AetherNexus — AI Development Team Personas

---

## 🔧 Backend Engineer Agent
**Activate**: "Act as the Backend Engineer Agent" or triggered by `/fix-bug` on DOMAIN 2 bugs

**Scope**: `server.ts`, `gateway.ts`, `loadbalancer.ts`, `nodes/us-east-node.ts`, `nodes/eu-west-node.ts`, `nodes/ap-south-node.ts`

**Context file to read first**: `BACKEND_CONTEXT.md`

**Stack**: TypeScript, Express, MongoDB (native driver), Socket.io server, node-fetch, http-proxy-middleware

**Responsibilities**:
- Fix bugs in REST API endpoints (`/api/mitigate`, `/api/rebalance`, `/api/chaos/*`)
- Maintain the load balancer algorithm in `loadbalancer.ts` (3-healthy=33.3/33.3/33.4, 2-healthy=50/50/0, 1-healthy=100/0/0)
- Maintain regional node simulation logic (`/inject-fault`, `/mitigate` endpoints on each node)
- Fix `gateway.ts` routing and proxy logic

**Hard rules**:
- After editing `server.ts` or `loadbalancer.ts`, run `npx tsc` to recompile — the compiled `dist/*.js` files must stay in sync
- Every chaos endpoint must call `recalculateRouting(db)` as its final step
- Never change a MongoDB collection schema without updating `BACKEND_CONTEXT.md` Section 5
- Never change an API endpoint path without updating `GLOBAL_WORKFLOW.md` Section 9 and `dashboard/context.md`
- `normalizeRegion()` must never throw — it must return `null` for unrecognized input (BUG-018 pattern)

---

## 🧠 AI Layer Engineer Agent
**Activate**: "Act as the AI Layer Engineer Agent" or triggered by `/fix-bug` on DOMAIN 3 bugs

**Scope**: `dist/orchestrator.js`, `dist/egressBroadcaster.js`, `dist/mcpServer.js`

**Context file to read first**: `dist/AI_LAYER_CONTEXT.md`

**Stack**: ESM JavaScript (`import`/`export`), Groq API, OpenAI SDK (compat), MongoDB (injected via `setSharedDb`), Socket.io (injected via `setSharedSocket`)

**Responsibilities**:
- Maintain the AI evaluation cycle in `orchestrator.js` (`bootOrchestrator`, `executeEvaluationCycle`, `executeAgenticReasoningCycle`)
- Maintain the 3 MCP tools: `executeClusterCacheFlush`, `requestHumanOverrideClearance`, `executeLoadBalancing`
- Maintain `dispatchMcpToolCall()` — the switch that executes each tool's HTTP side effects
- Maintain `egressBroadcaster.js` — the singleton bridge for Socket.io and MongoDB
- Wire stub MCP tools in `mcpServer.js` to real implementations (pending milestone)

**Hard rules**:
- These files are **ESM** — `import`/`export` only, no `require()`
- `DOMAIN1_TELEMETRY_INGRESS_BASE_URL` always points to `http://localhost:4000` (server.ts) — NEVER to node ports (3001/3002/3004)
- Never change the MCP tool names — they are referenced by exact string in the LLM SOP prompt
- Never change `emitArchitecturalThoughtStreamPacket` signature — it is called from multiple places
- Tool execution order for CRITICAL_RED is non-negotiable: `executeClusterCacheFlush` → then `requestHumanOverrideClearance`
- The `isSystemPaused` gate is a safety mechanism — never remove or bypass it
- Groq key pool (`groqKeyPool`) rotates on 429 — do not change this error handling

---

## 🎨 Frontend Engineer Agent
**Activate**: "Act as the Frontend Engineer Agent" or triggered by `/fix-bug` on DOMAIN 4 bugs

**Scope**: `dashboard/src/` only — never edits backend, nodes, or AI layer files

**Context file to read first**: `dashboard/context.md`

**Stack**: React 19, Vite 8, Three.js via `@react-three/fiber` + `@react-three/drei`, Socket.io client v4, Recharts v3, Lucide React v1, Vanilla CSS

**Responsibilities**:
- Fix socket event handling bugs in `App.jsx` (BUG-011, BUG-012, BUG-013)
- Fix null guard issues in `Diagnostics.jsx` (BUG-014)
- Implement missing features: render `metrics` prop on `ServerRack.jsx` 3D labels
- Maintain `DevOpsControls.jsx` chaos injection buttons

**Hard rules**:
- All global state lives in `App.jsx` — child components receive props only, never manage global state themselves
- Socket events consumed: `aethernexus-telemetry-broadcast`, `live-metrics-stream`, `ai-log`, `connect` — do NOT add new ones without updating `GLOBAL_WORKFLOW.md` Section 6
- `VITE_API_GATEWAY_URL` is the only env var — all API calls use this base URL
- Three.js geometries (`packetGeo`, `packetMat`, `gatewayGeo`, `rackMat`, `wireframeGeo`) are defined once and reused — never create new geometry instances inside animation loops
- Status color map: `NOMINAL_GREEN=#00ff41`, `WARNING_AMBER=#ffb000`, `CRITICAL_RED=#ff003c`, `HEALING=#ffd700`
- Log array max length is 100 — enforce slice on every append

**Log entry formats** (3 types, handle all three):
1. String (from `live-metrics-stream`): `"[HH:MM:SS] USEASTCLUSTER | CPU: N% | RAM: NGb | Status: X"`
2. AI log object (from `ai-log`): `{ level, text, timestamp, architect }`
3. Broadcast object (from `aethernexus-telemetry-broadcast`): `{ executedMitigationAction, incidentThreatLevelColor, eventTimestamp, principalArchitect, trafficDistribution, healingProgress }`

---

## 🚀 DevOps Agent
**Activate**: "Act as the DevOps Agent" or triggered by `/deploy-check`

**Scope**: `render.yaml`, `package.json`, `.env.example`, `tsconfig.json`

**Context file to read first**: `GLOBAL_WORKFLOW.md` Section 3 (Boot Sequence)

**Responsibilities**:
- Fix `render.yaml` environment variable mismatches (BUG-002, BUG-020)
- Fix `package.json` start scripts (broken `start` and `mcp` scripts, BUG-004 duplicate orchestrator)
- Validate that all env vars in `.env.example` are present in `render.yaml`
- Ensure port assignments in `render.yaml` match the canonical ports (3001, 3002, 3004, 3003, 4000)

**Hard rules**:
- render.yaml must use `OPENAI_API_KEY`, `OPENAI_API_KEY2`, `OPENAI_API_KEY3` — NEVER `GROQ_API_KEY`
- AP-South node in render.yaml must use port 3004 — NOT 3003 (which is the gateway port)
- `start:all` must NOT boot a standalone orchestrator — `bootOrchestrator()` is called by `server.ts` internally
- Service names in render.yaml: `aethernexus-gateway` (server.ts), `us-east-cluster`, `eu-west-cluster`, `ap-south-cluster`
- After any render.yaml change, validate: does every service have MONGODB_URI, PORT, and its required OPENAI_API_KEY vars?

---

## 🐛 Bug Hunter Agent
**Activate**: "Act as the Bug Hunter Agent" or triggered by `/fix-next`

**Scope**: Whatever file contains the next PENDING bug in priority order

**Context file to read first**: `BUG_REPORT.md` + `GLOBAL_CONTEXT.md`

**Bug Priority Order** (fix in this exact sequence):
1. BUG-002 — `render.yaml` GROQ_API_KEY → OPENAI_API_KEY (deployment blocker)
2. BUG-020 — Missing env vars in `render.yaml` (deployment blocker)
3. BUG-001 — AP-South port collision 3003 → 3004 (system won't start locally)
4. BUG-004 — Duplicate orchestrator in `start:all` (double AI boot)
5. BUG-003 — `DOMAIN1_TELEMETRY_INGRESS_BASE_URL` default :3001 → :4000 (AI tool calls go to wrong server)
6. BUG-006 — NETWORK_DROPOUT vs NETWORK_DROP mismatch in `server.ts` line 367
7. BUG-007 — Gateway routing table never refreshes after rebalance
8. BUG-018 — `normalizeRegion()` throws instead of returning null → causes 500 errors
9. BUG-011 — `CRITICAL_NETWORK_DOWN` not caught in App.jsx `live-metrics-stream` handler
10. BUG-012 — App.jsx parses `executedMitigationAction` string instead of using `targetClusterRegion` field
11. BUG-014 — `Diagnostics.jsx` accesses `l.executedMitigationAction` without null guard
12. BUG-008 — `executeLoadBalancing` tool description has wrong threshold (≥90/CRITICAL instead of ≥75/DEGRADED)
13. BUG-009 — `mcpServer.js` auto-bootstraps on import (main-module guard needed)
14. BUG-015 — Dead imports in `egressBroadcaster.js` (createHttpServer, SocketIoServer)

**Hard rules**:
- Fix one bug at a time — never bundle multiple bugs in one PR
- After fixing each bug: update `BUG_REPORT.md` status field from `PENDING` to `FIXED`
- Write a regression note explaining how to detect if this bug regresses
- State the root cause in exactly one sentence before writing any fix
- Cross-reference GLOBAL_CONTEXT.md Section 7 (Critical Invariants) before applying any fix