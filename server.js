// Entry point: serves the client over HTTP and runs the game over WebSockets.

import http from 'node:http';
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

wss.on('connection', (socket, request) => game.connect(socket, request.socket.remoteAddress));

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

server.listen(port, '0.0.0.0', () => {
  game.start();
  console.log('Flag World server running; waiting in the lobby');
  console.log(`  Local: http://localhost:${port}`);
  for (const ip of lanAddresses()) console.log(`  LAN:   http://${ip}:${port}`);
});
