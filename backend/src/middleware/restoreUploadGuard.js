const fs = require('fs/promises');
const path = require('path');
const db = require('../config/database');
const { BACKUP_TEMP_DIR, BACKUP_MAX_UPLOAD_BYTES, BACKUP_RESTORE_TIMEOUT_MS } = require('../config/backupConfig');

// Dedicated session lock is shared by all API instances connected to this database.
// Never use a pool-level query for this lock: ownership belongs to the connection.
const LOCK_NAMESPACE = 1179669067;
const LOCK_RESOURCE = 13;
const createRestoreUploadGuard = ({timeoutMs=BACKUP_RESTORE_TIMEOUT_MS,statfs=fs.statfs}={}) => async (req, res, next) => {
  let client;
  let locked = false;
  let released = false;
  let timer;
  const cleanupFile = async () => {
    const file = req.restoreUploadPath;
    if (!file) return;
    const directory = path.resolve(BACKUP_TEMP_DIR, 'uploads');
    if (path.dirname(path.resolve(file)) !== directory || !/^[a-f0-9-]+\.upload$/.test(path.basename(file))) return;
    await fs.rm(file, { force: true }).catch(() => {
      console.warn('Limpeza de upload temporário pendente.', { code: 'RESTORE_TEMP_CLEANUP_FAILED' });
    });
  };
  const release = async () => {
    if (req.restoreProcessing) return;
    if (released) return;
    released = true;
    clearTimeout(timer);
    await cleanupFile();
    if (client) {
      try {
        if (locked) await client.query('SELECT pg_advisory_unlock($1,$2)', [LOCK_NAMESPACE, LOCK_RESOURCE]);
        client.release();
      } catch { client.release(true); }
    }
  };
  try {
    client = await db.pool.connect();
    locked = (await client.query('SELECT pg_try_advisory_lock($1,$2) AS locked', [LOCK_NAMESPACE, LOCK_RESOURCE])).rows[0].locked;
    if (!locked) {
      await release();
      return res.status(429).json({ code: 'RESTORE_BUSY', error: 'Já existe uma validação ou restauração em andamento.' });
    }
    const directory = path.join(BACKUP_TEMP_DIR, 'uploads');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    // The database lease excludes every active uploader. Matching files are leftovers from a crashed process.
    for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
      if(entry.isFile() && /^[a-f0-9-]+\.upload$/.test(entry.name)) await fs.rm(path.join(directory,entry.name),{force:true});
    }
    const stats = await statfs(directory);
    const files = await fs.readdir(directory, { withFileTypes: true });
    let used = 0;
    for (const file of files) {
      if (file.isFile()) used += (await fs.stat(path.join(directory, file.name))).size;
    }
    if (used > BACKUP_MAX_UPLOAD_BYTES || stats.bavail * stats.bsize < BACKUP_MAX_UPLOAD_BYTES + 64 * 1024 * 1024) {
      await release();
      return res.status(507).json({ code: 'RESTORE_TEMP_SPACE', error: 'Espaço temporário insuficiente para receber backup.' });
    }
    req.cleanupRestoreUpload = cleanupFile;
    req.releaseRestoreLease = release;
    res.once('finish', release);
    res.once('close', release);
    req.once('aborted', release);
    timer = setTimeout(() => {
      if (!res.headersSent) res.status(408).json({ code: 'RESTORE_TIMEOUT', error: 'Tempo limite da restauração excedido.' });
      req.destroy();
      void release();
    }, timeoutMs);
    timer.unref();
    next();
  } catch (error) {
    await release();
    next(error);
  }
};

const withRestoreLease = (handler) => async (req, res, next) => {
  req.restoreProcessing = true;
  try { await handler(req, res, next); }
  catch (error) { next(error); }
  finally {
    req.restoreProcessing = false;
    await req.releaseRestoreLease?.();
  }
};

const restoreUploadGuard=createRestoreUploadGuard();
module.exports = { createRestoreUploadGuard, restoreUploadGuard, withRestoreLease, LOCK_NAMESPACE, LOCK_RESOURCE };
