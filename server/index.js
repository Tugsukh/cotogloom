import express from 'express';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { Game } from './game.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const testMode = process.env.HS_TEST === '1';

const app = express();
app.disable('x-powered-by');
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three')));
app.use('/shared', express.static(path.join(root, 'shared')));
app.use('/', express.static(path.join(root, 'client')));

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 5000, pingTimeout: 8000 });
const game = new Game(io, { testMode });
io.on('connection', (socket) => game.attach(socket));

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

server.listen(PORT, HOST, () => {
  console.log(`Cotogloom server listening on port ${PORT}${testMode ? ' (TEST MODE)' : ''}`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  LAN:     http://${ip}:${PORT}`);
});

const shutdown = () => { game.stop(); io.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 500); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
