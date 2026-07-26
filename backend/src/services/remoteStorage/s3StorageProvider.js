const fs = require('fs');
const path = require('path');
const {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const BACKUP_FILE_PATTERN = /^fullpassword-backup-(?:v2-[a-zA-Z0-9._-]+\.zip|v1-[a-zA-Z0-9._-]+\.enc\.json)$/;

const createClient = (config) => new S3Client({
  endpoint: config.endpoint,
  region: config.region,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey
  }
});

const joinRemoteKey = (prefix, name) => {
  const safeName = path.posix.basename(String(name || ''));
  if (!BACKUP_FILE_PATTERN.test(safeName)) {
    throw new Error('Nome de backup remoto inválido.');
  }
  return `${String(prefix || '').replace(/^\/+|\/+$/g, '')}/${safeName}`;
};

const testConnection = async (config) => {
  const client = createClient(config);
  await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  return { bucket: config.bucket, endpoint: config.endpoint };
};

const upload = async ({ config, localPath, remoteName, backupFormat = 'v2' }) => {
  const client = createClient(config);
  const remoteKey = joinRemoteKey(config.prefix, remoteName);
  const task = new Upload({
    client,
    params: {
      Bucket: config.bucket,
      Key: remoteKey,
      Body: fs.createReadStream(localPath),
      ContentType: backupFormat === 'v1' ? 'application/json' : 'application/zip',
      Metadata: {
        app: 'fullpassword',
        format: backupFormat
      }
    },
    leavePartsOnError: false
  });
  const result = await task.done();
  return {
    remoteId: result.ETag || null,
    remotePath: remoteKey
  };
};

const list = async ({ config, prefix = config.prefix }) => {
  const client = createClient(config);
  const normalizedPrefix = String(prefix || '').replace(/^\/+/, '');
  const objects = [];
  let continuationToken;
  do {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: normalizedPrefix,
      ContinuationToken: continuationToken
    }));
    objects.push(...(result.Contents || []).map((item) => ({
      remoteKey: item.Key,
      modifiedAt: item.LastModified,
      size: item.Size
    })));
    continuationToken = result.IsTruncated ? result.NextContinuationToken : null;
  } while (continuationToken);
  return objects;
};

const remove = async ({ config, remoteKey }) => {
  const prefix = String(config.prefix || '').replace(/^\/+/, '');
  const key = String(remoteKey || '');
  const name = path.posix.basename(key);
  if (!key.startsWith(prefix) || !BACKUP_FILE_PATTERN.test(name)) {
    throw new Error('Tentativa de remoção fora do prefixo de backup.');
  }
  const client = createClient(config);
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
};

const applyRetention = async ({ config, retentionDays }) => {
  const cutoff = Date.now() - (Number(retentionDays) * 24 * 60 * 60 * 1000);
  const objects = await list({ config });
  let removed = 0;
  for (const object of objects) {
    if (
      BACKUP_FILE_PATTERN.test(path.posix.basename(object.remoteKey || ''))
      && Date.parse(object.modifiedAt) < cutoff
    ) {
      await remove({ config, remoteKey: object.remoteKey });
      removed += 1;
    }
  }
  return removed;
};

module.exports = {
  BACKUP_FILE_PATTERN,
  createClient,
  joinRemoteKey,
  testConnection,
  upload,
  list,
  remove,
  applyRetention
};
