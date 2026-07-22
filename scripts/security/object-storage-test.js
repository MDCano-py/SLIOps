#!/usr/bin/env node
/**
 * WOS-88 — Object storage (S3 / local) security and behavior tests.
 * Usage: npm run security:object-storage-test
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const fsp = require('fs/promises');

const ROOT = path.join(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function withEnv(overrides, fn) {
  const saved = { ...process.env };
  const keys = Object.keys(overrides);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = String(v);
  }
  const restore = () => {
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(saved, k)) process.env[k] = saved[k];
      else delete process.env[k];
    }
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(restore);
    restore();
    return out;
  } catch (err) {
    restore();
    throw err;
  }
}

function loadStorage() {
  const id = require.resolve(path.join(ROOT, 'api/lib/storage/index.js'));
  delete require.cache[id];
  for (const rel of [
    'api/lib/storage/config.js',
    'api/lib/storage/keys.js',
    'api/lib/storage/s3.js',
    'api/lib/storage/local.js',
  ]) {
    try {
      delete require.cache[require.resolve(path.join(ROOT, rel))];
    } catch {
      /* */
    }
  }
  return require(id);
}

async function main() {
  console.log('=== WOS-88 Object Storage Test ===\n');

  // --- Package / source inventory ---
  {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert('package.json has no @vercel/blob', !pkg.dependencies?.['@vercel/blob']);
    assert('package.json includes @aws-sdk/client-s3', !!pkg.dependencies?.['@aws-sdk/client-s3']);
    assert(
      'package.json includes @aws-sdk/s3-request-presigner',
      !!pkg.dependencies?.['@aws-sdk/s3-request-presigner']
    );
    const mx = fs.readFileSync(path.join(ROOT, 'api/maintainx.js'), 'utf8');
    assert('maintainx does not require @vercel/blob', !/require\(['"]@vercel\/blob['"]\)/.test(mx));
    assert('maintainx does not reference BLOB_READ_WRITE_TOKEN', !/BLOB_READ_WRITE_TOKEN/.test(mx));
    assert('maintainx uses object storage module', /require\(['"]\.\/lib\/storage['"]\)/.test(mx));
    assert('vendor download uses key param', /req\.query\.key/.test(mx));
    assert('no vercel-storage host allowlist', !/public\.blob\.vercel-storage\.com/.test(mx));
  }

  // --- Missing configuration ---
  await withEnv(
    {
      NODE_ENV: 'staging',
      STORAGE_DRIVER: 'none',
      S3_BUCKET: '',
    },
    async () => {
      const storage = loadStorage();
      storage.resetStorageCache();
      assert('staging unconfigured isConfigured=false', storage.isConfigured() === false);
      let threw = false;
      try {
        storage.assertConfigured();
      } catch (err) {
        threw = err.code === 'STORAGE_NOT_CONFIGURED';
      }
      assert('assertConfigured throws STORAGE_NOT_CONFIGURED', threw);
      const status = storage.getStatus();
      assert('status message has no secrets', !/AKIA|secret/i.test(JSON.stringify(status)));
    }
  );

  // --- Local forbidden on staging ---
  await withEnv(
    {
      NODE_ENV: 'staging',
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_ROOT: path.join(os.tmpdir(), 'wos88-forbidden'),
      S3_BUCKET: '',
    },
    async () => {
      const storage = loadStorage();
      storage.resetStorageCache();
      assert('local driver not configured on staging', storage.isConfigured() === false);
    }
  );

  // --- Local adapter happy path (development) ---
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'wos88-storage-'));
  await withEnv(
    {
      NODE_ENV: 'development',
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_ROOT: tmpRoot,
      S3_BUCKET: undefined,
      PRESIGNED_URL_EXPIRES_SECONDS: '60',
    },
    async () => {
      const storage = loadStorage();
      storage.resetStorageCache();
      assert('local configured in development', storage.isConfigured() === true);

      // Invalid uploads
      let invalidType = false;
      try {
        storage.validateUploadBuffer({
          kind: 'vendor_doc',
          filename: 'evil.exe',
          contentType: 'application/x-msdownload',
          byteLength: 100,
        });
      } catch (err) {
        invalidType = err.name === 'StorageValidationError';
      }
      assert('rejects disallowed vendor extension', invalidType);

      let emptyBody = false;
      try {
        storage.validateUploadBuffer({
          kind: 'photo',
          filename: 'a.jpg',
          contentType: 'image/jpeg',
          byteLength: 0,
        });
      } catch (err) {
        emptyBody = err.code === 'INVALID_UPLOAD' || err.name === 'StorageValidationError';
      }
      assert('rejects empty upload', emptyBody);

      let tooLarge = false;
      try {
        storage.validateUploadBuffer({
          kind: 'photo',
          filename: 'big.jpg',
          contentType: 'image/jpeg',
          byteLength: storage.MAX_PHOTO_BYTES
            ? storage.MAX_PHOTO_BYTES + 1
            : 11 * 1024 * 1024,
        });
      } catch (err) {
        tooLarge = err.code === 'TOO_LARGE' || /exceeds/i.test(err.message);
      }
      // MAX_PHOTO_BYTES may not be re-exported — use keys module
      if (!tooLarge) {
        const keys = require(path.join(ROOT, 'api/lib/storage/keys.js'));
        try {
          keys.validateUploadBuffer({
            kind: 'photo',
            filename: 'big.jpg',
            contentType: 'image/jpeg',
            byteLength: keys.MAX_PHOTO_BYTES + 1,
          });
        } catch (err) {
          tooLarge = err.code === 'TOO_LARGE';
        }
      }
      assert('rejects oversized photo', tooLarge);

      // Keys are server-controlled
      const keyA = storage.buildVendorDocObjectKey('VEN-A', 'w9', 'form.pdf');
      const keyB = storage.buildVendorDocObjectKey('VEN-B', 'w9', 'form.pdf');
      assert('vendor key includes ref A', keyA.startsWith('vendor-docs/VEN-A/'));
      assert('vendor key includes ref B', keyB.startsWith('vendor-docs/VEN-B/'));
      assert('keys differ across vendors', keyA !== keyB);

      let isolation = false;
      try {
        storage.assertVendorDocKey(keyA, 'VEN-B');
      } catch (err) {
        isolation = err.code === 'KEY_ISOLATION';
      }
      assert('cross-vendor key rejected (KEY_ISOLATION)', isolation);

      let traversal = false;
      try {
        storage.assertAllowedObjectKey('../etc/passwd');
      } catch (err) {
        traversal = err.code === 'INVALID_KEY';
      }
      assert('path traversal key rejected', traversal);

      // Put / get / list / delete
      const body = Buffer.from('%PDF-1.4 fake');
      await storage.putObject({ key: keyA, body, contentType: 'application/pdf' });
      const got = await storage.getObject({ key: keyA });
      assert('getObject returns body', got.body.equals(body));
      assert('getObject content-type', got.contentType === 'application/pdf');

      const listed = await storage.listObjects({ prefix: 'vendor-docs/VEN-A/' });
      assert('listObjects finds upload', listed.some((o) => o.key === keyA));

      // Presign expiration metadata
      const signed = await storage.getPresignedGetUrl({ key: keyA, expiresIn: 60 });
      assert('presign returns expiresIn=60', signed.expiresIn === 60);
      assert('presign includes key', signed.key === keyA);
      assert('local presign is not a public http URL', !/^https?:\/\//i.test(signed.url));

      // Simulated storage failure: delete root mid-flight via bad key under wrong root
      let storageFail = false;
      try {
        await storage.getObject({ key: 'vendor-docs/VEN-A/does-not-exist.pdf__deadbeef' });
      } catch {
        storageFail = true;
      }
      assert('missing object fails clearly', storageFail);

      await storage.deleteObject({ key: keyA });
      const listed2 = await storage.listObjects({ prefix: 'vendor-docs/VEN-A/' });
      assert('deleteObject removes object', !listed2.some((o) => o.key === keyA));
    }
  );

  // --- Env examples ---
  {
    const envEx = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    const stgEx = fs.readFileSync(path.join(ROOT, '.env.staging.example'), 'utf8');
    assert('.env.example documents S3_BUCKET', /S3_BUCKET=/.test(envEx));
    assert('.env.example has no BLOB_READ_WRITE_TOKEN', !/BLOB_READ_WRITE_TOKEN/.test(envEx));
    assert('.env.staging.example documents S3_BUCKET', /S3_BUCKET=/.test(stgEx));
    assert('.env.staging.example has no BLOB_READ_WRITE_TOKEN', !/BLOB_READ_WRITE_TOKEN/.test(stgEx));
    assert('DEPLOYMENT_STAGING mentions IAM', /IAM role/i.test(fs.readFileSync(path.join(ROOT, 'DEPLOYMENT_STAGING.md'), 'utf8')));
    assert(
      'index.html downloads via key',
      /vendor-doc.*key=/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'))
    );
  }

  // Cleanup temp
  try {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  } catch {
    /* */
  }

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
