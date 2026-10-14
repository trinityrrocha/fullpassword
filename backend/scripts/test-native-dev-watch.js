const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

(async () => {
  const pkg = require('../package.json');
  assert.equal(pkg.scripts.dev, 'node --watch src/server.js');
  assert(!pkg.devDependencies.nodemon);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fp-native-watch-'));
  const file = path.join(dir, 'entry.cjs');
  let child;
  try {
    await fs.writeFile(file, "console.log('SYNTHETIC_WATCH_INITIAL');setInterval(()=>{},1000);\n");
    child = spawn(process.execPath, ['--watch', file], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    const waitFor = async marker => {
      for (let i = 0; i < 100 && !output.includes(marker); i++) await new Promise(resolve => setTimeout(resolve, 100));
      assert(output.includes(marker), 'Native watcher did not start/restart its synthetic fixture');
    };
    await waitFor('SYNTHETIC_WATCH_INITIAL');
    await fs.writeFile(file, "console.log('SYNTHETIC_WATCH_RESTARTED');setInterval(()=>{},1000);\n");
    await waitFor('SYNTHETIC_WATCH_RESTARTED');
    console.log('PASS Node native dev watcher: synthetic loopback-free entry starts and restarts after source edit.');
  } finally {
    if (child && child.exitCode === null) {
      const ended = new Promise(resolve => child.once('exit', resolve));
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      else child.kill('SIGTERM');
      await ended;
    }
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'fp-native-watch-'));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(() => { console.error('NATIVE_DEV_WATCH_TEST_FAILED'); process.exitCode = 1; });
