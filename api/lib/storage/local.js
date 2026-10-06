/**
 * WOS-88 — Local filesystem object storage (development only).
 * Forbidden when NODE_ENV is staging or production.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function createLocalAdapter(cfg) {
  if (cfg.deployed) {
    throw new Error('STORAGE_DRIVER=local is not allowed on staging/production');
  }
  if (!cfg.localRoot) {
    throw new Error('STORAGE_LOCAL_ROOT is required for STORAGE_DRIVER=local');
  }

  const root = path.resolve(cfg.localRoot);

  function resolveKeyPath(key) {
    if (!key || key.includes('..') || key.startsWith('/') || key.includes('\\')) {
      throw new Error('Invalid object key');
    }
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep) && full !== root) {
      throw new Error('Object key escapes local root');
    }
    return full;
  }

  async function putObject({ key, body, contentType }) {
    const full = resolveKeyPath(key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, body);
    const metaPath = full + '.meta.json';
    await fsp.writeFile(
      metaPath,
      JSON.stringify({ contentType: contentType || 'application/octet-stream', key }),
      'utf8'
    );
    return { key, contentType };
  }

  async function getObject({ key }) {
    const full = resolveKeyPath(key);
    const body = await fsp.readFile(full);
    let contentType = 'application/octet-stream';
    try {
      const meta = JSON.parse(await fsp.readFile(full + '.meta.json', 'utf8'));
      contentType = meta.contentType || contentType;
    } catch {
      /* no meta */
    }
    const st = await fsp.stat(full);
    return {
      key,
      body,
      contentType,
      contentLength: body.length,
      lastModified: st.mtime,
    };
  }

  async function deleteObject({ key }) {
    const full = resolveKeyPath(key);
    try {
      await fsp.unlink(full);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    try {
      await fsp.unlink(full + '.meta.json');
    } catch {
      /* ignore */
    }
    return { key, deleted: true };
  }

  async function deleteObjects({ keys }) {
    let deleted = 0;
    for (const key of keys || []) {
      await deleteObject({ key });
      deleted += 1;
    }
    return { deleted };
  }

  async function listObjects({ prefix, maxKeys = 1000 }) {
    const items = [];

    async function walk(dir, relBase) {
      if (items.length >= maxKeys) return;
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (err.code === 'ENOENT') return;
        throw err;
      }
      for (const ent of entries) {
        if (items.length >= maxKeys) return;
        if (ent.name.endsWith('.meta.json')) continue;
        const full = path.join(dir, ent.name);
        const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
          await walk(full, rel);
        } else if (ent.isFile()) {
          const key = rel.replace(/\\/g, '/');
          if (prefix && !key.startsWith(prefix)) continue;
          const st = await fsp.stat(full);
          items.push({ key, size: st.size, lastModified: st.mtime });
        }
      }
    }

    await walk(root, '');
    return items.filter((i) => !prefix || i.key.startsWith(prefix)).slice(0, maxKeys);
  }

  async function getPresignedGetUrl({ key, expiresIn }) {
    // Local adapter cannot mint AWS presigned URLs — return a deterministic
    // opaque token URL that only the app proxy understands in tests.
    const seconds = expiresIn || cfg.presignExpires || 300;
    const exp = Date.now() + seconds * 1000;
    const token = crypto
      .createHmac('sha256', 'local-storage-dev-only')
      .update(`${key}:${exp}`)
      .digest('hex')
      .slice(0, 24);
    return {
      url: `local-presign://${encodeURIComponent(key)}?exp=${exp}&sig=${token}`,
      expiresIn: seconds,
      key,
      local: true,
    };
  }

  async function healthCheck() {
    try {
      await fsp.mkdir(root, { recursive: true });
      await fsp.access(root, fs.constants.W_OK);
      return { ok: true, driver: 'local', root };
    } catch (err) {
      return { ok: false, driver: 'local', root, error: err.message };
    }
  }

  return {
    name: 'local',
    putObject,
    getObject,
    deleteObject,
    deleteObjects,
    listObjects,
    getPresignedGetUrl,
    healthCheck,
  };
}

module.exports = { createLocalAdapter };
