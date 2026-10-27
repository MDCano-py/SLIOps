# rePen retest matrix — October 2026

Historical retest status is the October Strix result. It is not a retest of `bb4cc8c` or `7bdbca1`. Deployed status is NOT DEPLOYED for every row. Retest status stays "not retested" until an independent pass against the deployed SHA.

| Original ID | What to repeat after staging deploy | Local integration | Independent retest |
| --- | --- | --- | --- |
| STR-W03 / F-01 | Save a JSA or SWP whose snapshot contains a script and an `onerror` handler. Open a historical row that still has the raw markup. Confirm the iframe sandbox attribute is empty | PASS on the memory stub. Browser iframe not opened | not retested |
| STR-S05 / F-03 / vuln-0001 | As the requester, complete a signature step assigned to someone else, then one assigned to yourself. As the assignee, complete it | PASS | not retested |
| STR-S06 | PATCH `status`, `completed_by`, and `assigned_user_email` on a waiting step | PASS, HTTP 400 | not retested |
| STR-W07 / F-02 / vuln-0002 | POST a request with another person's email, `status=completed`, and a MaintainX id. Read the stored row | PASS | not retested |
| vuln-0003 | As a user who is not the requester or assignee, GET `/hub/requests` and `/hub/dashboard/action-required` | PASS, `access=summary` | not retested |
| STR-W08 / F-06 | Mark another recipient's notification read | PASS, HTTP 404 | not retested |
| STR-W05 / F-05 | Copy the session cookie, log out, replay it, then sign in again | PASS for SLIOps HMAC via Postgres and for AuthBridge jti via disposable Redis | not retested |
| STR-A15 / F-04 | Cross-site GET logout, then same-origin POST logout | PASS | not retested |
| STR-W06 | Submit the same roll-off body twice, then change one field | PASS | not retested |
| STR-A13 | Redirect targets with a backslash, userinfo, and a scheme-relative URL | covered by the earlier AuthBridge unit test, not re-run as a browser test in this pass | not retested |
| STR-A17 | Unknown `app_id` returns the generic error | unit coverage from `e05b2fc`; not replayed on a live host | not retested |
| STR-A19 | Non-ASCII admin key returns 403 | unit coverage from `e05b2fc` | not retested |
| Nil Ignition tenant | Public metadata does not return the zero GUID | unit coverage from `e05b2fc` | not retested |
| UUID `22P02` | `GET /hub/requests/not-a-uuid` | PASS, HTTP 404 | not retested |
| `pipe.zrem` | Create and delete an SWP | PASS on the memory stub | not retested |
| MaintainX PUT 500 | PUT a disallowed type and a small JPEG | PASS with mocked upstream. Live PUT not retested | not retested |
| STR-D01–D16 | Compare the deployed SBOM with the advisory set | BLOCKED | not retested |
| Timeline 500 | Open the timeline of a request whose workflow step has completed | PASS after `bb4cc8c` | not retested |

Blocked findings from report `_3` stay blocked. A local PASS does not close them.
