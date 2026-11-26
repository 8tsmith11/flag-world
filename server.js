// Entry point: serves the client over HTTP and runs the game over WebSockets.

import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { PORT } from './shared/config.js';
import { Game } from './server/game.js';

const root = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.static(path.join(root, 'public')));
app.use('/shared', express.static(path.join(root, 'shared')));
// Browser copies of npm packages, resolved through the import map in index.html.
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three/build')));
app.use('/vendor/simplex-noise', express.static(path.join(root, 'node_modules/simplex-noise/dist/esm')));

// PORT env var overrides the default, e.g. to run a second server alongside.
const port = Number(process.env.PORT) || PORT;
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const game = new Game();

// Online play (`npm run online`, or ACCESS_KEY set): connections need the
// access key from the shared link (?key=...), so strangers who find the
// address can't join or take over players.
const online = process.argv.includes('--online');
const accessKey = process.env.ACCESS_KEY || (online ? crypto.randomBytes(6).toString('base64url') : null);

wss.on('connection', (socket, request) => {
  if (accessKey && new URL(request.url, 'http://x').searchParams.get('key') !== accessKey) {
    socket.close(4001, 'Wrong or missing access key');
    return;
  }
  // Behind a tunnel or proxy every connection arrives from localhost; the
  // forwarded address is the real one (and is never the local host).
  const forwarded = request.headers['cf-connecting-ip'] ?? request.headers['x-forwarded-for']?.split(',')[0]?.trim();
  game.connect(socket, forwarded ? `forwarded:${forwarded}` : request.socket.remoteAddress);
});

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

// Stopping the server (Ctrl+C) saves the match first.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  game.save();
  process.exit(0);
});

const keyQuery = accessKey ? `/?key=${accessKey}` : '';
server.listen(port, '0.0.0.0', () => {
  game.start();
  console.log('Flag World server running; waiting in the lobby');
  console.log(`  Local: http://localhost:${port}${keyQuery}`);
  for (const ip of lanAddresses()) console.log(`  LAN:   http://${ip}:${port}${keyQuery}`);
  if (online) startTunnel();
});

// A Cloudflare quick tunnel gives a public https address with no router
// setup. Needs the `cloudflared` program; without it, explains port forwarding.
function startTunnel() {
  const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let shown = false;
  const watch = (data) => {
    const url = String(data).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
    if (url && !shown) {
      shown = true;
      console.log(`  Online: ${url}${keyQuery}`);
      console.log('  Share the Online link (it includes the access key). It changes every time the server starts.');
    }
  };
  tunnel.stdout.on('data', watch);
  tunnel.stderr.on('data', watch);
  tunnel.on('error', () => {
    console.log('  Online: cloudflared is not installed, so no public link was made.');
    console.log('    Install it (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)');
    console.log(`    and run npm run online again, or forward TCP port ${port} on your router and share`);
    console.log(`    http://<your public IP>:${port}${keyQuery}`);
  });
  process.on('exit', () => tunnel.kill());
}
