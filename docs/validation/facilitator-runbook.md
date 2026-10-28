# Facilitator runbook (one page)

## Before the first session (once)

1. **Participants:** 3-5 people who have administered a campus or lab network (not anyone who helped build the tool). Book 45 minutes each, in person or screen-share.
2. **Ethics:** if your institution requires approval for studies with people, get it first. Print `consent-and-data-handling.md` (one copy per person to sign, one to keep).
3. **Machine:** Docker running; `.venv` created (`python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt`); `npm install` done in `frontend/`; Node on your PATH or passed as `NODE_BIN`. Ports 5200, 8020 and the Postgres/simulator ports free.
4. **Dry run on yourself or a friend** (not a participant): do all five tasks from `task-cards.md`, then `python scripts/validation_check.py` should say T3, T4, T5 pass.
5. Print: `task-cards.md` (participant sheet only), `sus.md`, `rating-form.md`. Keep the facilitator key to yourself.

## Each session

| When | Do |
|---|---|
| 10 min before | `NODE_BIN=/path/to/node/bin ./scripts/validation_env.sh start` the first time, `./scripts/validation_env.sh reset` for every later participant. Open http://127.0.0.1:5200 and sign in as **admin** (admin/admin123); leave it on the dashboard. Keep `evaluation/validation/session_key.json` closed. Start a timer. |
| 0-6 min | Consent (they sign); ask role and years of networking experience; read the scenario aloud; ask them to think aloud. **No tour of the tool.** |
| 6-28 min | Tasks 1-5 one at a time. Note outcome, seconds, hints (1 "where would you expect it?", 2 name the sidebar section, 3 point at the control), errors, and what they say. Stop a task at 5 minutes (T2: 3). |
| After T5 | `python scripts/validation_check.py` with `DATABASE_URL=postgresql+psycopg2://postgres:postgres@localhost:5433/campus_drift_validation` (use the port from your `.env`). Record what it says, not what you remember. |
| 28-41 min | SUS, then the rating form. Do not show them the tool's scores. |
| 41-45 min | Debrief questions from `protocol.md`. |

## After each session (within 24 h)

Append to the CSVs in `docs/validation/data/` (copy from `templates/`, keep the header row): `sessions.csv` (5 rows: one per task), `sus.csv` (1 row),
`ratings.csv` (45 rows), `issues.csv` (one row per problem you saw, severity 0-4). Use ids P1, P2, ... and never write names.
Then `python scripts/validation_analyze.py` regenerates `docs/validation/results.md`.

## After the last session

* For every issue with severity 3 or 4, and the three most frequent severity-2 issues: fix it, commit with the issue id, set its status in `issues.csv`, re-run the analysis.
* If the raters disagree with the tier table for some change and zone (listed in `results.md` §3), decide: change `TIER_JUDGEMENT` in `evaluation/spec.py` and re-run `python evaluation/run_eval.py`, or change that rule's weight.
* Write the limits next to the numbers: few participants, simulated network, the facilitator is the developer (people are polite to the person who built it; ideally have someone else run at least some sessions).
* Destroy the signed consent forms after the report is submitted, as promised in the consent text.
* `./scripts/validation_env.sh stop`

## If something goes wrong

* **A task wrecks the state** (e.g. the participant rolled back twice): `./scripts/validation_env.sh reset`.
* **Simulator unreachable:** `docker compose up -d sim_switch_classroom sim_switch_hostel sim_router_lab`, then reset.
* **UI blank or 401 after a long pause:** sign in again; sessions last 15 minutes.
* **Participant asks what a term means:** answer "what do you think it means?", then note it as an issue.
