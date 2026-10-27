# Evaluation harness

Reproducible experiment that scores the drift detector against labelled data. No Docker, network or Postgres needed
(an in-memory SQLite database is created per run). Python 3.9 with the backend requirements.

```bash
source .venv/bin/activate
python evaluation/generate_corpus.py                      # evaluation/corpus (100 devices, seed 20261027)
python evaluation/run_eval.py --label after-fixes         # evaluation/results/after-fixes/{results.md,metrics.json,errors.json}

python evaluation/generate_corpus.py --profile challenge  # evaluation/corpus_challenge (70 devices, seed 7)
python evaluation/run_eval.py --corpus evaluation/corpus_challenge --label challenge-after-fixes
```

| File | Role |
|---|---|
| `spec.py` | site types, zone weights, expert tier-judgement table, the compliance rules (baselines) per site type |
| `generate_corpus.py` | seeded generator: configs, last-known-good configs, baselines, tickets, ground-truth manifest |
| `harness.py` | runs the real pipeline (+ naive baselines, ablations), instruments it, computes metrics |
| `run_eval.py` | orchestrates runs, 2-fold threshold tuning, writes the report |
| `corpus/`, `corpus_challenge/` | committed generator output (guarded by a test: regenerating must reproduce it byte for byte) |
| `results/` | `before-fixes` (commit 85825c2), `after-fixes`, `challenge-first-run`, `challenge-after-fixes` |

Read `docs/labels-and-thresholds.md` for definitions and `docs/evaluation-error-analysis.md` for findings.

To add a scenario: write a function in `generate_corpus.py` that mutates the config and declares its ground-truth findings
(`ctx.finding(...)`, `ctx.ticket(...)`), register it in `SCENARIOS` or `CHALLENGE_SCENARIOS`, regenerate, and commit the corpus.
