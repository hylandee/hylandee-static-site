import { handler } from '../index';
import { clearTable, extractCookie, makeEvent, makeEventNoSecret, registerAndLogin } from './helpers';

beforeEach(async () => {
  await clearTable();
});

describe('register', () => {
  test('creates user and returns session cookie', async () => {
    const res = await handler(makeEvent('POST', '/api/register', { username: 'alice', password: 'password123' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).username).toBe('alice');
    expect(extractCookie(res)).toMatch(/^stronglifts_session=\w+/);
  });

  test('duplicate username returns 409', async () => {
    await handler(makeEvent('POST', '/api/register', { username: 'alice', password: 'password123' }));
    const res = await handler(makeEvent('POST', '/api/register', { username: 'alice', password: 'different123' }));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('already taken');
  });

  test('short username returns 400', async () => {
    const res = await handler(makeEvent('POST', '/api/register', { username: 'ab', password: 'password123' }));
    expect(res.statusCode).toBe(400);
  });

  test('short password returns 400', async () => {
    const res = await handler(makeEvent('POST', '/api/register', { username: 'alice', password: 'short' }));
    expect(res.statusCode).toBe(400);
  });

  test('rate limit: 6th attempt from same IP returns 429', async () => {
    const ip = '9.9.9.9';
    let lastRes: any;
    for (let i = 0; i < 6; i++) {
      lastRes = await handler(makeEvent('POST', '/api/register', { username: `rl${i}`, password: 'password123' }, [], ip));
    }
    expect(lastRes.statusCode).toBe(429);
    expect(JSON.parse(lastRes.body).error).toContain('Too many registration attempts');
  });
});

describe('login', () => {
  beforeEach(async () => {
    await handler(makeEvent('POST', '/api/register', { username: 'alice', password: 'password123' }));
  });

  test('correct credentials returns 200 with cookie', async () => {
    const res = await handler(makeEvent('POST', '/api/login', { username: 'alice', password: 'password123' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).username).toBe('alice');
    expect(extractCookie(res)).toMatch(/^stronglifts_session=\w+/);
  });

  test('wrong password returns 401', async () => {
    const res = await handler(makeEvent('POST', '/api/login', { username: 'alice', password: 'wrongpass123' }));
    expect(res.statusCode).toBe(401);
  });

  test('nonexistent user returns 401', async () => {
    const res = await handler(makeEvent('POST', '/api/login', { username: 'nobody', password: 'password123' }));
    expect(res.statusCode).toBe(401);
  });

  test('rate limit: 11th attempt from same IP returns 429', async () => {
    const ip = '8.8.8.8';
    let lastRes: any;
    for (let i = 0; i < 11; i++) {
      lastRes = await handler(makeEvent('POST', '/api/login', { username: 'nobody', password: 'wrong' }, [], ip));
    }
    expect(lastRes.statusCode).toBe(429);
    expect(JSON.parse(lastRes.body).error).toContain('Too many login attempts');
  });
});

describe('me', () => {
  test('with valid session returns username', async () => {
    const cookie = await registerAndLogin('bob', 'password123');
    const res = await handler(makeEvent('GET', '/api/me', undefined, [cookie]));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).username).toBe('bob');
  });

  test('without session returns 401', async () => {
    const res = await handler(makeEvent('GET', '/api/me'));
    expect(res.statusCode).toBe(401);
  });
});

describe('logout', () => {
  test('clears session cookie', async () => {
    const cookie = await registerAndLogin('carol', 'password123');
    const logoutRes = await handler(makeEvent('POST', '/api/logout', undefined, [cookie]));
    expect(logoutRes.statusCode).toBe(200);
    expect(logoutRes.cookies?.[0]).toContain('Max-Age=0');

    // Subsequent /api/me with the old cookie should return 401
    const meRes = await handler(makeEvent('GET', '/api/me', undefined, [cookie]));
    expect(meRes.statusCode).toBe(401);
  });
});

describe('origin secret', () => {
  test('missing secret returns 403', async () => {
    const res = await handler(makeEventNoSecret('GET', '/api/me'));
    expect(res.statusCode).toBe(403);
  });
});
