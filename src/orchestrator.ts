import "dotenv/config";
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions.js";

import type {
  FetchLiveInfrastructureMetricsInput,
  TraceRepositoryCommitHistoryInput,
  ExecuteClusterCacheFlushInput,
  RequestHumanOverrideClearanceInput,
  ExecuteLoadBalancingInput,
  InfrastructureStateSnapshot,
} from "./mcpServer.js";
import {
  emitArchitecturalThoughtStreamPacket,
  bootstrapEgressBroadcastServer,
} from "./egressBroadcaster.js";
import type { ArchitecturalThoughtStreamPacket } from "./egressBroadcaster.js";
import mongoose, { Schema, type Document } from "mongoose";

// ─── Environment Validation ────────────────────────────────────────────────────

const resolvedOpenAiApiKey = process.env["OPENAI_API_KEY"];
const resolvedOrchestratorModel =
  process.env["AETHERNEXUS_ORCHESTRATOR_MODEL"] ?? "gpt-4o";
const resolvedPollingIntervalMs = parseInt(
  process.env["AETHERNEXUS_POLLING_INTERVAL_MS"] ?? "10000",
  10
);
const resolvedMongoDbConnectionUri =
  process.env["MONGODB_URI"] ?? "mongodb://localhost:27017/aethernexus";

if (!resolvedOpenAiApiKey) {
  console.error(
    "[ORCHESTRATOR_ENV_VALIDATION_EXCEPTION] OPENAI_API_KEY is not defined in the runtime environment."
  );
  process.exit(1);
}

// ─── LLM Client Initialization (Groq-compatible via OpenAI SDK baseURL hijack) ─

const resolvedLlmGatewayBaseUrl =
  process.env["OPENAI_BASE_URL"] ?? "https://api.groq.com/openai/v1";

if (!resolvedOpenAiApiKey.startsWith("gsk_")) {
  console.error(
    "[WARNING_CONFIG_MISMATCH] API key does not match Groq signature pattern."
  );
}

const aetherNexusLlmClient = new OpenAI({
  apiKey: resolvedOpenAiApiKey,
  baseURL: resolvedLlmGatewayBaseUrl,
});

// ─── MongoDB Connection + ServerHealth Model ─────────────────────────────────────

async function initializeMongoDbConnection(): Promise<void> {
  try {
    await mongoose.connect(resolvedMongoDbConnectionUri);
    console.error(
      `[MONGODB_CONNECTION_SUCCESS] Connected to AetherNexus cluster state store: ${resolvedMongoDbConnectionUri}`
    );
  } catch (mongoDbConnectionException: unknown) {
    console.error(
      "[MONGODB_CONNECTION_EXCEPTION]",
      mongoDbConnectionException
    );
    process.exit(1);
  }
}

interface ServerHealthDocument extends Document {
  regionId: "usEastCluster" | "euWestCluster" | "apSouthCluster";
  computeLoadPercentage: number;
  volatileMemoryAllocationGb: number;
  clusterOperationalStatus: "STABLE" | "DEGRADED" | "CRITICAL";
  recordedAt: Date;
}

const serverHealthMongoSchema = new Schema<ServerHealthDocument>(
  {
    regionId: {
      type: String,
      enum: ["usEastCluster", "euWestCluster", "apSouthCluster"],
      required: true,
      index: true,
    },
    computeLoadPercentage: { type: Number, required: true },
    volatileMemoryAllocationGb: { type: Number, required: true },
    clusterOperationalStatus: {
      type: String,
      enum: ["STABLE", "DEGRADED", "CRITICAL"],
      required: true,
    },
    recordedAt: { type: Date, default: Date.now, index: true },
  },
  { collection: "serverhealth" }
);

const ServerHealthModel =
  (mongoose.models["ServerHealth"] as mongoose.Model<ServerHealthDocument> | undefined) ??
  mongoose.model<ServerHealthDocument>("ServerHealth", serverHealthMongoSchema);

// ─── SOP System Prompt (sourced from skills.md §3 & §4 + PROJECT_SPECS §1) ────

