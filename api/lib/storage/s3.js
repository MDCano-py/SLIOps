/**
 * WOS-88 — Amazon S3 object storage adapter (private bucket).
 */

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

function createS3Adapter(cfg) {
  if (!cfg.bucket) {
    throw new Error('S3_BUCKET is required for STORAGE_DRIVER=s3');
  }

  const clientConfig = {
    region: cfg.region,
  };
  if (cfg.endpoint) {
    clientConfig.endpoint = cfg.endpoint;
    clientConfig.forcePathStyle = cfg.forcePathStyle !== false;
  } else if (cfg.forcePathStyle) {
    clientConfig.forcePathStyle = true;
  }

  // Prefer EC2 IAM role / default provider chain. Explicit keys only if set.
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
    };
  }

  const client = new S3Client(clientConfig);
  const bucket = cfg.bucket;

  async function putObject({ key, body, contentType, metadata }) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType || 'application/octet-stream',
        // Private by default — never ACL public-read
        Metadata: metadata || undefined,
      })
    );
    return { key, bucket, contentType };
  }

  async function getObject({ key }) {
    const out = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    const chunks = [];
    for await (const chunk of out.Body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return {
      key,
      body: Buffer.concat(chunks),
      contentType: out.ContentType || 'application/octet-stream',
      contentLength: out.ContentLength || 0,
      lastModified: out.LastModified || null,
    };
  }

  async function deleteObject({ key }) {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    return { key, deleted: true };
  }

  async function deleteObjects({ keys }) {
    const unique = [...new Set((keys || []).filter(Boolean))];
    if (!unique.length) return { deleted: 0 };
    // S3 allows up to 1000 keys per DeleteObjects
    let deleted = 0;
    for (let i = 0; i < unique.length; i += 1000) {
      const slice = unique.slice(i, i + 1000);
      const out = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: slice.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      );
      deleted += (out.Deleted || []).length || slice.length;
    }
    return { deleted };
  }

  async function listObjects({ prefix, maxKeys = 1000 }) {
    const items = [];
    let token;
    do {
      const out = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix || '',
          ContinuationToken: token,
          MaxKeys: Math.min(maxKeys, 1000),
        })
      );
      for (const obj of out.Contents || []) {
        items.push({
          key: obj.Key,
          size: obj.Size || 0,
          lastModified: obj.LastModified || null,
        });
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
      if (items.length >= maxKeys) break;
    } while (token);
    return items.slice(0, maxKeys);
  }

  async function getPresignedGetUrl({ key, expiresIn }) {
    const seconds = expiresIn || cfg.presignExpires || 300;
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    const url = await getSignedUrl(client, command, { expiresIn: seconds });
    return { url, expiresIn: seconds, key };
  }

  async function healthCheck() {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return { ok: true, driver: 's3', bucket };
    } catch (err) {
      return {
        ok: false,
        driver: 's3',
        bucket,
        error: err.name || 'S3Error',
        message: err.message || 'S3 health check failed',
      };
    }
  }

  return {
    name: 's3',
    putObject,
    getObject,
    deleteObject,
    deleteObjects,
    listObjects,
    getPresignedGetUrl,
    healthCheck,
  };
}

module.exports = { createS3Adapter };
