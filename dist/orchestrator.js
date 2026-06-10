import * as dotenv from "dotenv"; dotenv.config({ override: true });
import OpenAI from "openai";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { emitArchitecturalThoughtStreamPacket, bootstrapEgressBroadcastServer, writeAiLog, getLiveTelemetry } from "./egressBroadcaster.js";
let isSystemPaused = false;
// ─── Environment Validation & Key Pool Initialization ──────────
const resolvedOrchestratorModel = process.env["AETHERNEXUS_ORCHESTRATOR_MODEL"] ?? "llama3-8b-8192";
const resolvedDomain1IngressBaseUrl = process.env["DOMAIN1_TELEMETRY_INGRESS_BASE_URL"] ?? "http://localhost:3001";
const resolvedPollingIntervalMs = parseInt(process.env["AETHERNEXUS_POLLING_INTERVAL_MS"] ?? "15000", 10);
const resolvedLlmGatewayBaseUrl = process.env["OPENAI_BASE_URL"] ?? "https://api.groq.com/openai/v1";

const groqKeyPool = [
    process.env["OPENAI_API_KEY"],
    process.env["OPENAI_API_KEY2"],
    process.env["OPENAI_API_KEY3"]
].filter((key) => key && key.startsWith("gsk_"));

if (groqKeyPool.length === 0) {
    console.error("[ORCHESTRATOR_ENV_VALIDATION_EXCEPTION] No valid OPENAI_API_KEYs (gsk_ pattern) found in the runtime environment.");
    process.exit(1);
}

let currentKeyIndex = 0;
const clusterMitigationCycles = {};

let aetherNexusLlmClient = new OpenAI({
    apiKey: groqKeyPool[currentKeyIndex],
    baseURL: resolvedLlmGatewayBaseUrl,
});

