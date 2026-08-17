# SLIOps (`production-ec2`)

Lean runtime snapshot for EC2. Full source, reports, and tests stay on `main`.

## Clone on the instance

```bash
git clone \
  --depth 1 \
  --single-branch \
  --branch production-ec2 \
  https://github.com/MDCano-py/SLIOps.git \
  /opt/wos/app
```

## Start

```bash
cd /opt/wos/app
cp .env.example .env   # fill secrets on the host; never commit .env
npm ci
npm run db:migrate
NODE_ENV=production npm start
```

Optional worker: `npm run hub-worker`

See `DEPLOYMENT_STAGING.md`, `DEPLOYMENT_NOTES.md`, `RDS_POSTGRES_SETUP.md`, and `deploy/` for Nginx, systemd, and RDS.
