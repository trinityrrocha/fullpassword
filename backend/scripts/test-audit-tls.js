const assert = require('assert/strict');
const net = require('net');
const tls = require('tls');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');
Object.assign(process.env, {
  DB_HOST: '127.0.0.1', DB_USER: 'AUDIT_TEST', DB_PASSWORD: crypto.randomBytes(32).toString('hex'), DB_NAME: 'AUDIT_TEST',
  JWT_SECRET: crypto.randomBytes(64).toString('hex'), ADMIN_BOOTSTRAP_TOKEN: crypto.randomBytes(64).toString('hex'),
  APP_ORIGIN: 'http://127.0.0.1', SUPER_ADMIN_EMAIL: 'audit@example.invalid'
});
const nodemailer = require('nodemailer');
const { createTransportOptions } = require('../src/services/emailService');
const ftp = require('../src/services/remoteStorage/ftpStorageProvider');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));
const settings = { host: '127.0.0.1', security: 'starttls', timeout_seconds: 2 };
const run = async () => {
  assert.throws(() => createTransportOptions({ ...settings, security: 'none' }), error => error.code === 'SMTP_TLS_REQUIRED');
  await assert.rejects(ftp.testConnection({ secure: false }), error => error.code === 'FTPS_REQUIRED');
  const commands = [];
  const smtp = net.createServer(socket => {
    socket.write('220 localhost AUDIT_TEST\r\n');
    socket.on('error', () => {});
    socket.on('data', bytes => {
      const line = bytes.toString(); commands.push(line.split(' ')[0]);
      if (line.startsWith('EHLO')) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
      else if (line.startsWith('STARTTLS')) socket.write('500 TLS unavailable\r\n');
      else socket.end('500 refused\r\n');
    });
  });
  await listen(smtp);
  const mail = nodemailer.createTransport(createTransportOptions({ ...settings, port: smtp.address().port }));
  try { await assert.rejects(mail.verify()); } finally { mail.close(); await close(smtp); }
  assert.ok(commands.includes('STARTTLS\r\n'));
  assert.ok(!commands.some(command => command.startsWith('AUTH')));
  const ftpCommands = [];
  const ftps = net.createServer(socket => {
    socket.write('220 AUDIT_TEST\r\n'); socket.on('error', () => {});
    socket.on('data', bytes => { ftpCommands.push(bytes.toString().split(' ')[0]); socket.write('500 TLS unavailable\r\n'); });
  });
  await listen(ftps);
  try {
    await assert.rejects(ftp.testConnection({ secure: true, host: '127.0.0.1', port: ftps.address().port, username: 'AUDIT_TEST', password: 'synthetic-only', remote_path: '/' }));
  } finally { await close(ftps); }
  assert.ok(!ftpCommands.some(command => command.startsWith('USER') || command.startsWith('PASS')));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fullpassword-tls-test-'));
  try {
    const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
    const generated = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem')], { stdio: 'ignore', windowsHide: true });
    assert.equal(generated.status, 0, 'OpenSSL required for synthetic invalid-certificate test');
    const server = tls.createServer({ key: await fs.readFile(path.join(directory, 'key.pem')), cert: await fs.readFile(path.join(directory, 'cert.pem')) }, socket => socket.end());
    server.on('tlsClientError', () => {});
    await listen(server);
    const transport = nodemailer.createTransport(createTransportOptions({ ...settings, security: 'ssl_tls', port: server.address().port }));
    try {
      await assert.rejects(transport.verify(), error => /certificate|self.signed/i.test(error.message));
    } finally { transport.close(); await close(server); }
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'fullpassword-tls-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
  console.log('PASS local SMTP downgrade, invalid certificate and FTP downgrade rejected before credentials.');
};
run().catch(error => { console.error(error); process.exitCode = 1; });