const AUTONOMOUS_CONTROL_PLANE_SYSTEM_PROMPT = `
You are the AetherNexus Autonomous AI Control Plane — a production-grade, self-healing multi-region infrastructure simulation engine.

## Operational Mandate
You continuously evaluate live cluster telemetry ingested from the Domain 1 simulation backend. Your role is to autonomously detect processing bottlenecks, classify incident severity, and dispatch the appropriate mitigation action using your authorized toolset.

## Standard Operating Procedures (SOP)

### Threat Classification Matrix
- computeLoadPercentage >= 90 OR clusterOperationalStatus === "CRITICAL" → incidentThreatLevel: CRITICAL_RED → Autonomous Action: executeClusterCacheFlush, then requestHumanOverrideClearance
- computeLoadPercentage >= 85 AND an adjacent cluster has computeLoadPercentage <= 40 → incidentThreatLevel: WARNING_AMBER → Autonomous Action: executeLoadBalancing to shift 50% traffic to the adjacent cluster
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

const aetherNexusMcpToolManifest: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "fetchLiveInfrastructureMetrics",
      description:
        "Queries real-time multi-region cluster telemetry from the Domain 1 simulation backend. Returns compute load, volatile memory allocation, and operational status per cluster node.",
      parameters: {
        type: "object",
        properties: {
          targetClusterRegion: {
            type: "string",
            enum: ["usEastCluster", "euWestCluster", "apSouthCluster"],
            description:
              "Scoped cluster region to query. Omit to retrieve global multi-region snapshot.",
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
      description:
        "Traverses a target repository's commit graph up to a configurable depth, with optional author identity filtering. Used by the orchestration layer for autonomous change correlation.",
      parameters: {
        type: "object",
        properties: {
          repositoryNamespace: {
            type: "string",
            description:
              "Fully-qualified repository namespace (e.g. 'org/repo-name').",
          },
          commitLookbackDepth: {
            type: "number",
            description: "Maximum number of commits to traverse from HEAD.",
            default: 50,
          },
          authorIdentityFilter: {
            type: "string",
            description:
              "Optional author email to narrow commit attribution scope.",
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
      description:
        "Issues a destructive cache flush directive to a specified cluster region and cache namespace. Requires a pre-authorized acknowledgement token to prevent unintended execution.",
      parameters: {
        type: "object",
        properties: {
          targetClusterRegion: {
            type: "string",
            enum: ["usEastCluster", "euWestCluster", "apSouthCluster"],
            description:
              "Target cluster region where the cache flush directive will be applied.",
          },
          cacheLayerNamespace: {
            type: "string",
            description:
              "Logical cache namespace identifier (e.g. 'session-store', 'query-cache').",
          },
          flushOperationAcknowledgementToken: {
            type: "string",
            description:
              "Pre-authorized UUID token confirming destructive flush authorization.",
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
      description:
        "Halts autonomous execution and dispatches a structured clearance request to the human-in-the-loop authorization pipeline. Blocks pending action until override token is issued.",
      parameters: {
        type: "object",
        properties: {
          incidentClassificationCode: {
            type: "string",
            description:
              "Structured incident identifier in INC-XXXXXX format for audit trail linkage.",
          },
          mitigationActionSummary: {
            type: "string",
            description:
              "Detailed human-readable description of the autonomous action requiring clearance.",
          },
          autonomousDecisionRiskLevel: {
            type: "string",
            enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
            description:
              "AI-assessed risk classification of the pending action.",
          },
          requestingAgentIdentifier: {
            type: "string",
            description:
              "Canonical identifier of the autonomous agent requesting override.",
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
      description:
        "Redistributes inbound request traffic from an overloaded source cluster region to a healthy target cluster region by the specified percentage. Used as a preemptive mitigation before cache flush escalation.",
      parameters: {
        type: "object",
        properties: {
          sourceClusterRegion: {
            type: "string",
            enum: ["usEastCluster", "euWestCluster", "apSouthCluster"],
            description:
              "Overloaded source cluster region from which traffic will be redistributed.",
          },
          targetClusterRegion: {
            type: "string",
            enum: ["usEastCluster", "euWestCluster", "apSouthCluster"],
            description:
              "Healthy destination cluster region that will absorb the redistributed traffic load.",
          },
          trafficShiftPercentage: {
            type: "number",
            description:
              "Percentage of inbound request traffic to redirect from sourceClusterRegion to targetClusterRegion.",
          },
        },
        required: ["sourceClusterRegion", "targetClusterRegion", "trafficShiftPercentage"],
      },
    },
  },
];


// ─── Live MongoDB Telemetry Ingestion ──────────────────────────────────────────

async function fetchLiveClusterTelemetryFromMongoDB(): Promise<InfrastructureStateSnapshot> {
  const clusterRegionIdentifiers = [
    "usEastCluster",
    "euWestCluster",
    "apSouthCluster",
  ] as const;

  try {
    const perRegionLatestDocuments = await Promise.all(
      clusterRegionIdentifiers.map((clusterRegionId) =>
        ServerHealthModel.findOne({ regionId: clusterRegionId })
          .sort({ recordedAt: -1 })
          .lean()
          .exec()
      )
    );

    const aggregatedInfrastructureSnapshot = {} as InfrastructureStateSnapshot;

    for (let regionIndex = 0; regionIndex < clusterRegionIdentifiers.length; regionIndex++) {
      const clusterRegionId = clusterRegionIdentifiers[regionIndex]!;
      const latestRegionHealthDocument = perRegionLatestDocuments[regionIndex];

      if (!latestRegionHealthDocument) {
        console.error(
          `[MONGODB_REGION_DOCUMENT_MISSING] No ServerHealth document found for regionId: ${clusterRegionId}`
        );
        aggregatedInfrastructureSnapshot[clusterRegionId] = {
          computeLoadPercentage: 0,
          volatileMemoryAllocationGb: 0,
          clusterOperationalStatus: "STABLE",
        };
      } else {
        aggregatedInfrastructureSnapshot[clusterRegionId] = {
          computeLoadPercentage: latestRegionHealthDocument.computeLoadPercentage,
          volatileMemoryAllocationGb: latestRegionHealthDocument.volatileMemoryAllocationGb,
          clusterOperationalStatus: latestRegionHealthDocument.clusterOperationalStatus,
        };
      }
    }

    return aggregatedInfrastructureSnapshot;
  } catch (mongoDbTelemetryFetchException: unknown) {
    console.error(
      "[MONGODB_TELEMETRY_FETCH_EXCEPTION]",
      mongoDbTelemetryFetchException
    );
    throw mongoDbTelemetryFetchException;
  }
}


// ─── MCP Tool Execution Dispatcher ────────────────────────────────────────────

async function dispatchMcpToolCall(
  toolInvocationRequest: ChatCompletionMessageToolCall
): Promise<string> {
  if (toolInvocationRequest.type !== "function") {
    return JSON.stringify({ dispatchFailureReason: "Non-function tool call type is unsupported." });
  }
  const toolArgumentsJson = toolInvocationRequest.function.arguments;
  const dispatchedToolName = toolInvocationRequest.function.name;

  try {
    switch (dispatchedToolName) {
      case "fetchLiveInfrastructureMetrics": {
        const metricsQueryDirective: FetchLiveInfrastructureMetricsInput =
          JSON.parse(toolArgumentsJson);
        const regionalTelemetrySnapshot =
          await fetchLiveClusterTelemetryFromMongoDB();
        const scopedClusterRegion = metricsQueryDirective.targetClusterRegion;
        if (scopedClusterRegion) {
          return JSON.stringify({
            infrastructureState: {
              [scopedClusterRegion]:
                regionalTelemetrySnapshot[scopedClusterRegion],
            },
          });
        }
        return JSON.stringify({ infrastructureState: regionalTelemetrySnapshot });
      }

      case "traceRepositoryCommitHistory": {
        const commitTraceDirective: TraceRepositoryCommitHistoryInput =
          JSON.parse(toolArgumentsJson);
        const mockedCommitGraphSummary = {
          repositoryNamespace: commitTraceDirective.repositoryNamespace,
          traversedCommitDepth: commitTraceDirective.commitLookbackDepth ?? 50,
          recentCommitRecords: [
            {
              commitSha: "a3f9c12",
              authorIdentity: "surya@aethernexus.io",
              commitTimestamp: new Date(
                Date.now() - 1000 * 60 * 14
              ).toISOString(),
              commitMessageSummary:
                "perf(euWest): increase cache TTL for session-store namespace",
            },
            {
              commitSha: "b7e2d45",
              authorIdentity: "surya@aethernexus.io",
              commitTimestamp: new Date(
                Date.now() - 1000 * 60 * 47
              ).toISOString(),
              commitMessageSummary:
                "fix(euWest): patch volatile memory leak in ingress router",
            },
          ],
          authorIdentityFilter: commitTraceDirective.authorIdentityFilter ?? null,
        };
        return JSON.stringify(mockedCommitGraphSummary);
      }

      case "executeClusterCacheFlush": {
        const cacheFlushDirective: ExecuteClusterCacheFlushInput =
          JSON.parse(toolArgumentsJson);
        const cacheFlushAcknowledgement = {
          flushDispatchStatus: "ACKNOWLEDGED",
          targetClusterRegion: cacheFlushDirective.targetClusterRegion,
          cacheLayerNamespace: cacheFlushDirective.cacheLayerNamespace,
          acknowledgedAuthorizationToken:
            cacheFlushDirective.flushOperationAcknowledgementToken,
          flushExecutionTimestamp: new Date().toISOString(),
        };
        console.error(
          `[MCP_CACHE_FLUSH_DISPATCHED] Region: ${cacheFlushDirective.targetClusterRegion} | Namespace: ${cacheFlushDirective.cacheLayerNamespace}`
        );
        const cacheFlushBroadcastPacket: ArchitecturalThoughtStreamPacket = {
          eventTimestamp: new Date().toISOString(),
          principalArchitect: "Surya-AI-Core",
          executedMitigationAction: `Cache flush dispatched on ${cacheFlushDirective.targetClusterRegion} — namespace: ${cacheFlushDirective.cacheLayerNamespace}`,
          incidentThreatLevelColor: "CRITICAL_RED",
        };
        emitArchitecturalThoughtStreamPacket(cacheFlushBroadcastPacket);
        return JSON.stringify(cacheFlushAcknowledgement);
      }

      case "requestHumanOverrideClearance": {
        const overrideClearanceRequest: RequestHumanOverrideClearanceInput =
          JSON.parse(toolArgumentsJson);
        const overrideClearanceAcknowledgement = {
          clearanceRequestStatus: "PENDING_HUMAN_AUTHORIZATION",
          incidentClassificationCode:
            overrideClearanceRequest.incidentClassificationCode,
          autonomousDecisionRiskLevel:
            overrideClearanceRequest.autonomousDecisionRiskLevel,
          requestingAgentIdentifier:
            overrideClearanceRequest.requestingAgentIdentifier,
          clearanceRequestTimestamp: new Date().toISOString(),
          estimatedAuthorizationWindowMs: 300000,
        };
        console.error(
          `[MCP_HUMAN_OVERRIDE_REQUESTED] Incident: ${overrideClearanceRequest.incidentClassificationCode} | Risk: ${overrideClearanceRequest.autonomousDecisionRiskLevel}`
        );
        const overrideClearanceBroadcastPacket: ArchitecturalThoughtStreamPacket = {
          eventTimestamp: new Date().toISOString(),
          principalArchitect: "Surya-AI-Core",
          executedMitigationAction: `Human override clearance requested — Incident: ${overrideClearanceRequest.incidentClassificationCode} | Risk: ${overrideClearanceRequest.autonomousDecisionRiskLevel}`,
          incidentThreatLevelColor: "CRITICAL_RED",
        };
        emitArchitecturalThoughtStreamPacket(overrideClearanceBroadcastPacket);
        return JSON.stringify(overrideClearanceAcknowledgement);
      }

      case "executeLoadBalancing": {
        const loadBalancingDirective: ExecuteLoadBalancingInput =
          JSON.parse(toolArgumentsJson);
        const loadBalancingAcknowledgement = {
          loadBalancingDispatchStatus: "ACKNOWLEDGED",
          sourceClusterRegion: loadBalancingDirective.sourceClusterRegion,
          targetClusterRegion: loadBalancingDirective.targetClusterRegion,
          trafficShiftPercentage: loadBalancingDirective.trafficShiftPercentage,
          loadBalancingExecutionTimestamp: new Date().toISOString(),
        };
        console.error(
          `[MCP_LOAD_BALANCING_DISPATCHED] Source: ${loadBalancingDirective.sourceClusterRegion} → Target: ${loadBalancingDirective.targetClusterRegion} | Shift: ${loadBalancingDirective.trafficShiftPercentage}%`
        );

        // ─── Live HTTP Egress to API Gateway Control Endpoint ─────────────────
        const resolvedGatewayControlUrl =
          process.env["GATEWAY_CONTROL_URL"] ?? "http://localhost:5000";

        try {
          const gatewayRebalanceHttpResponse = await fetch(
            `${resolvedGatewayControlUrl}/api/rebalance`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sourceRegion: loadBalancingDirective.sourceClusterRegion,
                targetRegion: loadBalancingDirective.targetClusterRegion,
                trafficShiftPercentage:
                  loadBalancingDirective.trafficShiftPercentage,
              }),
            }
          );
          console.error(
            `[GATEWAY_REBALANCE_HTTP_RESPONSE] Status: ${gatewayRebalanceHttpResponse.status} | Endpoint: ${resolvedGatewayControlUrl}/api/rebalance`
          );
        } catch (gatewayRebalanceNetworkException: unknown) {
          console.error(
            "[GATEWAY_REBALANCE_NETWORK_EXCEPTION] API gateway unreachable — orchestration loop continues.",
            gatewayRebalanceNetworkException
          );
        }

        const loadBalancingBroadcastPacket: ArchitecturalThoughtStreamPacket = {
          eventTimestamp: new Date().toISOString(),
          principalArchitect: "Surya-AI-Core",
          executedMitigationAction: `Traffic load balancing executed — ${loadBalancingDirective.trafficShiftPercentage}% shifted from ${loadBalancingDirective.sourceClusterRegion} to ${loadBalancingDirective.targetClusterRegion}`,
          incidentThreatLevelColor: "WARNING_AMBER",
        };
        emitArchitecturalThoughtStreamPacket(loadBalancingBroadcastPacket);
        return JSON.stringify(loadBalancingAcknowledgement);
      }


      default: {
        console.error(
          `[MCP_TOOL_DISPATCH_UNKNOWN_TOOL_EXCEPTION] Unrecognized tool name: ${dispatchedToolName}`
        );
        return JSON.stringify({
          dispatchFailureReason: `Unrecognized tool identifier: ${dispatchedToolName}`,
        });
      }
    }
  } catch (mcpToolDispatchException: unknown) {
    console.error(
      `[MCP_TOOL_DISPATCH_EXECUTION_EXCEPTION] Tool: ${dispatchedToolName}`,
      mcpToolDispatchException
    );
    return JSON.stringify({
      dispatchFailureReason:
        mcpToolDispatchException instanceof Error
          ? mcpToolDispatchException.message
          : "Unknown dispatch execution fault.",
    });
  }
}

// ─── Agentic Tool-Calling Loop ─────────────────────────────────────────────────

async function executeAgenticReasoningCycle(
  activeConversationThread: ChatCompletionMessageParam[]
): Promise<ChatCompletionMessageParam[]> {
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
        console.error(
          "[ORCHESTRATOR_LLM_COMPLETION_EXCEPTION] LLM returned zero completion choices. Aborting reasoning cycle."
        );
        break;
      }

      const assistantReasoningMessage = primaryCompletionChoice.message;
      mutatingConversationThread.push(assistantReasoningMessage);

      if (primaryCompletionChoice.finish_reason === "stop") {
        break;
      }

      if (
        primaryCompletionChoice.finish_reason === "tool_calls" &&
        assistantReasoningMessage.tool_calls
      ) {
        for (const pendingToolInvocation of assistantReasoningMessage.tool_calls) {
          if (pendingToolInvocation.type === "function") {
            console.error(
              `[ORCHESTRATOR_TOOL_DISPATCH] Invoking: ${pendingToolInvocation.function.name} | Args: ${pendingToolInvocation.function.arguments}`
            );
          }

          const toolExecutionOutputJson =
            await dispatchMcpToolCall(pendingToolInvocation);

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
  } catch (agenticCycleExecutionException: unknown) {
    console.error(
      "[ORCHESTRATOR_AGENTIC_CYCLE_EXCEPTION]",
      agenticCycleExecutionException
    );
  }

  return mutatingConversationThread;
}

// ─── Infrastructure Evaluation Loop (10s polling cadence) ─────────────────────

export async function infrastructureEvaluationLoop(): Promise<void> {
  console.error(
    "[ORCHESTRATOR_BOOTSTRAP] AetherNexus Autonomous Orchestrator — Evaluation loop initialized."
  );

  const executeEvaluationCycle = async (): Promise<void> => {
    console.error(
      `[ORCHESTRATOR_CYCLE_START] Timestamp: ${new Date().toISOString()}`
    );

    try {
      const currentTelemetrySnapshot =
        await fetchLiveClusterTelemetryFromMongoDB();

      const telemetryContextMessage: ChatCompletionMessageParam = {
        role: "user",
        content: `Evaluate the following live infrastructure telemetry snapshot and execute the appropriate SOP actions:\n\n${JSON.stringify(
          { infrastructureState: currentTelemetrySnapshot },
          null,
          2
        )}`,
      };

      const initialConversationThread: ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: AUTONOMOUS_CONTROL_PLANE_SYSTEM_PROMPT,
        },
        telemetryContextMessage,
      ];

      const completedConversationThread = await executeAgenticReasoningCycle(
        initialConversationThread
      );

      const terminalAssistantMessage = completedConversationThread
        .filter((conversationTurn) => conversationTurn.role === "assistant")
        .at(-1);

      if (
        terminalAssistantMessage &&
        typeof terminalAssistantMessage.content === "string"
      ) {
        const terminalLlmOutputText = terminalAssistantMessage.content;
        console.error(
          `[ORCHESTRATOR_CYCLE_COMPLETE] Evaluation Summary:\n${terminalLlmOutputText}`
        );

        // ── Parse LLM-structured egress packet and broadcast to Domain 3 ─────
        try {
          const jsonExtractionMatch = terminalLlmOutputText.match(
            /\{[\s\S]*?"incidentThreatLevelColor"[\s\S]*?\}/
          );
          if (jsonExtractionMatch?.[0]) {
            const parsedLlmEgressDirective = JSON.parse(
              jsonExtractionMatch[0]
            ) as Partial<ArchitecturalThoughtStreamPacket>;

            const architecturalThoughtStreamPacket: ArchitecturalThoughtStreamPacket =
              {
                eventTimestamp:
                  parsedLlmEgressDirective.eventTimestamp ??
                  new Date().toISOString(),
                principalArchitect:
                  parsedLlmEgressDirective.principalArchitect ?? "Surya-AI-Core",
                executedMitigationAction:
                  parsedLlmEgressDirective.executedMitigationAction ??
                  "Autonomous evaluation cycle completed — no critical action required.",
                incidentThreatLevelColor:
                  parsedLlmEgressDirective.incidentThreatLevelColor ??
                  "NOMINAL_GREEN",
              };

            emitArchitecturalThoughtStreamPacket(architecturalThoughtStreamPacket);
          } else {
            const nominalCycleBroadcastPacket: ArchitecturalThoughtStreamPacket = {
              eventTimestamp: new Date().toISOString(),
              principalArchitect: "Surya-AI-Core",
              executedMitigationAction:
                "Evaluation cycle completed — infrastructure nominal.",
              incidentThreatLevelColor: "NOMINAL_GREEN",
            };
            emitArchitecturalThoughtStreamPacket(nominalCycleBroadcastPacket);
          }
        } catch (egressPacketParseException: unknown) {
          console.error(
            "[SOCKET_EGRESS_PACKET_PARSE_EXCEPTION]",
            egressPacketParseException
          );
        }
      }
    } catch (evaluationCycleException: unknown) {
      console.error(
        "[ORCHESTRATOR_EVALUATION_CYCLE_EXCEPTION]",
        evaluationCycleException
      );
    }

    console.error(
      `[ORCHESTRATOR_CYCLE_END] Next cycle in ${resolvedPollingIntervalMs}ms.`
    );
  };

  // Execute immediately on startup, then on interval.
  await executeEvaluationCycle();
  setInterval(() => {
    void executeEvaluationCycle();
  }, resolvedPollingIntervalMs);
}

// ─── Entrypoint Guard ──────────────────────────────────────────────────────────

bootstrapEgressBroadcastServer()
  .then(() => initializeMongoDbConnection())
  .then(() => infrastructureEvaluationLoop())
  .catch((fatalBootstrapException: unknown) => {
    console.error(
      "[ORCHESTRATOR_FATAL_BOOTSTRAP_EXCEPTION]",
      fatalBootstrapException
    );
    process.exit(1);
  });
