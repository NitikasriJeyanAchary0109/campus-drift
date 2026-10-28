# Pre-pilot expert walkthrough (not stakeholder validation)

**What this is.** Before putting the tool in front of people, the five validation tasks were walked through in the UI by the project's developer (working with an AI coding assistant)
on the isolated validation environment (`scripts/validation_env.sh`), signed in as `admin`, on 2026-10-28. It is a cognitive walkthrough: at each step ask
"will a new user know what to do, see that it worked, and understand the result?"
**It is one informed evaluator who knows the system. It finds defects; it does not measure usability and it is not evidence that real users cope.**
The stakeholder sessions in `protocol.md` are still to be run.

All five tasks can be completed end to end in the UI, and `scripts/validation_check.py` confirms the outcomes (T3, T4, T5 pass).
Getting there exposed eleven problems, ten of them at severity 2 or higher (could have blocked or misled a participant); all are fixed in this branch.

| # | Task | Severity (0-4) | Finding | Fix | Status |
|---|---|:-:|---|---|---|
| E1 | T1 | 4 | The dashboard's *Critical* and *Low* tiles always showed **0** while *Active drifts* said 3: the UI keyed counts by short names (`Non-Compliant`, `Drift-Low`) but the API returns `Non-Compliant (Critical)` and `Drift-Unauthorized-Low`. The most serious event (95) was invisible in the headline tiles. Tile titles were also truncated ("Non-Compli…"). | `frontend/src/lib/labels.ts` maps backend labels to UI keys in one place; tiles use readable names | fixed |
| E2 | T1 | 3 | Same cause in the Drift Events list: critical events were styled as plain grey, and the *Drift-Low* filter matched nothing | same mapping; filter value corrected | fixed |
| E3 | T1 | 3 | Drift Events listed newest first, including resolved history, so the riskiest open event was third of four rows | default filter *Open*, sorted risk descending (a device's own history link still shows everything) | fixed |
| E4 | T1/T4 | 4 | **Baselines and Baseline details were static placeholders**: a hard-coded "Classroom-Core-Baseline v3 (Active)", fake rules shown for any id, and a *New Baseline Version* button that did nothing. Contradicted the Phase 1 report's walkthrough ("verifies Hostel-Baseline-v1 is active, 4 rules") | real list, details with rule table and rationale, YAML creation (NetEng+), Admin-only activation | fixed |
| E5 | T1 | 3 | No Change Tickets screen, although tickets decide authorized vs unauthorized; the user saw only a ticket chip and could not see the window or scope | new *Change Tickets* page with window state (upcoming / in window / expired, ±30 min grace) and creation form | fixed |
| E6 | T4 | 4 | **The four-eyes rule was not enforced**: any NetworkEngineer could draft *and* approve their own plan (the README and report claim dual control) | `created_by` on plans; author may not approve (403, audited as `PLAN_SELF_APPROVAL_BLOCKED`), may withdraw; UI disables Approve and says why; 8 tests | fixed |
| E7 | T4 | 3 | The approval card showed seven CLI commands but not what drift they fix (label, score, violated rules), so the reviewer could not judge whether the plan was proportionate | plan output carries `drift_label`, `risk_score`, `violated_paths`; card shows "Fixes: ..." | fixed |
| E8 | T5 | 2 | *Manual Rollback* was offered (enabled) on a plan that had never been applied; clicking it could only fail (no backup) | shown only when the plan has an action | fixed |
| E9 | T5 | 2 | Plan filters had no failed / rolled-back states, and the new statuses fell through to a "Pending Approval" badge | badges and filters added | fixed |
| E10 | - | 2 | *Settings* still said scheduling is done by APScheduler in the API process (it is Celery Beat) and showed a hard-coded 15-minute interval | text corrected | fixed |
| E11 | T2 | 1 | Seeded baseline rules had no rationale ("Why it matters" empty) | `description` seeded for every rule | fixed (new databases) |

## Open items to test with real participants

* **O1 Compliance number.** The dashboard shows *Baseline compliance 0.0%* for three devices of which one has only a ticket-covered (authorized) drift. A participant may read this as "everything is broken". Ask in the debrief what the number means to them.
* **O2 Proof of rollback (T5).** After a rollback the banner says "ROLLED_BACK" but the UI does not show *how* it was verified (the backend does verify; see `docs/failure-cases.md`). Watch whether participants trust it and how they check.
* **O3 Table sorting.** Tables have no sortable columns beyond the new default order.
* **O4 Terminology.** "Authorized drift", "hard compliance", "key path" and "NO_BASELINE" are domain terms invented by the tool; note which participants stumble.
* **O5 No automated frontend tests.** E1, E2 and E4 would each have been caught by a single contract test between API labels and UI keys; the repository has none for the frontend.
