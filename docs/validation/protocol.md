# Validation protocol

## Purpose and questions

1. **Usability:** can network staff who have not seen the tool find the riskiest drift, read the evidence, record a known exception, review and apply a fix,
   and roll it back (five tasks)?
2. **Trust in the ratings:** does the tool's idea of "how serious" agree with how network staff rate the same changes? This validates the single-annotator
   judgement table used as ground truth in `docs/labels-and-thresholds.md` §2 and the zone multipliers that caused the hostel/public-event calibration
   errors in `docs/evaluation-error-analysis.md` §3.1.
3. **Workflow fit:** where does the tool disagree with how the participant works today (ticket handling, legacy console workflow, who may approve)?

## Participants

* **Target:** 5 (minimum 3). People who administer or have administered campus or lab networks: university IT/network staff, laboratory
  administrators, system-administration teaching staff, senior students with hands-on networking experience (for example network-lab teaching assistants).
  Record role and years of experience only.
* **Not eligible:** anyone who helped build the tool.
* **Why five:** about five users reveal most severe usability problems (Nielsen & Landauer, 1993); this is formative testing, not a statistical study.
  The analysis reports intervals and says so.
* **Ethics:** `consent-and-data-handling.md`. If the institution requires ethics-committee approval for human-participant work, obtain it before recruiting.

## Environment (per session)

```bash
NODE_BIN=/path/to/node/bin ./scripts/validation_env.sh start     # once: isolated DB, simulators, API :8020, UI :5200
./scripts/validation_env.sh reset                                 # before EVERY participant
```

Sign in as `admin` (demo accounts only; participants never type a password). Keep `evaluation/validation/session_key.json` closed.
Duration 45 min:

| Min | Step | Material |
|---|---|---|
| 0-3 | Welcome, consent, role and experience questions | `consent-and-data-handling.md` |
| 3-6 | Scenario read-aloud; ask them to think aloud; **no tour of the tool** | `task-cards.md` |
| 6-28 | Tasks 1-5, silent observation, timing, hint log | `task-cards.md` |
| 28-30 | After each task (or at the end): "How easy was that?" 1 (very difficult) - 7 (very easy) | ask aloud, note in `sessions.csv` notes |
| 30-34 | SUS | `sus.md` |
| 34-41 | Rating form (tool's own scores hidden) | `rating-form.md` |
| 41-45 | Debrief interview | below |

## Debrief questions

1. What was the most confusing moment? What did you expect to happen?
2. A device shows "Drift-Authorized". What does that tell you? Would you trust it? What would make you doubt it?
3. The tool refuses to let the person who drafted a plan approve it. Is that how your team works? What would you change?
4. Where would this tool conflict with how changes are made on your network today (console access, tickets, emergency fixes)?
5. Which alert would you *not* want to be woken for? Which would you want sooner?
6. Anything the tool shows that you do not trust or cannot verify?

## Data capture

After the session the facilitator, within 24 h, transcribes into `docs/validation/data/`:

| File | Content | Template |
|---|---|---|
| `sessions.csv` | one row per participant × task: outcome (success/partial/fail), seconds, hints, errors, notes; use `scripts/validation_check.py` for T3-T5 | `templates/sessions.csv` |
| `sus.csv` | ten answers per participant | `templates/sus.csv` |
| `ratings.csv` | participant × change × zone → tier | `templates/ratings.csv` |
| `issues.csv` | usability issues with severity 0-4 (0 none, 1 cosmetic, 2 minor, 3 major, 4 catastrophic) | `templates/issues.csv` |

Then `python scripts/validation_analyze.py` writes `results.md`.

## From findings to changes (required)

For every issue of severity ≥ 3 and for the three most frequent severity-2 issues: make a change, commit it with the issue id, and record
before/after in `results.md` §4 (status `fixed`, `deferred` with a reason, or `wontfix` with a reason). If the rating form shows the table
is wrong for some (change, zone) pair, either change `TIER_JUDGEMENT` and re-run the evaluation, or change that rule's weight, and say which.

## Limits to report honestly

Few participants; possibly non-expert; a simulated network; the facilitator is the developer (observer effect); participants who already know
the project may be lenient. State these in the report next to the numbers.
