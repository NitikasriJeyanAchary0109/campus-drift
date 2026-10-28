# Rating form: how serious is each change?

*Hand this to the participant **after** the usability tasks, never before (it would prime them). Takes about 10 minutes.*

Imagine the monitoring tool has just detected the change below on a device in the given part of the campus network, **with no approved change
ticket**. How urgently should the network team react?

| Rating | Meaning |
|---|---|
| **CRITICAL** | Page someone now; fix immediately, no exceptions |
| **HIGH** | Fix the same day; alert the on-call engineer |
| **MEDIUM** | Fix within the week; show on the dashboard |
| **LOW** | Fix at the next maintenance window; no alert |

Write one of CRITICAL / HIGH / MEDIUM / LOW in each cell. Go with your first instinct; there are no right answers. If you would
need more information, write what you would need in the margin.

Zones: **Classroom** (lecture rooms), **Hostel** (student residences), **Office** (administration), **Lab** (research labs holding sensitive data),
**PublicEvent** (temporary pop-up switches for short events).

| Change | Classroom | Hostel | Office | Lab | PublicEvent |
|---|---|---|---|---|---|
| Telnet enabled on VTY lines |  |  |  |  |  |
| Default 'public'/'private' SNMP community present |  |  |  |  |  |
| Port security off on an edge port |  |  |  |  |  |
| Trunk allows an extra VLAN |  |  |  |  |  |
| Edge port moved onto the management VLAN |  |  |  |  |  |
| Edge port moved to another (non-management) VLAN |  |  |  |  |  |
| ACL entry order inverted (overlapping permit/deny) |  |  |  |  |  |
| ACL entry removed |  |  |  |  |  |
| NTP server re-pointed, removed or extra server added |  |  |  |  |  |

*Facilitator: transcribe the answers into `ratings.csv` (one row per participant × change × zone; the template lists all 45). Do not show the
tool's own scores or the table in `evaluation/spec.py` to the participant until the debrief.*
