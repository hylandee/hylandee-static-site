import { handler } from '../index';
import type { LambdaEvent, LambdaResult } from '../http';
import { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const TEST_SECRET = 'test-secret';
const TEST_TABLE = 'smolt-test';

// Shared DynamoDB client for test utilities (not the lambda's singleton)
const testDdb = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    endpoint: 'http://localhost:8001',
    region: 'us-east-1',
    credentials: { accessKeyId: 'fake', secretAccessKey: 'fake' },
  }),
);

export function makeEvent(
  method: string,
  path: string,
  body?: object,
  cookies: string[] = [],
  ip = '1.2.3.4',
): LambdaEvent {
  return {
    headers: { 'x-origin-secret': TEST_SECRET },
    requestContext: { http: { method, path, sourceIp: ip } },
    rawPath: path,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cookies,
  };
}

export function makeEventNoSecret(method: string, path: string): LambdaEvent {
  return {
    headers: {},
    requestContext: { http: { method, path, sourceIp: '1.2.3.4' } },
    rawPath: path,
  };
}

export function extractCookie(res: LambdaResult): string {
  const setCookie = res.cookies?.[0] ?? '';
  return setCookie.split(';')[0].trim(); // "stronglifts_session=<token>"
}

export async function registerAndLogin(username: string, password: string): Promise<string> {
  await handler(makeEvent('POST', '/api/register', { username, password }));
  const loginRes = await handler(makeEvent('POST', '/api/login', { username, password }));
  return extractCookie(loginRes);
}

export async function clearTable(): Promise<void> {
  const scanRes = await testDdb.send(new ScanCommand({
    TableName: TEST_TABLE,
    ProjectionExpression: 'pk, sk',
  }));
  const items = scanRes.Items ?? [];
  if (items.length === 0) return;
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25);
    await testDdb.send(new BatchWriteCommand({
      RequestItems: {
        [TEST_TABLE]: batch.map(item => ({
          DeleteRequest: { Key: { pk: item.pk, sk: item.sk } },
        })),
      },
    }));
  }
}

export async function runFullWorkout(cookie: string): Promise<LambdaResult> {
  const startRes = await handler(makeEvent('POST', '/api/workout/sessions', {}, [cookie]));
  const { sessionId, sets } = JSON.parse(startRes.body);
  const completeSets = sets.map((s: any) => ({
    ...s,
    completed: true,
    actualReps: s.targetReps,
  }));
  return handler(makeEvent('POST', `/api/workout/sessions/${sessionId}/finish`, { sets: completeSets }, [cookie]));
}

export async function runFailedWorkout(cookie: string): Promise<LambdaResult> {
  const startRes = await handler(makeEvent('POST', '/api/workout/sessions', {}, [cookie]));
  const { sessionId, sets } = JSON.parse(startRes.body);
  // completed=true so allComplete passes, but actualReps=0 so allHitTarget fails per exercise
  const failedSets = sets.map((s: any) => ({ ...s, completed: true, actualReps: 0 }));
  return handler(makeEvent('POST', `/api/workout/sessions/${sessionId}/finish`, { sets: failedSets }, [cookie]));
}
