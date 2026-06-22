---
description: Wire one stub MCP tool in mcpServer.js to a real implementation
---

Read dist/AI_LAYER_CONTEXT.md — specifically Section 2 (mcpServer.js description) and Section 5 (MCP Tool Manifest).
Read dist/mcpServer.js completely.
Read dist/orchestrator.js dispatchMcpToolCall() to understand how live tools already work.
Read GLOBAL_WORKFLOW.md Section 4 (all request/response flows).
Ask the user which tool to wire: a. fetchLiveInfrastructureMetrics — query MongoDB server_health b. traceRepositoryCommitHistory — query git log via child_process c. executeClusterCacheFlush — POST to /api/mitigate on server.ts d. requestHumanOverrideClearance — real HITL pipeline
For the selected tool, produce an Implementation Plan Artifact:
Current stub behavior (what it does now)
Proposed real behavior (what it should do)
External dependencies (MongoDB, git, HTTP)
Files to change: mcpServer.js + any helper
Impact on the live orchestrator.js (does the live tool in dispatchMcpToolCall need updating too?)
Does this need a new env var? If yes, add to .env.example and render.yaml.
CRITICAL for mcpServer.js:
This file uses ESM (import/export)
The main-module guard MUST remain: bootstrapAetherNexusControlPlane() only runs when import.meta.url === pathToFileURL(process.argv[1]).href
Real implementations must NOT call server.ts endpoints (mcpServer.js is standalone stdio)
Real implementations must connect to MongoDB directly via MONGODB_URI env var
Show the plan and ask: "Type GO to implement."
After GO: implement and show diff of every changed line.
Update dist/AI_LAYER_CONTEXT.md Section 10 (Open Milestones): mark the wired tool as DONE.
Update GLOBAL_CONTEXT.md Section 8 (Pending Work): mark the milestone as complete. // turbo git add dist/mcpServer.js dist/AI_LAYER_CONTEXT.md GLOBAL_CONTEXT.md // turbo git commit -m "feat(mcp): wire [TOOL_NAME] to real implementation"
