# Rollback demonstration: sw-hostel-01

Run at 2026-10-27 10:53:41 UTC against the live simulator. Drift event `70f63468-119a-4024-8c87-d1af9f8543fd`, plan `0a844f17-4ee6-4415-80ea-1e025e6ca833`, action `a929fd1a-03c6-426c-96fd-8dbbbaa170c0`.

## Approved commands

```
line vty 0 4
transport input ssh
no snmp-server community public
interface FastEthernet0/1
switchport port-security
no ntp server 10.10.0.2
ntp server 10.10.0.1
```

## What changed on the device

**State 1 → State 2** (remediation pushed):

```diff
--- state1
+++ state2
@@ -3,3 +3,3 @@
 
-Current configuration : 1540 bytes
+Current configuration : 1527 bytes
 !
@@ -37,2 +37,3 @@
  no switchport port-security
+ switchport port-security
 !
@@ -69,5 +70,3 @@
 !
-ntp server 10.10.0.2
 !
-snmp-server community public RO
 snmp-server community hostel-mgmt RO
@@ -76,4 +75,5 @@
  exec-timeout 5 0
+ntp server 10.10.0.1
 line vty 0 4
- transport input telnet ssh
+ transport input ssh
  exec-timeout 15 0
```

**State 2 → State 3** (automatic rollback):

```diff
--- state2
+++ state3
@@ -3,3 +3,3 @@
 
-Current configuration : 1527 bytes
+Current configuration : 1540 bytes
 !
@@ -37,3 +37,2 @@
  no switchport port-security
- switchport port-security
 !
@@ -70,3 +69,5 @@
 !
+ntp server 10.10.0.2
 !
+snmp-server community public RO
 snmp-server community hostel-mgmt RO
@@ -75,5 +76,4 @@
  exec-timeout 5 0
-ntp server 10.10.0.1
 line vty 0 4
- transport input ssh
+ transport input telnet ssh
  exec-timeout 15 0
```

## Proof

| Check | Result |
|---|---|
| state1 != state2 (remediation really changed the device) | PASS |
| state2 != state3 (rollback really changed it back) | PASS |
| state3 == state1 byte for byte | PASS |
| state3 == state1 semantically (normalized trees) | PASS |
| telnet present in state 1 | PASS |
| telnet absent in state 2 | PASS |
| telnet present again in state 3 | PASS |
| public SNMP present, absent, present again | PASS |
| action result is ROLLED_BACK | PASS |
| backup stored and equals state 1 | PASS |
| CRITICAL alert raised | PASS |
| audit entry records a verified restore | PASS |

Backup `8abd4423-22e6-4010-a773-46b2a18562ef` was stored before the change; the rollback was verified by re-reading the running-config and comparing it with that backup.

Alert: CRITICAL: Remediation verification failed on sw-hostel-01. Automated rollback ran and was verified against the pre-change backup. Failed paths: forced verification failure
