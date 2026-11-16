import { describe, expect, it } from 'vitest';
import type { C2S, S2C } from '../../shared/src/types';
import { GameHub } from '../src/hub';

/** 허브에 가짜 접속 하나를 연다. 받은 메시지를 모아 둔다 */
function connect(hub: GameHub) {
  const got: S2C[] = [];
  const conn = hub.open((data) => got.push(JSON.parse(data)));
  return {
    got,
    send: (msg: C2S) => conn.message(JSON.stringify(msg)),
    close: () => conn.close(),
    last: <T extends S2C['type']>(type: T) => [...got].reverse().find((m) => m.type === type) as Extract<S2C, { type: T }> | undefined
  };
}

describe('관리자', () => {
  it('비밀번호가 없으면 관리자 기능이 꺼져 있다', () => {
    const hub = new GameHub();
    const a = connect(hub);
    a.send({ type: 'ADMIN_LOGIN', password: '' });
    expect(a.last('ADMIN_DENIED')?.message).toContain('꺼져');
    expect(a.last('ADMIN_OK')).toBeUndefined();
  });

  it('비밀번호를 맞혀야 상태를 받고, 틀리면 거절한다', () => {
    const hub = new GameHub({ adminPassword: 'secret-pw-123' });
    const a = connect(hub);
    a.send({ type: 'ADMIN_REFRESH' });
    expect(a.last('ADMIN_STATE')).toBeUndefined();
    a.send({ type: 'ADMIN_LOGIN', password: 'nope' });
    expect(a.last('ADMIN_DENIED')).toBeDefined();
    a.send({ type: 'ADMIN_LOGIN', password: 'secret-pw-123' });
    expect(a.last('ADMIN_OK')).toBeDefined();
    expect(a.last('ADMIN_STATE')).toBeDefined();
  });

  it('접속 하나는 3번까지만 틀릴 수 있다', () => {
    const hub = new GameHub({ adminPassword: 'secret-pw-123' });
    const a = connect(hub);
    for (let i = 0; i < 3; i++) a.send({ type: 'ADMIN_LOGIN', password: 'x' });
    a.send({ type: 'ADMIN_LOGIN', password: 'secret-pw-123' });
    expect(a.last('ADMIN_OK')).toBeUndefined();
    expect(a.last('ADMIN_DENIED')?.message).toContain('3번');
    // 새 접속에서는 맞히면 들어간다
    const b = connect(hub);
    b.send({ type: 'ADMIN_LOGIN', password: 'secret-pw-123' });
    expect(b.last('ADMIN_OK')).toBeDefined();
  });

  it('접속자 목록에 이름과 당근이 보이고, 관리자 자신은 빠진다', () => {
    const hub = new GameHub({ adminPassword: 'secret-pw-123' });
    const u = connect(hub);
    u.send({ type: 'HELLO', playerName: '  당근부자  ', carrots: 321 });
    const a = connect(hub);
    a.send({ type: 'ADMIN_LOGIN', password: 'secret-pw-123' });
    const st = a.last('ADMIN_STATE')!.state;
    expect(st.connections).toBe(1);
    expect(st.users).toHaveLength(1);
    expect(st.users[0]).toMatchObject({ name: '당근부자', carrots: 321, roomId: null });
  });

  it('당근 선물은 그 접속자에게만 가고, 관리자가 아니면 보낼 수 없다', () => {
    const hub = new GameHub({ adminPassword: 'secret-pw-123' });
    const u1 = connect(hub);
    const u2 = connect(hub);
    u1.send({ type: 'HELLO', playerName: '받는사람', carrots: 10 });
    const a = connect(hub);
    a.send({ type: 'ADMIN_LOGIN', password: 'secret-pw-123' });
    const sid = a.last('ADMIN_STATE')!.state.users.find((x) => x.name === '받는사람')!.sid;

    // 관리자가 아닌 접속은 선물을 보낼 수 없다
    u2.send({ type: 'ADMIN_GIFT', sid, carrots: 999 });
    expect(u1.last('GIFT')).toBeUndefined();

    // 범위를 벗어난 수는 거절한다
    a.send({ type: 'ADMIN_GIFT', sid, carrots: 0 });
    expect(a.last('ADMIN_RESULT')?.ok).toBe(false);
    a.send({ type: 'ADMIN_GIFT', sid, carrots: 50, note: '고마워요' });
    expect(a.last('ADMIN_RESULT')?.ok).toBe(true);
    const gift = u1.last('GIFT')!;
    expect(gift).toMatchObject({ carrots: 50, note: '고마워요' });
    expect(gift.giftId).toBeTruthy();
    expect(u2.last('GIFT')).toBeUndefined();
    expect(a.last('ADMIN_STATE')!.state.giftsSent).toBe(1);
  });

  it('나간 접속에는 선물을 보내지 않고 알려 준다', () => {
    const hub = new GameHub({ adminPassword: 'secret-pw-123' });
    const u = connect(hub);
    u.send({ type: 'HELLO', playerName: '곧나감', carrots: 0 });
    const a = connect(hub);
    a.send({ type: 'ADMIN_LOGIN', password: 'secret-pw-123' });
    const sid = a.last('ADMIN_STATE')!.state.users[0].sid;
    u.close();
    a.send({ type: 'ADMIN_GIFT', sid, carrots: 10 });
    expect(a.last('ADMIN_RESULT')).toMatchObject({ ok: false });
  });

  it('방 목록에 단계와 참가자가 보인다', () => {
    const hub = new GameHub({ adminPassword: 'secret-pw-123' });
    const u = connect(hub);
    u.send({ type: 'CREATE_ROOM', playerName: '방장님', roomName: '테스트방', isPrivate: false, maxPlayers: 4, totalRounds: 3, npcCount: 1 });
    const a = connect(hub);
    a.send({ type: 'ADMIN_LOGIN', password: 'secret-pw-123' });
    const st = a.last('ADMIN_STATE')!.state;
    expect(st.rooms).toHaveLength(1);
    expect(st.rooms[0]).toMatchObject({ name: '테스트방', phase: 'lobby', solo: false });
    expect(st.rooms[0].players.map((p) => p.isNpc)).toEqual([false, true]);
    expect(st.users[0]).toMatchObject({ name: '방장님', roomName: '테스트방' });
    for (const r of hub.rooms.values()) r.destroy('테스트 종료');
  });
});
