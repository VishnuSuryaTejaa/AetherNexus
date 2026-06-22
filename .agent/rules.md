# AetherNexus (altrosyn) — Antigravity Operating Rules

---

## MANDATORY FIRST ACTION — READ THESE BEFORE ANYTHING ELSE

Every session, every task — no exceptions:
1. Read `GLOBAL_CONTEXT.md` — master index of every file and what it contains
2. Read `GLOBAL_WORKFLOW.md` — how all layers talk to each other (ports, URLs, events, endpoints)
3. Read `BUG_REPORT.md` — all 22 known bugs, their severity, and current status

Do NOT open a file, do NOT write a line of code until these three are read.

---

## PROJECT IDENTITY

| Field | Value |
|---|---|
| Package name | `altrosyn` |
| Project name | AetherNexus |
| Runtime | Node.js — TypeScript source → compiled CommonJS/ESM |
| Database | MongoDB Atlas — cluster: `AlterNexus-Cluster` — database: `altrosyn_db` |
| LLM | Groq API — model: `llama-3.3-70b-versatile` — via OpenAI-compat SDK |
| Frontend | React 19 + Vite 8 — path: `/dashboard/` — deployed to Vercel |
| Realtime | Socket.io v4 |
| Deployment | Render.com — driven by `render.yaml` |

---

## LAYER MAP — KNOW WHERE EVERYTHING LIVES

| Domain | Name | Files | Port |
|---|---|---|---|
| DOMAIN 0 | Database | MongoDB Atlas | N/A |
| DOMAIN 1 | Regional Nodes | `nodes/us-east-node.ts` (3001), `nodes/eu-west-node.ts` (3002), `nodes/ap-south-node.ts` (3004) | 3001, 3002, 3004 |
| DOMAIN 2 | Backend | `server.ts` (4000), `gateway.ts` (3003), `loadbalancer.ts` (library) | 4000, 3003 |
| DOMAIN 3 | AI Layer | `dist/orchestrator.js`, `dist/egressBroadcaster.js`, `dist/mcpServer.js` | runs inside server.ts |
| DOMAIN 4 | Frontend | `dashboard/src/` | 5173 (dev) / Vercel (prod) |

---

## CRITICAL: MODULE SYSTEM BOUNDARIES — NEVER CROSS THESE

**ESM files** (`import`/`export` only):
- `dist/orchestrator.js`
- `dist/egressBroadcaster.js`
- `dist/mcpServer.js`

**CommonJS files** (`require`/`module.exports` only):
- `dist/server.js` ← DO NOT EDIT (compiled artifact)
- `dist/loadbalancer.js` ← DO NOT EDIT (compiled artifact)

**TypeScript sources** (edit these, then compile):
- `server.ts` → compiles to `dist/server.js`
- `loadbalancer.ts` → compiles to `dist/loadbalancer.js`
- `gateway.ts` → compiled separately
- `nodes/*.ts` → compiled separately

**RULE**: Never mix `import` and `require` in the same file. Never edit `dist/server.js` or `dist/loadbalancer.js` directly.

---

## CRITICAL: REGION NAME FORMATS — ALWAYS CHECK WHICH ONE TO USE

| Context | US-East | EU-West | AP-South |
|---|---|---|---|
| MongoDB `server_health` field (nodes write this) | `'US-East'` | `'EU-West'` | `'AP-South'` |
| `egressBroadcaster.js` + `orchestrator.js` + `server.ts` state | `'usEastCluster'` | `'euWestCluster'` | `'apSouthCluster'` |
| `loadbalancer.ts` TrafficDistributionMap + `gateway.ts` routingTable | `'US-East-1'` | `'EU-West-1'` | `'AP-South-1'` |
| `normalizeRegion()` output | `'US-East'` | `'EU-West'` | `'AP-South'` |

**Before any code that touches a region name, look up which format is needed in that layer.**

---

## CRITICAL: BOOT ORDER INVARIANTS — NEVER VIOLATE

1. `setSharedSocket(io)` MUST be called **before** `bootOrchestrator()`
2. `setSharedDb(db)` MUST be called **before** `bootOrchestrator()`
3. Groq API keys MUST start with `gsk_` — process exits at boot if none found
4. Tool sequence for CRITICAL_RED: `executeClusterCacheFlush` FIRST, then `requestHumanOverrideClearance`
5. `isSystemPaused` gate in `executeEvaluationCycle()` must never be removed or bypassed
6. Max agentic steps = 5 — never increase without explicit approval
7. `load_balancer_state` doc `_id` is always `'current_state'` — changing this breaks `getDistributionMap()` and `recalculateRouting()`
8. `mcpServer.js` must NOT be imported by any live runtime code — its bootstrap is guarded by a main-module check

---

## CODING RULES

- Before editing any file, read its **full content** first — no partial reads
- Before changing a cross-layer boundary (socket event name, API endpoint path, MongoDB collection), check ALL consumers of that contract in all layers
- Before touching `server.ts`, mentally trace the full boot sequence to verify the change doesn't break ordering
- Before touching `orchestrator.js`, re-read the `AUTONOMOUS_CONTROL_PLANE_SYSTEM_PROMPT` and the 3-tool manifest
- Every chaos endpoint in `server.ts` MUST call `recalculateRouting(db)` after writing to MongoDB
- When writing to `server_health`, always include: `region`, `computeLoadPercentage`, `volatileMemoryAllocationGb`, `networkPackets`, `clusterOperationalStatus`, `timestamp`
- Never commit `.env` — only `.env.example`
- New environment variables go into BOTH `.env.example` AND `render.yaml`

---

## GIT RULES

- Branch format: `type/BUG-XXX-short-description` (e.g. `fix/BUG-001-ap-south-port`)
- Commit format: `type(scope): description [BUG-XXX]` (e.g. `fix(nodes): move ap-south to port 3004 [BUG-001]`)
- Never commit directly to `main`
- After fixing any bug: update `BUG_REPORT.md` status from `PENDING` to `FIXED` in the same commit

---

## INTERACTION RULES

- Always produce a **Plan Artifact** before writing any code — list every file you will touch
- If a change touches files in more than one Domain: flag it as **CROSS-LAYER CHANGE** and list all affected domains
- After completing any task, report exactly: "Changed: [FILE] — [WHAT CHANGED and WHY]" for every file
- If you discover a new bug not in `BUG_REPORT.md`, add it there immediately before fixing
- If any of the 8 boot invariants above would be violated by a proposed change, STOP and ask