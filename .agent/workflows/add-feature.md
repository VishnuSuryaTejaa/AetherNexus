---
description: Add a new feature to AetherNexus with full plan → review → code cycle
---

Read GLOBAL_CONTEXT.md, GLOBAL_WORKFLOW.md, and BUG_REPORT.md first.
Activate PM Agent. Ask the user these questions ONE AT A TIME:
a. "What do you want to build? Describe it in plain language."
b. "Which domain(s) does this touch? (Domain 1=nodes, 2=backend, 3=AI layer, 4=frontend, or multiple)"
c. "What does success look like in one sentence?"
d. "What is explicitly NOT in scope?"
e. "Any constraint on approach? (e.g. must stay within existing Socket.io events, must use existing MongoDB collections)"
Write a spec to specs/[feature-slug]/spec.md:

   # Spec: [FEATURE_NAME]

   ## Problem
   [1 paragraph]

   ## Requirements
   - REQ-001: ...
   (max 5 requirements)

   ## Acceptance Criteria
   - AC-001: Given [context] when [action] then [outcome]

   ## Out of Scope
   - ...

   ## Tech Notes — AetherNexus Specific
   - Domains touched: [list]
   - Existing socket events used / new events needed: [list]
   - Existing API endpoints used / new endpoints needed: [list]
   - MongoDB collections read/write: [list]
   - Region name format needed: [which format from GLOBAL_WORKFLOW.md Section 8]
   - Module system (ESM or CommonJS): [which files, which system]
   - Cross-layer impact: [yes/no — describe]

Show spec. Ask: "Type APPROVED to proceed or tell me what to change."
After APPROVED — activate Engineer Agent for the relevant domain.
Read the domain context file. Read ALL files to be modified.
Produce an Implementation Plan Artifact:

New files to create
Existing files to modify (with which functions/sections)
New socket events (if any — flag as CROSS-LAYER)
New API endpoints (if any — flag as CROSS-LAYER)
New MongoDB collection fields (if any — flag as CROSS-LAYER)
Context docs that will need updating: GLOBAL_WORKFLOW.md sections, layer context files


Show plan. Ask: "Type GO to start coding."
After GO — implement one file at a time. Show before/after diff for each file.
If adding a new API endpoint: also update GLOBAL_WORKFLOW.md Section 9.
If adding a new socket event: also update GLOBAL_WORKFLOW.md Section 6 and dashboard/context.md.
If adding a new MongoDB field: also update BACKEND_CONTEXT.md Section 5.
After all files implemented:
Activate QA Agent. Check every Acceptance Criterion manually:

For backend changes: trace the request/response flow from endpoint to MongoDB to socket emit
For AI layer changes: trace the full orchestrator cycle with the new logic
For frontend changes: trace socket event → state update → component render


Produce QA Report:

    ## QA: [FEATURE_NAME]
    | AC | Result | Notes |
    |----|--------|-------|
    | AC-001 | ✅/❌ | |

If all ACs pass:
// turbo
git add -A
// turbo
git commit -m "feat(scope): [FEATURE_NAME] — closes spec/[feature-slug]"
Report: "Feature complete. All ACs passing."
If any AC fails: state which one and why, then fix before committing.