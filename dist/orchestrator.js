import "dotenv/config";
import OpenAI from "openai";
import { emitArchitecturalThoughtStreamPacket, bootstrapEgressBroadcastServer, } from "./egressBroadcaster.js";
// ─── Environment Validation ────────────────────────────────────────────────────
const resolvedOpenAiApiKey = process.env["OPENAI_API_KEY"];
const resolvedOrchestratorModel = process.env["AETHERNEXUS_ORCHESTRATOR_MODEL"] ?? "gpt-4o";
const resolvedDomain1IngressBaseUrl = process.env["DOMAIN1_TELEMETRY_INGRESS_BASE_URL"] ??
    "http://localhost:3001";
const resolvedPollingIntervalMs = parseInt(process.env["AETHERNEXUS_POLLING_INTERVAL_MS"] ?? "10000", 10);
if (!resolvedOpenAiApiKey) {
    console.error("[ORCHESTRATOR_ENV_VALIDATION_EXCEPTION] OPENAI_API_KEY is not defined in the runtime environment.");
    process.exit(1);
}
// ─── LLM Client Initialization (Groq-compatible via OpenAI SDK baseURL hijack) ─
const resolvedLlmGatewayBaseUrl = process.env["OPENAI_BASE_URL"] ?? "https://api.groq.com/openai/v1";
if (!resolvedOpenAiApiKey.startsWith("gsk_")) {
    console.error("[WARNING_CONFIG_MISMATCH] API key does not match Groq signature pattern.");
}
const aetherNexusLlmClient = new OpenAI({
    apiKey: resolvedOpenAiApiKey,
    baseURL: resolvedLlmGatewayBaseUrl,
});
// ─── SOP System Prompt (sourced from skills.md §3 & §4 + PROJECT_SPECS §1) ────
const AUTONOMOUS_CONTROL_PLANE_SYSTEM_PROMPT = `
You are the AetherNexus Autonomous AI Control Plane — a production-grade, self-healing multi-region infrastructure simulation engine.

## Operational Mandate
You continuously evaluate live cluster telemetry ingested from the Domain 1 simulation backend. Your role is to autonomously detect processing bottlenecks, classify incident severity, and dispatch the appropriate mitigation action using your authorized toolset.

## Standard Operating Procedures (SOP)

### Threat Classification Matrix
- computeLoadPercentage >= 90 OR clusterOperationalStatus === "CRITICAL" → incidentThreatLevel: CRITICAL_RED → Autonomous Action: executeClusterCacheFlush, then requestHumanOverrideClearance
- computeLoadPercentage >= 70 OR clusterOperationalStatus === "DEGRADED" → incidentThreatLevel: WARNING_AMBER → Autonomous Action: traceRepositoryCommitHistory to correlate recent deployments
- computeLoadPercentage < 70 AND clusterOperationalStatus === "STABLE" → incidentThreatLevel: NOMINAL_GREEN → Autonomous Action: fetchLiveInfrastructureMetrics (continue passive monitoring)

### Execution Constraints
- You MUST call tools sequentially. Never parallelize destructive operations (cache flushes, override requests).
- For CRITICAL_RED incidents: always call executeClusterCacheFlush BEFORE requestHumanOverrideClearance.
- flushOperationAcknowledgementToken must be a newly generated UUIDv4 per incident.
- requestingAgentIdentifier must always be "Surya-AI-Core".
- incidentClassificationCode format: INC-[6 alphanumeric chars] — generate a unique code per incident.

### Variable Naming
- Use precise, domain-descriptive identifiers in your reasoning. Banned terms: data, info, temp, obj, item, val, res.

### Output Format
After each evaluation cycle, summarize your reasoning and any dispatched actions as a structured JSON object in your final message matching the egress broadcast schema:
{
  "eventTimestamp": "<ISO8601>",
  "principalArchitect": "Surya-AI-Core",
  "executedMitigationAction": "<description>",
  "incidentThreatLevelColor": "<CRITICAL_RED | WARNING_AMBER | NOMINAL_GREEN>"
}
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
];
// ─── Domain 1 Ingress Mock (replaced by live HTTP in Milestone 2.3) ───────────
async function simulateDomain1TelemetryIngress() {
    // [MILESTONE 2.3] — Replace with live fetch from resolvedDomain1IngressBaseUrl.
    // Mock simulates a CRITICAL euWest scenario to exercise the full SOP pipeline.
    void resolvedDomain1IngressBaseUrl; // suppress unused-var until wired
    const regionalTelemetrySnapshot = {
        usEastCluster: {
            computeLoadPercentage: 45.2,
            volatileMemoryAllocationGb: 8.1,
            clusterOperationalStatus: "STABLE",
        },
        euWestCluster: {
            computeLoadPercentage: 92.0,
            volatileMemoryAllocationGb: 14.5,
            clusterOperationalStatus: "CRITICAL",
        },
        apSouthCluster: {
            computeLoadPercentage: 12.1,
            volatileMemoryAllocationGb: 4.2,
            clusterOperationalStatus: "STABLE",
        },
    };
    return regionalTelemetrySnapshot;
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
                            authorIdentity: "surya@aethernexus.io",
                            commitTimestamp: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
                            commitMessageSummary: "perf(euWest): increase cache TTL for session-store namespace",
                        },
                        {
                            commitSha: "b7e2d45",
                            authorIdentity: "surya@aethernexus.io",
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
                // [LIVE] — Wire to Domain 1 cache invalidation endpoint in production.
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
                    principalArchitect: "Surya-AI-Core",
                    executedMitigationAction: `Cache flush dispatched on ${cacheFlushDirective.targetClusterRegion} — namespace: ${cacheFlushDirective.cacheLayerNamespace}`,
                    incidentThreatLevelColor: "CRITICAL_RED",
                };
                emitArchitecturalThoughtStreamPacket(cacheFlushBroadcastPacket);
                return JSON.stringify(cacheFlushAcknowledgement);
            }
            case "requestHumanOverrideClearance": {
                const overrideClearanceRequest = JSON.parse(toolArgumentsJson);
                // [LIVE] — Wire to HITL authorization service in production.
                const overrideClearanceAcknowledgement = {
                    clearanceRequestStatus: "PENDING_HUMAN_AUTHORIZATION",
                    incidentClassificationCode: overrideClearanceRequest.incidentClassificationCode,
                    autonomousDecisionRiskLevel: overrideClearanceRequest.autonomousDecisionRiskLevel,
                    requestingAgentIdentifier: overrideClearanceRequest.requestingAgentIdentifier,
                    clearanceRequestTimestamp: new Date().toISOString(),
                    estimatedAuthorizationWindowMs: 300000,
                };
                console.error(`[MCP_HUMAN_OVERRIDE_REQUESTED] Incident: ${overrideClearanceRequest.incidentClassificationCode} | Risk: ${overrideClearanceRequest.autonomousDecisionRiskLevel}`);
                const overrideClearanceBroadcastPacket = {
                    eventTimestamp: new Date().toISOString(),
                    principalArchitect: "Surya-AI-Core",
                    executedMitigationAction: `Human override clearance requested — Incident: ${overrideClearanceRequest.incidentClassificationCode} | Risk: ${overrideClearanceRequest.autonomousDecisionRiskLevel}`,
                    incidentThreatLevelColor: "CRITICAL_RED",
                };
                emitArchitecturalThoughtStreamPacket(overrideClearanceBroadcastPacket);
                return JSON.stringify(overrideClearanceAcknowledgement);
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
    try {
        while (true) {
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
            mutatingConversationThread.push(assistantReasoningMessage);
            if (primaryCompletionChoice.finish_reason === "stop") {
                break;
            }
            if (primaryCompletionChoice.finish_reason === "tool_calls" &&
                assistantReasoningMessage.tool_calls) {
                for (const pendingToolInvocation of assistantReasoningMessage.tool_calls) {
                    if (pendingToolInvocation.type === "function") {
                        console.error(`[ORCHESTRATOR_TOOL_DISPATCH] Invoking: ${pendingToolInvocation.function.name} | Args: ${pendingToolInvocation.function.arguments}`);
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
    }
    catch (agenticCycleExecutionException) {
        console.error("[ORCHESTRATOR_AGENTIC_CYCLE_EXCEPTION]", agenticCycleExecutionException);
    }
    return mutatingConversationThread;
}
// ─── Infrastructure Evaluation Loop (10s polling cadence) ─────────────────────
export async function infrastructureEvaluationLoop() {
    console.error("[ORCHESTRATOR_BOOTSTRAP] AetherNexus Autonomous Orchestrator — Evaluation loop initialized.");
    const executeEvaluationCycle = async () => {
        console.error(`[ORCHESTRATOR_CYCLE_START] Timestamp: ${new Date().toISOString()}`);
        try {
            const currentTelemetrySnapshot = await simulateDomain1TelemetryIngress();
            const telemetryContextMessage = {
                role: "user",
                content: `Evaluate the following live infrastructure telemetry snapshot and execute the appropriate SOP actions:\n\n${JSON.stringify({ infrastructureState: currentTelemetrySnapshot }, null, 2)}`,
            };
            const initialConversationThread = [
                {
                    role: "system",
                    content: AUTONOMOUS_CONTROL_PLANE_SYSTEM_PROMPT,
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
                    const jsonExtractionMatch = terminalLlmOutputText.match(/\{[\s\S]*?"incidentThreatLevelColor"[\s\S]*?\}/);
                    if (jsonExtractionMatch?.[0]) {
                        const parsedLlmEgressDirective = JSON.parse(jsonExtractionMatch[0]);
                        const architecturalThoughtStreamPacket = {
                            eventTimestamp: parsedLlmEgressDirective.eventTimestamp ??
                                new Date().toISOString(),
                            principalArchitect: parsedLlmEgressDirective.principalArchitect ?? "Surya-AI-Core",
                            executedMitigationAction: parsedLlmEgressDirective.executedMitigationAction ??
                                "Autonomous evaluation cycle completed — no critical action required.",
                            incidentThreatLevelColor: parsedLlmEgressDirective.incidentThreatLevelColor ??
                                "NOMINAL_GREEN",
                        };
                        emitArchitecturalThoughtStreamPacket(architecturalThoughtStreamPacket);
                    }
                    else {
                        // LLM did not embed a structured JSON block — emit a NOMINAL fallback.
                        const nominalCycleBroadcastPacket = {
                            eventTimestamp: new Date().toISOString(),
                            principalArchitect: "Surya-AI-Core",
                            executedMitigationAction: "Evaluation cycle completed — infrastructure nominal.",
                            incidentThreatLevelColor: "NOMINAL_GREEN",
                        };
                        emitArchitecturalThoughtStreamPacket(nominalCycleBroadcastPacket);
                    }
                }
                catch (egressPacketParseException) {
                    console.error("[SOCKET_EGRESS_PACKET_PARSE_EXCEPTION]", egressPacketParseException);
                }
            }
        }
        catch (evaluationCycleException) {
            console.error("[ORCHESTRATOR_EVALUATION_CYCLE_EXCEPTION]", evaluationCycleException);
        }
        console.error(`[ORCHESTRATOR_CYCLE_END] Next cycle in ${resolvedPollingIntervalMs}ms.`);
    };
    // Execute immediately on startup, then on interval.
    await executeEvaluationCycle();
    setInterval(() => {
        void executeEvaluationCycle();
    }, resolvedPollingIntervalMs);
}
// ─── Entrypoint Guard ──────────────────────────────────────────────────────────
bootstrapEgressBroadcastServer()
    .then(() => infrastructureEvaluationLoop())
    .catch((fatalBootstrapException) => {
    console.error("[ORCHESTRATOR_FATAL_BOOTSTRAP_EXCEPTION]", fatalBootstrapException);
    process.exit(1);
});
//# sourceMappingURL=orchestrator.js.map