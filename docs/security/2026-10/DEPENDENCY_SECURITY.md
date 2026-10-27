# Dependency and runtime exposure — October 2026

Confirmed from local files and the local toolchain. Host images, the staging Node binary, and secret rotation were not changed and were not observed.

## Node.js

| Item | State |
| --- | --- |
| Advisory line | 24.22.1, or 22.23.4, or 26.12.1. This repo targets 24.22.1 or a later 24.x |
| `package.json` engines | `>=24.22.1 <25` |
| Process that ran the integration tests | v24.18.0. That process is outside the patched 24.22.1 line |
| `scripts/production-server.js` | calls `assertNodeRuntime()` and exits when the binary is older than 24.22.1. The integration script does not, so the tests could run on 24.18.0 |
| Deployed binary | UNKNOWN. `pm2` can keep an older interpreter even when `engines` is current |

The October Node fixes are not present in the test process. They are also not proven on the server.

## Lockfile

`package-lock.json` is version 1.2.0 with the application. Resolved copies inspected:

| Package | Lockfile version | Note |
| --- | --- | --- |
| `@xmldom/xmldom` | 0.8.15 | still the resolved copy; not upgraded in this pass |
| `uuid` | 8.3.2 | pulled through the existing Microsoft auth dependency; not upgraded |

`npm audit` was not run. No dependency was upgraded. STR-D01–D16 remain BLOCKED until an image or host SBOM is produced from the deployed tree.

## Python

`requirements.txt` uses ranges. There is no pip lockfile. The local venv, which is not the Docker image, resolved:

| Package | Venv version |
| --- | --- |
| fastapi | 0.139.0 |
| uvicorn | 0.51.0 |
| python-jose | 3.5.0 |
| cryptography | 43.0.3 |
| python-multipart | 0.0.32 |
| redis | 8.0.1 |
| httpx | 0.28.1 |
| pysaml2 | 7.5.4 |
| ecdsa | 0.19.2 |

Image Python is declared as 3.11. Local interpreter is 3.12.10. Whether the running container matches either is UNKNOWN. python-jose 3.5.0 and ecdsa 0.19.2 stay on the dependency watch list. They were not upgraded here.

## PHP

No PHP file, `php-fpm` upstream, or `fastcgi_pass` appears in the SLIOps or AuthBridge trees that were searched. `php` is not on this workstation PATH. That does not prove the host has no PHP. CVE-2026-109618 and CVE-2026-109619 stay UNKNOWN until the operator commands in `DEPLOYMENT_IDENTITY.md` are run. PHP was not installed for this check.

## HTTP surface

| Control | Repo state | Live state |
| --- | --- | --- |
| AuthBridge `/docs`, `/redoc`, `/openapi.json` | off unless `AUTHBRIDGE_EXPOSE_DOCS` is `1`, `true`, or `yes`. nginx example returns 404 for those paths | UNKNOWN |
| HTTPS redirect | AuthBridge nginx example returns 301 from port 80 | UNKNOWN |
| HSTS | nginx examples set `max-age=31536000` without `includeSubDomains`. `scripts/server-core.js` sets `includeSubDomains` when `NODE_ENV` is staging or production | UNKNOWN which header the browser receives |
| Cookies | SLIOps session cookie is HttpOnly, Secure, SameSite=Lax, path scoped to the mount. AuthBridge logout clears `sli_session` with the configured Secure and SameSite flags | Cookie domain on the live host UNKNOWN |
| JWT revocation | AuthBridge jti key in its own Redis. SLIOps HMAC cutoff in Postgres when configured | Neither store was read on a live host |

## Secret rotation

No credential was rotated, printed, or written. Rotation is still required operational evidence for any secret that appeared in the October reports or in a local `.env`. Record the rotation in the operator log with the system name and the time. Do not store the new value in this repository.
