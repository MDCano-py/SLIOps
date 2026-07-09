/**
 * Seed demo hub data into the active store (Postgres when HUB_STORE_MODE=postgres).
 * Usage: npm run db:seed
 */

const { loadDbEnv, getPgClientConfig, assertLocalSeedAllowed } = require('./env');

loadDbEnv();

async function seedRegistryIfPostgres() {
  const mode = String(process.env.HUB_STORE_MODE || process.env.HUB_STORE || '').toLowerCase();
  if (mode !== 'postgres') return;

  const { Pool } = require('pg');
  const registry = require('../../api/lib/hub/document-registry');
  const pool = new Pool(getPgClientConfig());

  try {
    const client = await pool.connect();
    try {
      const count = await client.query('SELECT COUNT(*)::int AS n FROM document_types');
      if ((count.rows[0]?.n || 0) > 0) {
        console.log('[db:seed] document_types already populated — skipping registry seed');
        return;
      }

      const types = registry.listDocumentTypes({ enabledOnly: false });
      for (const dt of types) {
        await client.query(
          `INSERT INTO document_types
           (id, key, label, description, category, enabled, icon, render_mode, custom_component,
            requires_signature, requires_review, allow_custom_workflow, default_workflow_template_id, storage_destination)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (key) DO NOTHING`,
          [
            require('crypto').randomUUID(),
            dt.key,
            dt.label,
            dt.description || null,
            dt.category || null,
            dt.enabled !== false,
            dt.icon || null,
            dt.render_mode || 'schema',
            dt.custom_component || null,
            !!dt.requires_signature,
            !!dt.requires_review,
            dt.allow_custom_workflow !== false,
            dt.default_workflow_template_id || null,
            dt.storage_destination || null,
          ]
        );
      }
      console.log(`[db:seed] seeded ${types.length} document_types from registry`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  assertLocalSeedAllowed();
  const mode = String(process.env.HUB_STORE_MODE || '').toLowerCase();
  if (mode && mode !== 'postgres') {
    console.log(`[db:seed] HUB_STORE_MODE=${mode} — seeding into current store adapter`);
  } else if (mode === 'postgres') {
    process.env.HUB_USE_LOCAL_STORE = '0';
  }

  await seedRegistryIfPostgres();

  delete require.cache[require.resolve('../../api/lib/hub/db/index.js')];
  delete require.cache[require.resolve('../../for-dev/hub-demo-seed')];

  const seed = require('../../for-dev/hub-demo-seed');
  if (typeof seed.seedDemoData !== 'function') {
    throw new Error('hub-demo-seed.js did not export seedDemoData()');
  }
  const out = await seed.seedAllDemoData();
  console.log('[db:seed] demo requests', out || 'done');
  if (out.archive) {
    console.log('[db:seed] demo archives', out.archive.message || out.archive);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
