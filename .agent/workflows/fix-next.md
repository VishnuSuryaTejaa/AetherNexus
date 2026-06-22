---
description: Fix the next PENDING bug from BUG_REPORT.md in priority order
---

Read BUG_REPORT.md completely.
Read .agents/agents.md — find the "Bug Priority Order" list.
Identify the first bug whose status is still PENDING in that priority order. State it clearly:
"Next bug to fix: BUG-XXX — [title] — in file [FILE]"
Activate the correct agent persona based on which Domain the bug is in:

Domain 1 (nodes/*.ts) → Backend Engineer Agent
Domain 2 (server.ts, gateway.ts, loadbalancer.ts) → Backend Engineer Agent
Domain 3 (dist/orchestrator.js, dist/egressBroadcaster.js) → AI Layer Engineer Agent
Domain 4 (dashboard/src/) → Frontend Engineer Agent
render.yaml, package.json → DevOps Agent


Read the context file for that domain:

Domain 1/2 → BACKEND_CONTEXT.md
Domain 3 → dist/AI_LAYER_CONTEXT.md
Domain 4 → dashboard/context.md


Read the specific file(s) that contain the bug completely before writing anything.
State the root cause in exactly ONE sentence starting with "Root cause:"
Produce a Fix Plan Artifact listing:

File(s) to change
Exact lines to modify (line numbers if possible)
What the change is
What invariants from GLOBAL_CONTEXT.md Section 7 this touches (if any)


Show the plan and ask: "Review this fix. Type GO to apply."
After GO: apply the fix, showing the before/after diff for each changed line.
Update BUG_REPORT.md: change the bug's status from PENDING to FIXED. Add today's date.
If the fix touches a cross-layer boundary (socket event, API endpoint, MongoDB schema):

Also update GLOBAL_WORKFLOW.md in the relevant section
State which section you updated


Commit:
// turbo
git add -A
// turbo
git commit -m "fix(scope): description [BUG-XXX]"
Report: "BUG-XXX fixed. [N] bugs remaining PENDING. Type /fix-next to continue."