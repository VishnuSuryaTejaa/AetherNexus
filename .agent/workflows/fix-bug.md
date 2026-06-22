---
description: Fix a specific named bug. Usage: /fix-bug BUG-XXX
---

Ask the user: "Which bug? (e.g. BUG-001, BUG-007)" — if not provided in the message.
Read BUG_REPORT.md and find the full entry for that bug:

Severity
File(s) affected
Description
Current status



If status is already FIXED, report: "BUG-XXX is already marked FIXED in BUG_REPORT.md. No action needed."
Read GLOBAL_CONTEXT.md Section 7 (Critical Invariants) — check if this bug touches any invariant.
Read the full content of every file listed as affected by this bug.
Also read the context file for the affected domain:

nodes/*.ts or server.ts/gateway.ts/loadbalancer.ts → BACKEND_CONTEXT.md
dist/orchestrator.js or dist/egressBroadcaster.js → dist/AI_LAYER_CONTEXT.md
dashboard/src/ → dashboard/context.md
render.yaml or package.json → GLOBAL_WORKFLOW.md Section 3



State root cause in ONE sentence: "Root cause:"
Produce a Fix Artifact showing:

Every file that changes
The exact lines before and after the fix
Which invariants are preserved



For cross-layer changes (affecting more than one domain), additionally list:

All socket events impacted
All API endpoints impacted
All MongoDB collections impacted
Which context/workflow docs need updating



Show the artifact and ask: "Does this fix look right? Type GO to apply."
After GO:

Apply the fix
Update BUG_REPORT.md status → FIXED with date
Update any affected context/workflow documentation
// turbo
git add -A
// turbo
git commit -m "fix(scope): description [BUG-XXX]"



Report: "BUG-XXX fixed. Changed: [file1] — [what], [file2] — [what]."