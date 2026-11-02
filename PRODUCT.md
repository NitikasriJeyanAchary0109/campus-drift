# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React, TypeScript, Vite, Tailwind CSS, FastAPI, PostgreSQL, Redis, and Celery.

## Users

Campus network engineers investigate configuration drift and coordinate safe remediation. Admins oversee approvals and configuration; viewers monitor network status.

## Product Purpose

Campus Drift helps teams detect and resolve network configuration drift across decentralized campus environments. Success means engineers can identify meaningful deviations, understand their operational risk, and safely return devices to an approved state.

## Positioning

Campus Drift combines signed golden baselines and semantic drift detection with ticket-aware suppression, parameterized CLI remediation, independent peer approval, pre-change backups, verification, rollback, and audit logging.

## Operating Context

The product serves networks spanning campus settings such as lecture halls, hostels, research labs, and administrative offices. Engineers work through device inventory, baselines, change tickets, drift investigation, remediation approvals, execution, and audit history. Simulated SSH switches support demos and evaluation without requiring physical network hardware.

## Capabilities and Constraints

- Detects configuration drift against golden baselines and distinguishes meaningful changes from cosmetic differences.
- Uses maintenance tickets to contextualize and suppress authorized changes.
- Remediation commands are generated from parameterized templates; users cannot submit arbitrary free-text CLI commands.
- A remediation author cannot approve their own plan; an independent engineer or admin must approve it.
- Execution uses a pre-change backup and verification, with rollback when verification fails.
- Maintains an append-only audit trail for operationally significant actions.
- Preserve the existing product workflows and role distinctions during UI changes.

## Brand Commitments

The product name is Campus Drift.

## Evidence on Hand

- The repository includes a simulated campus SSH network for demos and evaluation.
- The repository includes interface screenshots under `docs/screenshots/`.
- No customer testimonials, external deployment claims, or independently verified outcome metrics are established here; do not invent them.

## Product Principles

- Make operational risk and meaningful drift understandable.
- Keep remediation constrained, independently approved, and verifiable.
- Preserve a trustworthy record of consequential actions.
- Distinguish authorized maintenance from unexpected change.
- Support campus network workflows across varied zones and device states.
