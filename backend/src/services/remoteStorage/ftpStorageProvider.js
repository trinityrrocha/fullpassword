const path = require('path');
const ftp = require('basic-ftp');

const BACKUP_FILE_PATTERN = /^fullpassword-backup-v2-[a-zA-Z0-9._-]+\.zip$/;

const withClient = async (config, operation) => {
  const client = new ftp.Client(30_000);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      secure: config.secure === true
    });
    return await operation(client);
  } finally {
    client.close();
  }
};

const safeRemoteName = (value) => {
  const name = path.posix.basename(String(value || ''));
  if (!BACKUP_FILE_PATTERN.test(name)) throw new Error('Nome de backup remoto inválido.');
  return name;
};

const testConnection = async (config) => withClient(config, async (client) => {
  await client.ensureDir(config.remote_path);
  await client.list(config.remote_path);
  return { host: config.host, remote_path: config.remote_path, secure: config.secure === true };
});

const upload = async ({ config, localPath, remoteName }) => withClient(config, async (client) => {
  const name = safeRemoteName(remoteName);
  await client.ensureDir(config.remote_path);
  const remotePath = path.posix.join(config.remote_path, name);
  await client.uploadFrom(localPath, remotePath);
  return { remoteId: null, remotePath };
});

const list = async ({ config, remotePath = config.remote_path }) => withClient(config, async (client) => {
  if (remotePath !== config.remote_path) throw new Error('Listagem fora da pasta configurada.');
  await client.ensureDir(config.remote_path);
  const entries = await client.list(config.remote_path);
  return entries
    .filter((entry) => entry.isFile)
    .map((entry) => ({
      remoteName: entry.name,
      remotePath: path.posix.join(config.remote_path, entry.name),
      modifiedAt: entry.modifiedAt || entry.rawModifiedAt,
      size: entry.size
    }));
});

const remove = async ({ config, remotePath }) => withClient(config, async (client) => {
  const expectedPrefix = `${config.remote_path.replace(/\/+$/, '')}/`;
  const candidate = String(remotePath || '');
  if (!candidate.startsWith(expectedPrefix) || !BACKUP_FILE_PATTERN.test(path.posix.basename(candidate))) {
    throw new Error('Tentativa de remoção fora da pasta de backup.');
  }
  await client.remove(candidate);
});

const applyRetention = async ({ config, retentionDays }) => {
  const cutoff = Date.now() - (Number(retentionDays) * 24 * 60 * 60 * 1000);
  const entries = await list({ config });
  let removed = 0;
  for (const entry of entries) {
    if (
      BACKUP_FILE_PATTERN.test(entry.remoteName)
      && Date.parse(entry.modifiedAt) < cutoff
    ) {
      await remove({ config, remotePath: entry.remotePath });
      removed += 1;
    }
  }
  return removed;
};

module.exports = {
  BACKUP_FILE_PATTERN,
  withClient,
  safeRemoteName,
  testConnection,
  upload,
  list,
  remove,
  applyRetention
};
