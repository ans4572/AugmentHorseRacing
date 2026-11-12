import { WebSocketServer, WebSocket } from 'ws';
import { SERVER_PORT } from '../../shared/src/constants';
import { GameHub } from './hub';

// 로컬 개발용 Node 서버. 배포는 worker/src/index.ts (Cloudflare) 가 맡는다.
const hub = new GameHub();
const wss = new WebSocketServer({ port: SERVER_PORT });
console.log(`[증강 경마] WebSocket 서버 시작 — ws://localhost:${SERVER_PORT}`);

wss.on('connection', (ws: WebSocket) => {
  const conn = hub.open((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
  ws.on('message', (raw) => conn.message(raw.toString()));
  ws.on('close', () => conn.close());
});
