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
    const key=await fs.readFile(path.join(directory,'key.pem')),cert=await fs.readFile(path.join(directory,'cert.pem'));
    const ftpInvalidCommands=[];
    const ftpInvalid=net.createServer(socket=>{
      socket.write('220 SYNTHETIC_FTPS\r\n');socket.on('error',()=>{});
      const upgrade=bytes=>{
        const command=bytes.toString();ftpInvalidCommands.push(command.split(' ')[0]);
        if(command.startsWith('AUTH TLS')) {
          socket.removeListener('data',upgrade);socket.write('234 TLS ready\r\n');
          const secure=new tls.TLSSocket(socket,{isServer:true,secureContext:tls.createSecureContext({key,cert})});
          secure.on('error',()=>{});secure.on('data',bytes=>{ftpInvalidCommands.push(bytes.toString().split(' ')[0]);secure.end();});
        } else socket.end('500 TLS required\r\n');
      };socket.on('data',upgrade);
    });
    await listen(ftpInvalid);
    try {await assert.rejects(ftp.testConnection({secure:true,host:'127.0.0.1',port:ftpInvalid.address().port,username:'SYNTHETIC',password:'SYNTHETIC',remote_path:'/'}),e=>/certificate|self.signed/i.test(e.message));}
    finally{await close(ftpInvalid);}
    assert.ok(!ftpInvalidCommands.some(c=>c.startsWith('USER')||c.startsWith('PASS')));

    let received='',dataMode=false;
    const capture=tls.createServer({key,cert},socket=>{
      socket.write('220 localhost SYNTHETIC_CAPTURE\r\n');socket.on('error',()=>{});
      let buffer='';
      socket.on('data',bytes=>{
        buffer+=bytes.toString();
        let end;
        while((end=buffer.indexOf('\r\n'))>=0) {
          const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
          if(dataMode){if(line==='.') {dataMode=false;socket.write('250 queued\r\n');}else received+=line+'\n';continue;}
          if(line.startsWith('EHLO'))socket.write('250 localhost\r\n');
          else if(line.startsWith('MAIL FROM')||line.startsWith('RCPT TO'))socket.write('250 OK\r\n');
          else if(line==='DATA'){dataMode=true;socket.write('354 Send data\r\n');}
          else if(line==='QUIT')socket.end('221 Bye\r\n');
          else socket.write('250 OK\r\n');
        }
      });
    });
    capture.on('tlsClientError',()=>{});
    await listen(capture);
    const options=createTransportOptions({...settings,security:'ssl_tls',port:capture.address().port});
    // Trust only the synthetic test certificate, with hostname verification still enabled.
    options.tls={...options.tls,ca:cert,servername:'localhost'};
    const sender=nodemailer.createTransport(options);
    try {
      await sender.sendMail({from:'audit@example.invalid',to:'capture@example.invalid',subject:'SYNTHETIC_TLS_DELIVERY',text:'SYNTHETIC_ONLY_BODY'});
    }finally{sender.close();await close(capture);}
    assert.match(received,/SYNTHETIC_ONLY_BODY/);
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'fullpassword-tls-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
  console.log('PASS local SMTP/FTP downgrade and invalid SMTP/FTPS certificates rejected before credentials; successful SMTP TLS delivery to synthetic capturer.');
};
run().catch(error => { console.error(error); process.exitCode = 1; });
