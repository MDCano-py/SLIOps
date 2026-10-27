# Release readiness — October 2026

**Decision: NO-GO.**

Local integration is not deployment, and deployment is not an independent retest. The live Git SHA is UNKNOWN. Node on this workstation is v24.18.0, which is older than the required 24.22.1. Migration 019 has not been applied to staging. Secrets were not rotated.

## Additional fixes in this pass

| Commit | Repository | Why |
| --- | --- | --- |
| `bb4cc8cfc9a7cc55d9be4282765109280520e002` | SLIOps | Load the shared revocation cutoff before issuing the next employee session. Stop the timeline 500 when audit rows use `action`. Add the disposable-Postgres integration script |
| `7bdbca15bf181a8cb6503785ebe0fa0887d6ecea` | AuthBridge | Redis integration for verify, me, logout, replay, and a second token. Entra was not contacted |

Earlier code commits remain `9b459e5` (SLIOps) and `e05b2fc` (AuthBridge).

## Counts from this validation pass

| Run | PASS | FAIL | BLOCKED |
| --- | --- | --- | --- |
| SLIOps integration script | 22 | 0 | 3 |
| AuthBridge disposable-Redis pytest | 1 | 0 | 0 |
| Prior unit scripts re-run (remediation, workflow authz, logout, staging hardening) | all passed (12 and 34 in the counted scripts) | 0 | 0 |

The three SLIOps BLOCKED rows are Entra login, live AuthBridge logout from that Node script, and live MaintainX/S3. The AuthBridge pytest covers gateway logout on disposable Redis and does not remove the Entra or live-host blockers.

## Finding ledger

| Original ID | Application | Fix commit | Test evidence | Local | Integration | Deployed | Retest | Remaining blocker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| STR-W03 / F-01 | SLIOps archive HTML | `9b459e5` | INT-13, INT-13b | fixed-in-code | PASS on memory stub | NOT DEPLOYED | not retested | Browser iframe and Upstash not exercised |
| STR-S05 / F-03 / vuln-0001 | SLIOps workflow | `9b459e5` | INT-07, INT-07b, INT-08b | fixed-in-code | PASS | NOT DEPLOYED | not retested | Staging retest |
| STR-S06 | SLIOps workflow PATCH | `9b459e5` | INT-09 | fixed-in-code | PASS | NOT DEPLOYED | not retested | Staging retest |
| STR-W07 / F-02 / vuln-0002 | SLIOps create | `9b459e5` | INT-10 | fixed-in-code | PASS | NOT DEPLOYED | not retested | Staging retest |
| vuln-0003 | SLIOps queue | `9b459e5` | INT-11, INT-11b | fixed-in-code | PASS | NOT DEPLOYED | not retested | Staging retest |
| STR-W08 / F-06 | SLIOps notifications | `9b459e5` | INT-12 | fixed-in-code | PASS | NOT DEPLOYED | not retested | Staging retest |
| STR-W05 / F-05 | SLIOps HMAC and AuthBridge JWT | `9b459e5`, `bb4cc8c`, `e05b2fc`, `7bdbca1` | INT-03, INT-05, Redis pytest | fixed-in-code | PASS | NOT DEPLOYED | not retested | Migration 019 and the Redis flag on every worker; live gateway not checked |
| STR-A15 / F-04 | Both logout endpoints | `9b459e5`, `e05b2fc` | INT-03, Redis pytest | fixed-in-code | PASS | NOT DEPLOYED | not retested | Browser cross-site check |
| STR-W06 | SLIOps forms | `9b459e5` | INT-14 | fixed-in-code | PASS | NOT DEPLOYED | not retested | In-process idempotency only |
| STR-A13 | AuthBridge redirect | `e05b2fc` | prior unit test | fixed-in-code | not re-run in this pass | NOT DEPLOYED | not retested | Live redirect retest |
| STR-A17 / A19 / nil tenant / docs | AuthBridge | `e05b2fc` | prior unit test | fixed-in-code | not re-run in this pass | NOT DEPLOYED | not retested | Host env still UNKNOWN |
| UUID `22P02` | SLIOps | `9b459e5` | INT-17b | fixed-in-code | PASS | NOT DEPLOYED | not retested | Staging retest |
| Timeline 500 | SLIOps | `bb4cc8c` | INT-17 | fixed-in-code | PASS | NOT DEPLOYED | not retested | Staging retest |
| PUT 500 / type gate | SLIOps | `9b459e5` | INT-16 | fixed-in-code | PASS against a mock | NOT DEPLOYED | not retested | Live MaintainX |
| SWP `zrem` | SLIOps | `9b459e5` | INT-15 | fixed-in-code | PASS on memory stub | NOT DEPLOYED | not retested | Upstash or host Redis not used |
| STR-D01–D16 | Both | none | lockfile and venv inspection | BLOCKED | BLOCKED | NOT DEPLOYED | not retested | No deployed SBOM |
| Node October advisory | SLIOps | engines already require 24.22.1 (`c8607fc`) | local `node -v` | not met locally | not applicable | UNKNOWN | not retested | Host binary not read |
| PHP CVE-2026-109618 / CVE-2026-109619 | Host | none | no PHP in the app trees | UNKNOWN | UNKNOWN | UNKNOWN | not retested | Host package list |
| Secret rotation | Operations | none | not performed | open | open | NOT DONE | not retested | Operator rotation record |
| OIDC login | AuthBridge | none in this pass | not run | BLOCKED | BLOCKED | NOT DEPLOYED | not retested | Entra was not contacted |
| `_3` blocked set (38) | mixed | none | reports only | BLOCKED | BLOCKED | NOT DEPLOYED | not retested | Blocked is not fixed |

## Remaining vulnerabilities and gaps

- Nothing in this ledger is closed on a deployed host.
- The test Node binary is missing the October 2026 Node fixes.
- python-jose 3.5.0, ecdsa 0.19.2, lockfile `uuid` 8.3.2, and `@xmldom/xmldom` 0.8.15 were not upgraded.
- Employee logout across workers still fails closed only when migration 019 is applied and every worker sets the Postgres revocation store.
- AuthBridge and SLIOps do not share one revocation list. Both hops have to succeed.
- Idempotency is in-process. A second Node worker can still insert a duplicate within the window.
- Archive XSS tests did not use Upstash or a browser.
- The spoof-then-self-approve chain from report `_1` remains unconfirmed. Report `_2` refuted it.

## Staging recommendation

Do not deploy tonight. When an operator is ready, deploy AuthBridge before SLIOps, apply migration 019 first, pin Node to 24.22.1 or later 24.x, and run `REPEN_RETEST_MATRIX.md` on staging. Production stays NO-GO until that staging retest is recorded against the deployed SHA.
