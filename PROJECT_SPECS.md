# AETHERNEXUS: MASTER SYSTEM SPECIFICATION

<context_compaction>
This document establishes rigid boundaries for the AI agent to eliminate out-of-scope generations, prevent code hallucinations, and minimize input token overhead.
</context_compaction>

## 1. Architectural Objective
To engineer "AetherNexus" — a production-grade, self-healing multi-region infrastructure simulation engine that monitors system telemetry, autonomously fixes processing bottlenecks, and pipes live state updates to a 3D interface.

## 2. Microservice Isolation & Boundary Safeguards
The engineering workspace is divided into three isolated microservices. Your execution scope is strictly locked inside Domain 2.

* <target_exclusion> Domain 1 (Backend Telemetry & Chaos Engine): Engineered by Team Member A. Handles localized node data generation, failover routing, and simulated disaster injection. DO NOT generate, modify, or suggest code implementations for this service. </target_exclusion>
* <target_inclusion> Domain 2 (Autonomous AI Control Layer): Engineered by Surya (Team Leader & Principal Architect). This is your EXCLUSIVE development environment. You are responsible for building the Model Context Protocol (MCP) server, autonomous LLM orchestration loops, and Socket.io state broadcasters. </target_inclusion>
* <target_exclusion> Domain 3 (3D Frontend Matrix Canvas): Engineered by Team Member B. Handles React and Three.js visual graphics. DO NOT generate, modify, or suggest frontend dashboard components. </target_exclusion>

## 3. Scope Restriction Mandate
Confine all architectural layouts and scripts to Domain 2. Do not volunteer code blocks for the simulation endpoints or the 3D canvas layer.

## 4. Part 2 Execution Roadmap (Surya's Component Timeline)
You must execute Domain 2 development in three strict, sequential milestones:
- **Milestone 2.1 (Foundational MCP Server):** Build the core TypeScript Node.js infrastructure. Implement and export the four authorized schemas (`fetchLiveInfrastructureMetrics`, `traceRepositoryCommitHistory`, `executeClusterCacheFlush`, `requestHumanOverrideClearance`).
- **Milestone 2.2 (LLM Orchestration Loop):** Implement the asynchronous polling engine. Wire the SOP rules into the system prompt context. Ensure the AI autonomously evaluates incoming telemetry from Domain 1.
- **Milestone 2.3 (Integration & WebSocket Egress):** Initialize the Socket.io server layer. Bind the AI's internal reasoning output directly to the `aethernexus-telemetry-broadcast` event stream so Domain 3 can read it instantly.
