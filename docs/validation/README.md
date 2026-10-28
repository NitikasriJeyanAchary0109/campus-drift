# Stakeholder validation

The Problem Statement asks for "a short user or stakeholder validation". This directory holds everything needed to run it, plus the
honest status.

## Status (2026-10-28)

| Item | State |
|---|---|
| Protocol, task cards, consent, SUS, rating form, CSV templates | **ready** |
| Repeatable scenario and objective outcome checker | **ready** (`scripts/validation_env.sh`, `validation_setup.py`, `validation_check.py`) |
| Analysis (SUS, task success with intervals, rater agreement, issue log) | **ready, tested on synthetic data** (`scripts/validation_analyze.py`) |
| Pre-pilot expert walkthrough | **done**: 11 defects found and fixed, including a missing four-eyes rule and placeholder Baselines pages ([expert-walkthrough.md](expert-walkthrough.md)) |
| **Sessions with real participants** | **not yet run**. `results.md` is generated from `data/` and currently says so. No participant data exists or has been invented |

## Run it

```bash
NODE_BIN=/path/to/node/bin ./scripts/validation_env.sh start   # isolated DB + simulators + API :8020 + UI :5200
./scripts/validation_env.sh reset                              # before every participant
python scripts/validation_check.py                             # after tasks 3-5: what actually happened
python scripts/validation_analyze.py                           # after entering the CSVs in data/ -> results.md
./scripts/validation_env.sh stop
```

| File | Use |
|---|---|
| [protocol.md](protocol.md) | questions, participants, 45-minute plan, data capture, how findings become changes |
| [task-cards.md](task-cards.md) | participant sheet and facilitator key with success criteria and hint ladder |
| [consent-and-data-handling.md](consent-and-data-handling.md) | information sheet and consent |
| [sus.md](sus.md), [rating-form.md](rating-form.md) | questionnaires |
| [templates/](templates/) | blank CSVs (`python scripts/validation_analyze.py --make-templates` regenerates them) |
| [expert-walkthrough.md](expert-walkthrough.md) | pre-pilot walkthrough findings and open items |
| [results.md](results.md) | generated report |

## What the sessions will and will not show

They can show whether people can complete the core workflow without training and whether network staff rate changes as the tool does.
With about five participants they are formative: they find problems, they do not prove usability. They do not test the tool on real
hardware or at scale.