function rotateOpenAiKey() {
    currentKeyIndex = (currentKeyIndex + 1) % groqKeyPool.length;
    console.error(`[ORCHESTRATOR_KEY_ROTATION] TPM limit reached on active key. Rerouting neural pathways to backup key...`);
    aetherNexusLlmClient = new OpenAI({
        apiKey: groqKeyPool[currentKeyIndex],
        baseURL: resolvedLlmGatewayBaseUrl,
    });
}
// ─── SOP System Prompt (sourced from skills.md §3 & §4 + PROJECT_SPECS §1) ────
const AUTONOMOUS_CONTROL_PLANE_SYSTEM_PROMPT = `
You are the AetherNexus Autonomous AI Control Plane — a production-grade, self-healing multi-region infrastructure simulation engine.

## Operational Mandate
You continuously evaluate live cluster telemetry ingested from the Domain 1 simulation backend. Your role is to autonomously detect processing bottlenecks, classify incident severity, and dispatch the appropriate mitigation action using your authorized toolset.

## Standard Operating Procedures (SOP)

### Threat Classification Matrix
- computeLoadPercentage >= 90 OR clusterOperationalStatus === "CRITICAL" → incidentThreatLevel: CRITICAL_RED → Autonomous Action: executeClusterCacheFlush, then requestHumanOverrideClearance
- computeLoadPercentage >= 75 OR clusterOperationalStatus === "DEGRADED" → incidentThreatLevel: WARNING_AMBER → Autonomous Action: traceRepositoryCommitHistory to correlate recent deployments
- computeLoadPercentage < 75 AND clusterOperationalStatus === "STABLE" → incidentThreatLevel: NOMINAL_GREEN → Autonomous Action: fetchLiveInfrastructureMetrics (continue passive monitoring)

### Execution Constraints
- You MUST call tools sequentially. Never parallelize destructive operations (cache flushes, override requests).
- For CRITICAL_RED incidents: always call executeClusterCacheFlush BEFORE requestHumanOverrideClearance.
- flushOperationAcknowledgementToken must be a newly generated 6-character alphanumeric ID per incident.
- requestingAgentIdentifier must always be "AetherNexus-Core".
- incidentClassificationCode format: INC-[6 alphanumeric chars] — generate a unique code per incident.

### Variable Naming
- Use precise, domain-descriptive identifiers in your reasoning. Banned terms: data, info, temp, obj, item, val, res.

### Agentic Directives
- If CPU exceeds 90% or Status is CRITICAL, you MUST NOT passively report it. You MUST execute a mitigation function from your available tools (e.g., \`executeClusterCacheFlush\` or \`executeLoadBalancing\`).
- If the situation is ambiguous, you MUST use diagnostic tools (e.g., \`traceRepositoryCommitHistory\`) to gather more context before acting.
- Do NOT output static JSON summaries. Use the appropriate MCP tools directly to enact changes. The backend will handle packaging the final state.

### Routing Logic
If a cluster is flagged as CRITICAL_RED, its traffic distribution MUST drop to 0.0. The remaining traffic must be divided equally among the healthy clusters. Once healed (NOMINAL_GREEN), the traffic must return to an even split.
`.trim();
// ─── MCP Tool Manifest (mirrors mcpServer.ts registrations exactly) ───────────
const aetherNexusMcpToolManifest = [
    {
        type: "function",
        function: {
            name: "fetchLiveInfrastructureMetrics",
            description: "Queries real-time multi-region cluster telemetry from the Domain 1 simulation backend. Returns compute load, volatile memory allocation, and operational status per cluster node.",
            parameters: {
                type: "object",
                properties: {
                    targetClusterRegion: {
                        type: "string",
                        enum: ["usEastCluster", "euWestCluster", "apSouthCluster"],
                        description: "Scoped cluster region to query. Omit to retrieve global multi-region snapshot.",
                    },
                    telemetrySamplingIntervalMs: {
                        type: "number",
                        description: "Polling interval in milliseconds for metric ingestion.",
                        default: 5000,
                    },
                },
                required: [],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "traceRepositoryCommitHistory",
            description: "Traverses a target repository's commit graph up to a configurable depth, with optional author identity filtering. Used by the orchestration layer for autonomous change correlation.",
            parameters: {
                type: "object",
                properties: {
                    repositoryNamespace: {
                        type: "string",
                        description: "Fully-qualified repository namespace (e.g. 'org/repo-name').",
                    },
                    commitLookbackDepth: {
                        type: "number",
                        description: "Maximum number of commits to traverse from HEAD.",
                        default: 50,
                    },
                    authorIdentityFilter: {
                        type: "string",
                        description: "Optional author email to narrow commit attribution scope.",
                    },
                },
                required: ["repositoryNamespace"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "executeClusterCacheFlush",
            description: "Issues a destructive cache flush directive to a specified cluster region and cache namespace. Requires a pre-authorized acknowledgement token to prevent unintended execution.",
            parameters: {
                type: "object",
                properties: {
                    targetClusterRegion: {
                        type: "string",
                        enum: ["usEastCluster", "euWestCluster", "apSouthCluster"],
                        description: "Target cluster region where the cache flush directive will be applied.",
                    },
                    cacheLayerNamespace: {
                        type: "string",
                        description: "Logical cache namespace identifier (e.g. 'session-store', 'query-cache').",
                    },
                    flushOperationAcknowledgementToken: {
                        type: "string",
                        description: "Pre-authorized UUID token confirming destructive flush authorization.",
                    },
                },
                required: [
                    "targetClusterRegion",
                    "cacheLayerNamespace",
                    "flushOperationAcknowledgementToken",
                ],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "requestHumanOverrideClearance",
            description: "Halts autonomous execution and dispatches a structured clearance request to the human-in-the-loop authorization pipeline. Blocks pending action until override token is issued.",
            parameters: {
                type: "object",
                properties: {
                    incidentClassificationCode: {
                        type: "string",
                        description: "Structured incident identifier in INC-XXXXXX format for audit trail linkage.",
                    },
                    mitigationActionSummary: {
                        type: "string",
                        description: "Detailed human-readable description of the autonomous action requiring clearance.",
                    },
                    autonomousDecisionRiskLevel: {
                        type: "string",
                        enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
                        description: "AI-assessed risk classification of the pending action.",
                    },
                    requestingAgentIdentifier: {
                        type: "string",
                        description: "Canonical identifier of the autonomous agent requesting override.",
                    },
                },
                required: [
                    "incidentClassificationCode",
                    "mitigationActionSummary",
                    "autonomousDecisionRiskLevel",
                    "requestingAgentIdentifier",
                ],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "executeLoadBalancing",
            description: "Diverts traffic away from a failing cluster region.",
            parameters: {
                type: "object",
                properties: {
                    targetClusterRegion: {
                        type: "string",
                        enum: ["usEastCluster", "euWestCluster", "apSouthCluster"],
                        description: "Target cluster region.",
                    }
                },
                required: ["targetClusterRegion"],
            },
        },
    },
];
async function simulateDomain1TelemetryIngress() {
    try {
        const liveData = await getLiveTelemetry();
        if (liveData) return liveData;
    } catch(e) {
        console.error("Telemetry fetch from MongoDB failed", e);
    }
    return {
        usEastCluster: { computeLoadPercentage: 25, volatileMemoryAllocationGb: 4, clusterOperationalStatus: "STABLE" },
        euWestCluster: { computeLoadPercentage: 25, volatileMemoryAllocationGb: 4, clusterOperationalStatus: "STABLE" },
        apSouthCluster: { computeLoadPercentage: 25, volatileMemoryAllocationGb: 4, clusterOperationalStatus: "STABLE" },
    };
}
// ─── MCP Tool Execution Dispatcher ────────────────────────────────────────────
async function dispatchMcpToolCall(toolInvocationRequest) {
    if (toolInvocationRequest.type !== "function") {
        return JSON.stringify({ dispatchFailureReason: "Non-function tool call type is unsupported." });
    }
    const toolArgumentsJson = toolInvocationRequest.function.arguments;
    const dispatchedToolName = toolInvocationRequest.function.name;
    try {
        switch (dispatchedToolName) {
            case "fetchLiveInfrastructureMetrics": {
                const metricsQueryDirective = JSON.parse(toolArgumentsJson);
                const regionalTelemetrySnapshot = await simulateDomain1TelemetryIngress();
                const scopedClusterRegion = metricsQueryDirective.targetClusterRegion;
                if (scopedClusterRegion) {
                    return JSON.stringify({
                        infrastructureState: {
                            [scopedClusterRegion]: regionalTelemetrySnapshot[scopedClusterRegion],
                        },
                    });
                }
                return JSON.stringify({ infrastructureState: regionalTelemetrySnapshot });
            }
            case "traceRepositoryCommitHistory": {
                const commitTraceDirective = JSON.parse(toolArgumentsJson);
                // [MILESTONE 2.3] — Wire to live VCS API endpoint.
                const mockedCommitGraphSummary = {
                    repositoryNamespace: commitTraceDirective.repositoryNamespace,
                    traversedCommitDepth: commitTraceDirective.commitLookbackDepth ?? 50,
                    recentCommitRecords: [
                        {
                            commitSha: "a3f9c12",
                            authorIdentity: "aethernexus@aethernexus.io",
                            commitTimestamp: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
                            commitMessageSummary: "perf(euWest): increase cache TTL for session-store namespace",
                        },
                        {
                            commitSha: "b7e2d45",
                            authorIdentity: "aethernexus@aethernexus.io",
                            commitTimestamp: new Date(Date.now() - 1000 * 60 * 47).toISOString(),
                            commitMessageSummary: "fix(euWest): patch volatile memory leak in ingress router",
                        },
                    ],
                    authorIdentityFilter: commitTraceDirective.authorIdentityFilter ?? null,
                };
                return JSON.stringify(mockedCommitGraphSummary);
            }
            case "executeClusterCacheFlush": {
                const cacheFlushDirective = JSON.parse(toolArgumentsJson);
                if (clusterMitigationCycles[cacheFlushDirective.targetClusterRegion] !== undefined) {
                    clusterMitigationCycles[cacheFlushDirective.targetClusterRegion] = 4;
                }
                // [LIVE] — Wire to Domain 1 cache invalidation endpoint in production.
                try {
                    await fetch(`${resolvedDomain1IngressBaseUrl}/api/mitigate`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(cacheFlushDirective)
                    });
                } catch(e) {}
                const cacheFlushAcknowledgement = {
                    flushDispatchStatus: "ACKNOWLEDGED",
                    targetClusterRegion: cacheFlushDirective.targetClusterRegion,
                    cacheLayerNamespace: cacheFlushDirective.cacheLayerNamespace,
                    acknowledgedAuthorizationToken: cacheFlushDirective.flushOperationAcknowledgementToken,
                    flushExecutionTimestamp: new Date().toISOString(),
                };
                console.error(`[MCP_CACHE_FLUSH_DISPATCHED] Region: ${cacheFlushDirective.targetClusterRegion} | Namespace: ${cacheFlushDirective.cacheLayerNamespace}`);
                const cacheFlushBroadcastPacket = {
                    eventTimestamp: new Date().toISOString(),
                    principalArchitect: "AetherNexus-Core",
                    executedMitigationAction: `Cache flush dispatched on ${cacheFlushDirective.targetClusterRegion} — namespace: ${cacheFlushDirective.cacheLayerNamespace}. Healing initiated.`,
                    incidentThreatLevelColor: "HEALING",
                    healingProgress: 0,
                    targetClusterRegion: cacheFlushDirective.targetClusterRegion,
                };
                emitArchitecturalThoughtStreamPacket(cacheFlushBroadcastPacket);

                (async () => {
                    for (let progress = 25; progress <= 100; progress += 25) {
                        await new Promise(r => setTimeout(r, 500));
                        if (progress === 100) {
                            try { await fetch(`${resolvedDomain1IngressBaseUrl}/api/chaos/reset`, { method: "POST" }); } catch(e) {}
                            emitArchitecturalThoughtStreamPacket({
                                eventTimestamp: new Date().toISOString(),
                                principalArchitect: "AetherNexus-Core",
                                executedMitigationAction: `Healing complete on ${cacheFlushDirective.targetClusterRegion}. Systems nominal.`,
                                incidentThreatLevelColor: "NOMINAL_GREEN",
                                healingProgress: null,
                                targetClusterRegion: cacheFlushDirective.targetClusterRegion,
                                trafficDistribution: { usEastCluster: 0.33, euWestCluster: 0.33, apSouthCluster: 0.34 }
                            });
                        } else {
                            emitArchitecturalThoughtStreamPacket({
                                eventTimestamp: new Date().toISOString(),
                                principalArchitect: "AetherNexus-Core",
                                executedMitigationAction: `Healing in progress on ${cacheFlushDirective.targetClusterRegion}...`,
                                incidentThreatLevelColor: "HEALING",
                                healingProgress: progress,
                                targetClusterRegion: cacheFlushDirective.targetClusterRegion
                            });
                        }
                    }
                })();

                return JSON.stringify(cacheFlushAcknowledgement);
            }
            case "requestHumanOverrideClearance": {
                isSystemPaused = true;
                const overrideClearanceRequest = JSON.parse(toolArgumentsJson);
                let targetRegion = overrideClearanceRequest.targetClusterRegion || "usEastCluster";
                if (overrideClearanceRequest.mitigationActionSummary?.includes("euWestCluster")) targetRegion = "euWestCluster";
                if (overrideClearanceRequest.mitigationActionSummary?.includes("apSouthCluster")) targetRegion = "apSouthCluster";
                if (overrideClearanceRequest.mitigationActionSummary?.includes("usEastCluster")) targetRegion = "usEastCluster";
                
                // [LIVE] — Wire to HITL authorization service in production.
                const overrideClearanceAcknowledgement = {
                    clearanceRequestStatus: "PENDING_HUMAN_AUTHORIZATION",
                    incidentClassificationCode: overrideClearanceRequest.incidentClassificationCode,
                    autonomousDecisionRiskLevel: overrideClearanceRequest.autonomousDecisionRiskLevel,
                    requestingAgentIdentifier: overrideClearanceRequest.requestingAgentIdentifier,
                    targetClusterRegion: targetRegion,
                    clearanceRequestTimestamp: new Date().toISOString(),
                    estimatedAuthorizationWindowMs: 300000,
                };
                console.error(`[MCP_HUMAN_OVERRIDE_REQUESTED] Incident: ${overrideClearanceRequest.incidentClassificationCode} | Risk: ${overrideClearanceRequest.autonomousDecisionRiskLevel}`);
                const overrideClearanceBroadcastPacket = {
                    eventTimestamp: new Date().toISOString(),
                    principalArchitect: "AetherNexus-Core",
                    executedMitigationAction: `Human override clearance requested — Incident: ${overrideClearanceRequest.incidentClassificationCode} | Risk: ${overrideClearanceRequest.autonomousDecisionRiskLevel}`,
                    incidentThreatLevelColor: "CRITICAL_RED",
                    targetClusterRegion: targetRegion,
                };
                emitArchitecturalThoughtStreamPacket(overrideClearanceBroadcastPacket);
                return JSON.stringify(overrideClearanceAcknowledgement);
            }
            case "executeLoadBalancing": {
                const loadBalanceDirective = JSON.parse(toolArgumentsJson);
                if (clusterMitigationCycles[loadBalanceDirective.targetClusterRegion] !== undefined) {
                    clusterMitigationCycles[loadBalanceDirective.targetClusterRegion] = 4;
                }
                
                try {
                    await fetch(`${resolvedDomain1IngressBaseUrl}/api/rebalance`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            sourceRegion: loadBalanceDirective.targetClusterRegion,
                            targetRegion: loadBalanceDirective.targetClusterRegion === "euWestCluster" ? "usEastCluster" : "euWestCluster",
                            trafficShiftPercentage: 50
                        })
                    });
                } catch(e) {}

                const loadBalanceAcknowledgement = {
                    dispatchStatus: "ACKNOWLEDGED",
                    targetClusterRegion: loadBalanceDirective.targetClusterRegion,
                    executionTimestamp: new Date().toISOString(),
                };
                console.error(`[MCP_LOAD_BALANCE_DISPATCHED] Region: ${loadBalanceDirective.targetClusterRegion}`);
                const loadBalanceBroadcastPacket = {
                    eventTimestamp: new Date().toISOString(),
                    principalArchitect: "AetherNexus-Core",
                    executedMitigationAction: `Load balancing executed on ${loadBalanceDirective.targetClusterRegion}`,
                    incidentThreatLevelColor: "NOMINAL_GREEN",
                };
                emitArchitecturalThoughtStreamPacket(loadBalanceBroadcastPacket);
                return JSON.stringify(loadBalanceAcknowledgement);
            }
            default: {
                console.error(`[MCP_TOOL_DISPATCH_UNKNOWN_TOOL_EXCEPTION] Unrecognized tool name: ${dispatchedToolName}`);
                return JSON.stringify({
                    dispatchFailureReason: `Unrecognized tool identifier: ${dispatchedToolName}`,
                });
            }
        }
    }
    catch (mcpToolDispatchException) {
        console.error(`[MCP_TOOL_DISPATCH_EXECUTION_EXCEPTION] Tool: ${dispatchedToolName}`, mcpToolDispatchException);
        writeAiLog({
            text: `[AI] ERROR: Tool ${dispatchedToolName} failed - ${mcpToolDispatchException instanceof Error ? mcpToolDispatchException.message : 'Unknown error'}`,
            level: 'critical',
            timestamp: new Date().toISOString(),
            architect: 'AetherNexus-Core'
        });
        return JSON.stringify({
            dispatchFailureReason: mcpToolDispatchException instanceof Error
                ? mcpToolDispatchException.message
                : "Unknown dispatch execution fault.",
        });
    }
}
// ─── Agentic Tool-Calling Loop ─────────────────────────────────────────────────
async function executeAgenticReasoningCycle(activeConversationThread) {
    const mutatingConversationThread = [...activeConversationThread];
    let retryCount = 0;
    const MAX_RETRIES = groqKeyPool.length;

    while (retryCount <= MAX_RETRIES) {
        try {
            let stepCount = 0;
            while (true) {
                stepCount++;
                if (stepCount > 5) {
                    console.error("[ORCHESTRATOR_AGENTIC_CYCLE_EXCEPTION] Maximum agentic reasoning steps exceeded.");
                    break;
                }
                const llmCompletionResponse = await aetherNexusLlmClient.chat.completions.create({
                    model: resolvedOrchestratorModel,
                    messages: mutatingConversationThread,
                    tools: aetherNexusMcpToolManifest,
                    tool_choice: "auto",
                });
                const primaryCompletionChoice = llmCompletionResponse.choices[0];
                if (!primaryCompletionChoice) {
                    console.error("[ORCHESTRATOR_LLM_COMPLETION_EXCEPTION] LLM returned zero completion choices. Aborting reasoning cycle.");
                    break;
                }
                const assistantReasoningMessage = primaryCompletionChoice.message;
                console.error('[DIAGNOSTIC - LLM RAW RESPONSE]:', JSON.stringify(assistantReasoningMessage, null, 2));
                mutatingConversationThread.push(assistantReasoningMessage);
                if (primaryCompletionChoice.finish_reason === "stop") {
                    break;
                }
                if (primaryCompletionChoice.finish_reason === "tool_calls" &&
                    assistantReasoningMessage.tool_calls) {
                    for (const pendingToolInvocation of assistantReasoningMessage.tool_calls) {
                        if (pendingToolInvocation.type === "function") {
                            console.error(`[ORCHESTRATOR_TOOL_DISPATCH] Invoking: ${pendingToolInvocation.function.name} | Args: ${pendingToolInvocation.function.arguments}`);
                            writeAiLog({
                                text: `[AI TOOL] Invoking ${pendingToolInvocation.function.name}`,
                                level: pendingToolInvocation.function.name === 'executeClusterCacheFlush' ? 'warning'
                                     : pendingToolInvocation.function.name === 'requestHumanOverrideClearance' ? 'critical'
                                     : 'info',
                                timestamp: new Date().toISOString(),
                                architect: 'AetherNexus-Core',
                            });
                        }
                        const toolExecutionOutputJson = await dispatchMcpToolCall(pendingToolInvocation);
                        mutatingConversationThread.push({
                            role: "tool",
                            tool_call_id: pendingToolInvocation.id,
                            content: toolExecutionOutputJson,
                        });
                    }
                    continue;
                }
                break;
            }
            return mutatingConversationThread; // Success
        }
        catch (agenticCycleExecutionException) {
            if (agenticCycleExecutionException?.status === 429 || agenticCycleExecutionException?.code === "rate_limit_exceeded") {
                retryCount++;
                if (retryCount < MAX_RETRIES) {
                    rotateOpenAiKey();
                    if (mutatingConversationThread[mutatingConversationThread.length - 1]?.role === "system") { mutatingConversationThread.pop(); }
                    continue; // Retry with the new key
                } else {
                    console.error("[ORCHESTRATOR_AGENTIC_CYCLE_EXCEPTION] All keys exhausted via 429 RateLimitError.", agenticCycleExecutionException);
                    break;
                }
            } else {
                console.error("[ORCHESTRATOR_AGENTIC_CYCLE_EXCEPTION]", agenticCycleExecutionException);
                break;
            }
        }
    }
    return mutatingConversationThread;
}
// ─── Infrastructure Evaluation Loop (10s polling cadence) ─────────────────────
console.error("[ORCHESTRATOR_BOOTSTRAP] AetherNexus Autonomous Orchestrator — Evaluation loop initialized.");
async function executeEvaluationCycle() {
    if (isSystemPaused) return;
    console.error(`[ORCHESTRATOR_CYCLE_START] Timestamp: ${new Date().toISOString()}`);
        writeAiLog({ text: '[AI] Evaluation cycle started — ingesting live telemetry snapshot.', level: 'info', timestamp: new Date().toISOString(), architect: 'AetherNexus-Core' });
        try {
            const currentTelemetrySnapshot = await simulateDomain1TelemetryIngress();
            console.error('[DIAGNOSTIC - RAW DB DATA]:', JSON.stringify(currentTelemetrySnapshot, null, 2));
            if (!currentTelemetrySnapshot || Object.keys(currentTelemetrySnapshot).length === 0) {
                writeAiLog({ text: '[AI] ERROR: Database returned empty telemetry snapshot.', level: 'critical', timestamp: new Date().toISOString(), architect: 'AetherNexus-Core' });
            }
            const telemetryContextMessage = {
                role: "user",
                content: `Evaluate the following live infrastructure telemetry snapshot and execute the appropriate SOP actions:\n\n${JSON.stringify({ infrastructureState: currentTelemetrySnapshot }, null, 2)}`,
            };

            const liveEndpoints = `
Live Endpoints:
Gateway: ${process.env.AETHERNEXUS_GATEWAY_URL || "https://aethernexus-gateway.onrender.com"}
US-East: ${process.env.US_EAST_URL || "https://aethernexus-us-east.onrender.com"}
EU-West: ${process.env.EU_WEST_URL || "https://aethernexus-eu-west.onrender.com"}
AP-South: ${process.env.AP_SOUTH_URL || "https://aethernexus-ap-south.onrender.com"}`;

            const dynamicSystemPrompt = `You are the AetherNexus Autonomous Orchestrator. Your exact capabilities are defined in the injected MCP and Skills documentation below. You must ONLY use the tools explicitly defined. You will receive live MongoDB telemetry. If CPU > 90% or Status is CRITICAL, you MUST execute a mitigation tool.

${liveEndpoints}

${AUTONOMOUS_CONTROL_PLANE_SYSTEM_PROMPT}`;

            const initialConversationThread = [
                {
                    role: "system",
                    content: dynamicSystemPrompt,
                },
                telemetryContextMessage,
            ];
            const completedConversationThread = await executeAgenticReasoningCycle(initialConversationThread);
            const terminalAssistantMessage = completedConversationThread
                .filter((conversationTurn) => conversationTurn.role === "assistant")
                .at(-1);
            if (terminalAssistantMessage &&
                typeof terminalAssistantMessage.content === "string") {
                const terminalLlmOutputText = terminalAssistantMessage.content;
                console.error(`[ORCHESTRATOR_CYCLE_COMPLETE] AI Evaluation Summary:\n${terminalLlmOutputText}`);
                // ── Parse LLM-structured egress packet and broadcast to Domain 3 ─────
                try {
                    const firstBrace = terminalLlmOutputText.indexOf('{');
                    const lastBrace = terminalLlmOutputText.lastIndexOf('}');
                    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
                        let cleanJsonString = terminalLlmOutputText.substring(firstBrace, lastBrace + 1);
                        cleanJsonString = cleanJsonString.replace(/```json\n?/g, '').replace(/```\n?/g, '');
                        let parsedLlmEgressDirective;
                        try {
                            parsedLlmEgressDirective = JSON.parse(cleanJsonString);
                        } catch(e) {
                            throw new Error("Invalid JSON parsed from LLM");
                        }

                        const architecturalThoughtStreamPacket = {
                            eventTimestamp: parsedLlmEgressDirective.eventTimestamp ??
                                new Date().toISOString(),
                            principalArchitect: parsedLlmEgressDirective.principalArchitect ?? "AetherNexus-Core",
                            executedMitigationAction: parsedLlmEgressDirective.executedMitigationAction ??
                                "Autonomous evaluation cycle completed — no critical action required.",
                            incidentThreatLevelColor: parsedLlmEgressDirective.incidentThreatLevelColor ??
                                "NOMINAL_GREEN",
                            trafficDistribution: parsedLlmEgressDirective.trafficDistribution ?? {
                                usEastCluster: 0.33,
                                euWestCluster: 0.33,
                                apSouthCluster: 0.34
                            }
                        };
                        emitArchitecturalThoughtStreamPacket(architecturalThoughtStreamPacket);
                    }
                    else {
                        // LLM did not embed a structured JSON block — emit a WARNING_AMBER fallback.
                        const nominalCycleBroadcastPacket = {
                            eventTimestamp: new Date().toISOString(),
                            principalArchitect: "AetherNexus-Core",
                            executedMitigationAction: "AI output unparseable - Human investigation required",
                            incidentThreatLevelColor: "WARNING_AMBER",
                            trafficDistribution: {
                                usEastCluster: 0.33,
                                euWestCluster: 0.33,
                                apSouthCluster: 0.34
                            }
                        };
                        emitArchitecturalThoughtStreamPacket(nominalCycleBroadcastPacket);
                    }
                }
                catch (egressPacketParseException) {
                    console.error("[SOCKET_EGRESS_PACKET_PARSE_EXCEPTION]", egressPacketParseException);
                    const nominalCycleBroadcastPacket = {
                        eventTimestamp: new Date().toISOString(),
                        principalArchitect: "AetherNexus-Core",
                        executedMitigationAction: "AI output unparseable - Human investigation required",
                        incidentThreatLevelColor: "WARNING_AMBER",
                        trafficDistribution: { usEastCluster: 0.33, euWestCluster: 0.33, apSouthCluster: 0.34 }
                    };
                    emitArchitecturalThoughtStreamPacket(nominalCycleBroadcastPacket);
                }
            }
        }
        catch (evaluationCycleException) {
            console.error("[ORCHESTRATOR_EVALUATION_CYCLE_EXCEPTION]", evaluationCycleException);
        }
        console.error(`[ORCHESTRATOR_CYCLE_END] Next cycle in ${resolvedPollingIntervalMs}ms.`);
}

// ─── Entrypoint Guard ──────────────────────────────────────────────────────────
export async function bootOrchestrator() {
    console.error("[ORCHESTRATOR_BOOTSTRAP] Engine ignition. AI evaluation loop starting...");
    await bootstrapEgressBroadcastServer();
    executeEvaluationCycle(); // Run immediately on boot
    setInterval(executeEvaluationCycle, resolvedPollingIntervalMs); // Run every 15 seconds
}
//# sourceMappingURL=orchestrator.js.map