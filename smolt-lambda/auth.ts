import { randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from './db.js';
import { err, json, JSON_CT, parseBody, type LambdaEvent, type LambdaResult } from './http.js';

const SESSION_COOKIE = 'stronglifts_session';
const SESSION_MAX_AGE = 180 * 24 * 60 * 60; // seconds, matches Go app
const BCRYPT_COST = 12;

// ── Cookie helpers ──────────────────────────────────────────────────────────

function cookieHeader(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

export function getSessionId(event: LambdaEvent): string | undefined {
  for (const c of event.cookies ?? []) {
    const eq = c.indexOf('=');
    if (eq !== -1 && c.slice(0, eq).trim() === SESSION_COOKIE) {
      return c.slice(eq + 1).trim();
    }
  }
  return undefined;
}

// ── Login rate limiting ─────────────────────────────────────────────────────

const RATE_LIMITS: Record<string, number> = {
  LOGIN: 10,    // attempts per minute per IP
  REGISTER: 5,
};

async function checkRateLimit(ip: string, action: string): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 60000); // 1-minute bucket
  const result = await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `RATELIMIT#${ip}`, sk: `${action}#${bucket}` },
      UpdateExpression: 'ADD attempts :one SET expiresAt = if_not_exists(expiresAt, :exp)',
      ExpressionAttributeValues: {
        ':one': 1,
        ':exp': Math.floor(Date.now() / 1000) + 120, // TTL: 2 minutes
      },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  return (result.Attributes?.attempts ?? 0) > (RATE_LIMITS[action] ?? 10);
}

// ── Session store (DynamoDB) ────────────────────────────────────────────────

async function createSession(userId: string, username: string): Promise<string> {
  const sessionId = randomBytes(32).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: `SESSION#${sessionId}`, sk: 'SESSION', userId, username, expiresAt },
    }),
  );
  return sessionId;
}

export async function resolveSession(
  event: LambdaEvent,
): Promise<{ userId: string; username: string } | null> {
  const sessionId = getSessionId(event);
  if (!sessionId) return null;

  const { Item } = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `SESSION#${sessionId}`, sk: 'SESSION' } }),
  );
  if (!Item) return null;
  if (Item.expiresAt < Math.floor(Date.now() / 1000)) return null;

  return { userId: Item.userId, username: Item.username };
}

// ── Handlers ────────────────────────────────────────────────────────────────

export async function register(event: LambdaEvent): Promise<LambdaResult> {
  if (await checkRateLimit(event.requestContext.http.sourceIp, 'REGISTER')) {
    return err(429, 'Too many registration attempts. Try again in a minute.');
  }

  const body = parseBody(event);
  const username: string = (body.username ?? '').trim();
  const password: string = body.password ?? '';

  if (username.length < 3) return err(400, 'Username must be at least 3 characters');
  if (password.length < 8) return err(400, 'Password must be at least 8 characters');
  if (password.length > 72) return err(400, 'Password must be 72 characters or fewer');

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const userId = randomUUID();

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          pk: `USER#${username}`,
          sk: 'PROFILE',
          userId,
          username,
          passwordHash,
          createdAt: Math.floor(Date.now() / 1000),
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  } catch (e: any) {
    if (e.name === 'ConditionalCheckFailedException') return err(409, 'Username already taken');
    throw e;
  }

  const sessionId = await createSession(userId, username);
  return sessionResult(200, { username }, sessionId);
}

export async function login(event: LambdaEvent): Promise<LambdaResult> {
  const ip = event.requestContext.http.sourceIp;
  if (await checkRateLimit(ip, 'LOGIN')) return err(429, 'Too many login attempts. Try again in a minute.');

  const body = parseBody(event);
  const username: string = (body.username ?? '').trim();
  const password: string = body.password ?? '';

  if (!username || !password) return err(400, 'Username and password required');

  const { Item } = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `USER#${username}`, sk: 'PROFILE' } }),
  );

  const invalid = () => err(401, 'Invalid username or password');
  if (!Item) return invalid();
  if (!(await bcrypt.compare(password, Item.passwordHash))) return invalid();

  const sessionId = await createSession(Item.userId, Item.username);
  return sessionResult(200, { username: Item.username }, sessionId);
}

export async function logout(event: LambdaEvent): Promise<LambdaResult> {
  const sessionId = getSessionId(event);
  if (sessionId) {
    await ddb.send(
      new DeleteCommand({ TableName: TABLE, Key: { pk: `SESSION#${sessionId}`, sk: 'SESSION' } }),
    );
  }
  return { statusCode: 200, headers: JSON_CT, cookies: [cookieHeader('', 0)], body: '{}' };
}

export async function me(event: LambdaEvent): Promise<LambdaResult> {
  const s = await resolveSession(event);
  if (!s) return err(401, 'Not authenticated');
  return json(200, { username: s.username });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sessionResult(statusCode: number, body: object, sessionId: string): LambdaResult {
  return {
    statusCode,
    headers: JSON_CT,
    cookies: [cookieHeader(sessionId, SESSION_MAX_AGE)],
    body: JSON.stringify(body),
  };
}

export { err, json, parseBody, type LambdaEvent, type LambdaResult };
