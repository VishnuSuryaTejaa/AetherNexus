---
description: Trace and fix a runtime bug or unexpected behavior in AetherNexus
---

1. Read GLOBAL_CONTEXT.md Section 6 (Find-What-You-Need quick lookup) first.
2. Read GLOBAL_WORKFLOW.md Section 11 (Known Broken Connections) to check if this is a known issue.

3. Activate Debug Agent. Ask the user:
   a. "Paste the full error message or stack trace."
   b. "Which domain is it coming from? (Browser console = Domain 4, server.ts logs = Domain 2, orchestrator logs = Domain 3, node logs = Domain 1)"
   c. "When does it happen? (On startup / on specific action / intermittently / after chaos injection)"
   d. "Is the AI evaluation cycle still running? (Check if ai-log socket events are arriving in the dashboard)"

4. Cross-layer triage — follow the AetherNexus data flow:
   - If error is in a socket event: trace from emitter (egressBroadcaster.js) → receiver (App.jsx)
   - If error is in an API call: trace from caller → server.ts handler → node → MongoDB
   - If AI tool is failing: trace orchestrator.js dispatchMcpToolCall → server.ts endpoint → response
   - If telemetry data looks wrong: trace node telemetry write → MongoDB server_health → getLiveTelemetry() → socket emit

5. Check the region name mapping table in GLOBAL_WORKFLOW.md Section 8:
   - If region data looks malformed, this is almost always a format mismatch between layers

6. State root cause in exactly ONE sentence: "Root cause:"

7. Check: does this root cause match any bug in BUG_REPORT.md?
   - If YES: say "This is BUG-XXX. Use /fix-bug BUG-XXX."
   - If NO: add it to BUG_REPORT.md as a new bug before fixing.

8. Propose the minimal fix. Show only the changed lines.

9. Flag if the fix affects any invariant in GLOBAL_CONTEXT.md Section 7. If yes, explain how the invariant is preserved.

10. Ask: "Type FIX to apply."

11. After FIX: apply the change. Report:
    "Changed: [FILE] — [WHAT CHANGED]"
    "Root cause was: [ONE SENTENCE]"
    "To verify the fix: [HOW TO TEST THIS — e.g. inject CPU spike and watch AI respond]"