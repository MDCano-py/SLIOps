# Dependency, Node, and PHP exposure — October 2026

This note is separate from the application fixes. A manifest range is not a deployed fix.

## Node.js

Official October 21, 2026 releases: **24.22.1** (24 LTS), **22.23.4** (22 LTS), **26.12.1**. Advisory: https://nodejs.org/en/blog/vulnerability/october-2026-security-releases

| Source | Version | Meaning |
| --- | --- | --- |
| SLIOps `package.json` `engines.node` | `>=24.22.1 <25` | Set in parent commit `c8607fc`. This is a requirement, not proof the host runs it |
| Process that ran the local tests | `v24.18.0` | Below 24.22.1. `node:zlib` Brotli and the DNS/TLS/HTTP fixes in that advisory are **not** present in this process |
| EC2 / PM2 Node | UNKNOWN | Host validation pending. Do not install a new Node on production from this pass |

Preferred host target remains 24.22.1 or a later 24.x, because the app and tests are already aimed at that line. Upgrade the runtime on staging, rerun `npm run security:october-2026-remediation-test` plus the staging smoke the host already uses, then promote. No dependency mass-upgrade was performed.

## PHP

CVE-2026-109618 and CVE-2026-109619 were checked against the trees, not against the hosts.

Searches of SLIOps and AuthBridge Docker/nginx/package files found no PHP-FPM, mod_php, php-cgi, FrankenPHP, or LiteSpeed upstream.

**No PHP evidence in inspected code/config; host validation pending.**

Do not install PHP to satisfy the advisory. On the EC2 host, the operator should run the service inventory they already use (`nginx -T` upstreams, `systemctl` unit list, package list) and compare any PHP package to the fixed builds on https://www.php.net/archive/2026.php. If no package is installed, record that and close the item.

## Python resolutions in the local AuthBridge venv

There is no committed pip lockfile. `requirements.txt` has ranges. The virtualenv on this workstation resolved:

| Package | Requirement range | Installed | Report ask (`_3` p.4) |
| --- | --- | --- | --- |
| python-jose | `>=3.3` | 3.5.0 | `>=3.4.0` met in this venv only |
| python-multipart | `>=0.0.9` | 0.0.32 | `>=0.0.18` met in this venv only |
| cryptography | `>=42.0` | 43.0.3 | `>=42.0.4` met in this venv only |
| ecdsa | transitive | 0.19.2 | risk acceptance still required; not removed |

The container or EC2 image was not inspected. STR-D01–D16 stay **BLOCKED** until an image SBOM or `pip freeze` from the running host is attached to the ticket.

## npm lockfile (SLIOps)

| Package | Lock resolution | Note |
| --- | --- | --- |
| `@xmldom/xmldom` | 0.8.15 | Meets the `>=0.8.15` line cited in `_3`. Confirm `npm ci` on the host uses this lockfile |
| `uuid` | 8.3.2 via `@azure/msal-node` | Still the deferred moderate advisory. Not force-upgraded |

`npm audit` was not run against the registry in this pass.

## Secret rotation evidence

| Secret | Evidence in this workspace | Required owner action |
| --- | --- | --- |
| `SESSION_SECRET` | Names only. No rotation receipt | If file exposure ever succeeded, rotate, restart Node, confirm old HMAC cookies fail and a new login works |
| `ENTRA_CLIENT_SECRET` | Names only | Rotate in Entra, update the secret store, restart AuthBridge, confirm one staging login |
| `CLEANUP_SECRET` | Code fail-closed path exists from earlier work. Host value not inspected | Show the variable is set and an empty secret returns 503. Do not paste the value |
| `ADMIN_API_KEY` | Example file says to load it from the secret manager | Confirm it is set. Non-ASCII keys now return 403 instead of 500 |

None of these were rotated by this pass.
