---
name: studycalm-phase7-handoff
description: >-
  Use this skill to continue the StudyCalm project from its current handoff
  state. Activate when the user asks to resume, continue, or finish the
  StudyCalm Phase 7 backup flow, or when starting a new session on this project.
---

# StudyCalm – Phase 7 Handoff

Continue the StudyCalm project from this state.

- **Project path:** `study-app`
- **GitHub repo:** https://github.com/sauravparihar397-byte/studyprotime.git
- **Baseline release commit:** `1a92438`

## Current Status

- Phases 4, 5, and 6 are complete.
- Phase 7 is partially implemented: local JSON backup export/import exists.
- Current modified files: `app.js`, `index.html`, `style.css`.
- Preserve all existing user changes. Do not discard work.
- **Do not commit or push.**

## Task

Finish the Phase 7 backup flow cleanly and safely. Keep the existing
implementation unless it is clearly broken. Specifically:

1. Export local state, session history, achievements, and preferences as JSON.
2. Import and validate backup files safely.
3. Reject malformed or invalid JSON without crashing the app.
4. Deduplicate imported sessions.
5. Restore state and preferences correctly.
6. Keep the app UI working after import.

## Validation

- Ensure the app still loads normally.
- Verify the backup export/import flow works for valid data and fails gracefully
  for invalid data.

## Ground Rules

- Do not overwrite user work.
- Keep fixes surgical and minimal.
- Do not commit or push.
