import type { C2S, S2C } from '../../shared/src/types';
import { SERVER_PORT } from '../../shared/src/constants';

type Handler = (msg: S2C) => void;

/** 탭(sessionStorage) 단위 재접속 토큰 */
export interface SessionToken {
  playerId: string;
  secret: string;
  roomId: string | null;
}

const TOKEN_KEY = 'augment-derby-session';

export function loadToken(): SessionToken | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as SessionToken) : null;
  } catch {
    return null;
  }
}

export function saveToken(token: SessionToken | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  else sessionStorage.removeItem(TOKEN_KEY);
}

export class Net {
  private ws: WebSocket | null = null;
  private handlers: Handler[] = [];
  private reconnectDelay = 500;
  onConnectionChange: ((connected: boolean) => void) | null = null;

  connect(): void {
    const url = `ws://${location.hostname}:${SERVER_PORT}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 500;
      this.onConnectionChange?.(true);
    };

    ws.onmessage = (ev) => {
      let msg: S2C;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      for (const h of this.handlers) h(msg);
    };

    ws.onclose = () => {
      this.onConnectionChange?.(false);
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(5000, this.reconnectDelay * 1.6);
    };

    ws.onerror = () => ws.close();
  }

  send(msg: C2S): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  on(handler: Handler): void {
    this.handlers.push(handler);
  }
}
