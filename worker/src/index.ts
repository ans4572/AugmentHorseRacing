import { DurableObject } from 'cloudflare:workers';
import { GameHub } from '../../server/src/hub';

// ============================================================
// Cloudflare 배포용 진입점
// - 정적 파일(dist/client)은 Workers Static Assets가 직접 내려 준다.
// - /ws 로 오는 WebSocket은 Durable Object 하나가 모두 받는다.
//   방 목록과 경주 시뮬레이션이 그 객체의 메모리에 있으므로
//   로컬 Node 서버와 똑같이 동작한다.
// ============================================================

interface Env {
  ASSETS: Fetcher;
  GAME_HUB: DurableObjectNamespace<GameHubDO>;
}

export class GameHubDO extends DurableObject<Env> {
  private hub = new GameHub();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket 연결만 받습니다.', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // 경주 틱(20Hz)이 메모리에서 돌아야 하므로 휴면(hibernation) 방식은 쓰지 않는다
    server.accept();

    const conn = this.hub.open((data) => {
      try {
        server.send(data);
      } catch {
        /* 이미 닫힌 연결 */
      }
    });
    server.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') conn.message(ev.data);
    });
    const onClose = (): void => conn.close();
    server.addEventListener('close', onClose);
    server.addEventListener('error', onClose);

    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      // 모든 연결이 같은 객체로 간다 (방 목록을 한곳에서 관리)
      const stub = env.GAME_HUB.get(env.GAME_HUB.idFromName('main'));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
