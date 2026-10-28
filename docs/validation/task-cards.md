# Task cards

**Participant sheet** (hand over; the facilitator signs in as `admin` and leaves the browser on the dashboard):

> You work in the network team of a university. A tool called Campus Drift watches the configuration of three network devices: a
> classroom switch (`sw-classroom-01`), a hostel switch (`sw-hostel-01`) and a research-lab router (`rtr-lab-01`). It compares each device's
> configuration with the *approved baseline* and tells you when something has drifted. A colleague, **neteng**, has been working on
> the system earlier today. You are signed in as an **administrator**. Please think aloud. I can't help with how to use the tool, but I can
> clarify the wording of a task.
>
> **Task 1.** The team lead asks: *which single device needs attention first?* Find it and tell me why.
>
> **Task 2.** For that device, point me to the exact line of the device's own configuration that caused the most serious finding, and its line number.
>
> **Task 3.** A colleague tells you the change on `rtr-lab-01` is a known lab exception that is documented elsewhere. Record that in the tool so it
> stops being treated as a problem.
>
> **Task 4.** neteng has prepared a fix for the device from Task 1. Decide whether it is safe, and if you agree, approve it and apply it.
>
> **Task 5.** After the change, the lab says something stopped working. Put the device back exactly as it was and show me how you know it worked.

Total time limit per task: **5 minutes** (T2: 3). Stop the task at the limit and record it as *fail*.

## Facilitator key (never shown to participants; answers are generated into `evaluation/validation/session_key.json` by `scripts/validation_setup.py`)

| Task | Success (record `success`) | `partial` | `fail` |
|---|---|---|---|
| **T1** | Names **sw-hostel-01** *and* gives a reason that cites its severity (Critical / score 95 / telnet / public SNMP) | Right device, no reason or wrong reason | Wrong device, or runs out of time |
| **T2** | Points to the evidence line `transport input telnet ssh` and **line 78** (the number in `session_key.json`) | Finds the line but not the number, or finds a different violation of the same device | Cannot find it |
| **T3** | Opens the `rtr-lab-01` event, chooses *Mark False Positive* and writes a meaningful comment. Verify with `scripts/validation_check.py` (`T3_pass`) | Marks it but with an empty or meaningless comment | Marks a different device's event, or gives up |
| **T4** | Reads the plan (commands + "Fixes: ..."), approves it (the four-eyes rule makes admin the only valid approver), and applies it successfully. `validation_check.py`: `T4_pass` | Approves but does not apply, or applies without reading the plan (no comment/inspection of the commands) | Rejects a sound plan with no reason, or cannot find the approval queue |
| **T5** | Executes *Manual Rollback* and states a way to verify: polling the device again, watching the Critical drift reappear, checking the Audit Log. `validation_check.py`: `T5_pass` | Rolls back but cannot say how they would confirm | Cannot find rollback |

**Notes for the facilitator**

* Record **time on task** from reading the task to the participant saying "done", in seconds.
* **Hint ladder** (count each; a task finished after hint 3 is at best `partial`): (1) "Where would you expect that to be?"; (2) name the sidebar section; (3) point to the control.
* Do not explain terms such as "four-eyes" or "authorized drift". If the participant asks what a label means, answer "what do you think it means?" and note it as an issue.
* Pay attention to: Task 1 (does the participant understand why the classroom drift is *Authorized* and therefore not urgent? do they find the ticket?);
  Task 4 (do they notice the commands touch more than the Critical findings, e.g. port-security and NTP?); Task 5 (can they tell the rollback was verified?).
* After each participant run `./scripts/validation_env.sh reset` so the next person starts from the same state.
