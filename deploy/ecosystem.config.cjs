/**

 * PM2 process file for Operations Workflow Hub staging on EC2.

 *

 *   cd /var/www/ops-hub-staging

 *   npm ci --omit=dev

 *   cp .env.staging.example .env.staging   # then edit secrets (RDS DATABASE_URL, etc.)

 *   pm2 start deploy/ecosystem.config.cjs

 *   pm2 save

 *

 * Both processes read `.env.staging` via application code (production-server / hub-worker loadDbEnv).

 */

module.exports = {

  apps: [

    {

      name: 'ops-hub-staging',

      script: 'scripts/production-server.js',

      cwd: __dirname + '/..',

      instances: 1,

      exec_mode: 'fork',

      autorestart: true,

      max_memory_restart: '512M',

      env: {

        NODE_ENV: 'staging',

        HUB_STORE_MODE: 'postgres',

        INTEGRATION_DISPATCH_MODE: 'queued',

        EMAIL_DELIVERY_MODE: 'queued',

      },

      error_file: '/var/log/ops-hub-staging/error.log',

      out_file: '/var/log/ops-hub-staging/out.log',

      merge_logs: true,

      time: true,

    },

    {

      name: 'ops-hub-staging-worker',

      script: 'scripts/hub-worker.js',

      cwd: __dirname + '/..',

      instances: 1,

      exec_mode: 'fork',

      autorestart: true,

      max_memory_restart: '256M',

      env: {

        NODE_ENV: 'staging',

        HUB_STORE_MODE: 'postgres',

        HUB_USE_LOCAL_STORE: '0',

        INTEGRATION_DISPATCH_MODE: 'queued',

        EMAIL_DELIVERY_MODE: 'queued',

        HUB_WORKER_MODE: 'continuous',

        HUB_WORKER_POLL_INTERVAL_MS: '5000',

        HUB_WORKER_BATCH_SIZE: '10',

        HUB_WORKER_ENABLE_INTEGRATIONS: 'true',

        HUB_WORKER_ENABLE_EMAIL: 'true',

      },

      error_file: '/var/log/ops-hub-staging/worker-error.log',

      out_file: '/var/log/ops-hub-staging/worker-out.log',

      merge_logs: true,

      time: true,

    },

  ],

};

