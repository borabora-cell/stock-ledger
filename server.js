import os from 'node:os';
import { spawn } from 'node:child_process';

import app from './app.js';
import { DB_LABEL, IS_REMOTE, ready } from './lib/db.js';

const PORT = Number(process.env.PORT || 3100);
const LINE = '─'.repeat(58);

function localIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

function openBrowser(port) {
  if (process.env.OPEN_BROWSER !== '1') return;
  spawn('cmd', ['/c', 'start', '', `http://localhost:${port}/`], {
    detached: true, stdio: 'ignore', shell: false,
  }).unref();
}

function printBanner(port) {
  const ips = localIPs();
  console.log('\n' + LINE);
  console.log('  📒  주식가계부 서버가 시작되었습니다');
  console.log(LINE);
  console.log(`  접속 주소 :  http://localhost:${port}/`);
  if (ips.length) {
    console.log('');
    console.log('  📱 같은 와이파이의 휴대폰에서 접속:');
    for (const ip of ips) console.log(`      http://${ip}:${port}/`);
  }
  console.log('');
  console.log(`  데이터 : ${DB_LABEL}`);
  if (IS_REMOTE) console.log('  ⚠️  클라우드(Turso) DB 에 연결되어 있습니다 — 배포본과 같은 자료입니다.');
  console.log('');
  console.log('  종료하려면 이 창에서 Ctrl+C 를 누르거나 창을 닫으세요.');
  console.log(LINE + '\n');
}

async function isSameApp(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/stocks`, { signal: AbortSignal.timeout(1500) });
    const data = await res.json();
    return data?.ok === true && Array.isArray(data.stocks);
  } catch {
    return false;
  }
}

function start(port, tried = 0) {
  const server = app.listen(port, '0.0.0.0');

  server.on('listening', () => {
    if (port !== PORT) {
      console.log(`\n  ℹ️  ${PORT}번을 다른 프로그램이 쓰고 있어 ${port}번으로 실행합니다.`);
    }
    printBanner(port);
    openBrowser(port);
  });

  server.on('error', async (err) => {
    if (err.code !== 'EADDRINUSE') {
      console.error('\n  ❌ 서버를 시작하지 못했습니다:', err.message, '\n');
      process.exit(1);
    }
    if (await isSameApp(port)) {
      console.log('\n' + LINE);
      console.log('  ✅  주식가계부 서버가 이미 켜져 있습니다');
      console.log(LINE);
      console.log(`  접속 주소 :  http://localhost:${port}/`);
      console.log(LINE + '\n');
      openBrowser(port);
      process.exit(0);
    }
    if (tried < 10) return start(port + 1, tried + 1);
    console.log(`\n  ❌ ${PORT}~${port} 포트가 모두 사용 중이라 시작하지 못했습니다.\n`);
    process.exit(1);
  });
}

try {
  await ready();
} catch (e) {
  console.error('\n  ❌ 데이터베이스를 준비하지 못했습니다:', e.message, '\n');
  process.exit(1);
}

start(PORT);
