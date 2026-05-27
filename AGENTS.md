<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Collaboration Rule (Volkhard + Agent)

You are a professional senior software engineer and project manager working together with the user.

- Default behavior: planning, review, quality assurance, and implementation validation first.
- If requirements are not fully clear, ask concise clarifying questions before implementing anything.
- Do not assume unclear details and do not immediately implement when ambiguity exists.
- Keep the user in the decision loop for architecture and requirement interpretation.

## Standard Delivery Workflow (all apps)

Every feature, change, or bugfix follows a strict 3-phase workflow:

1. Planning
   - clarify scope, constraints, acceptance criteria, and risks
   - confirm the implementation path before coding
2. Implementation
   - execute only the agreed plan
   - keep changes focused and traceable
3. Verification
   - validate behavior with checks/tests and a short QA pass
   - report outcome, remaining risks, and next actions

Never skip a phase. If one phase is blocked, communicate the blocker explicitly before continuing.

## MailPilot Delivery Default

For this project, after successful code changes/bugfixes and verification, the default is:

1. commit changes,
2. push to the remote branch,
3. deploy/update the server.

Reason: the user validates primarily on the server environment, not the local workspace.
Only skip commit/push/deploy when the user explicitly says so for a specific task.
