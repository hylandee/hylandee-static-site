export interface LambdaEvent {
  cookies?: string[];
  headers: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string; path: string; sourceIp: string } };
  rawPath: string;
  rawQueryString?: string;
}

export interface LambdaResult {
  statusCode: number;
  headers?: Record<string, string>;
  cookies?: string[];
  body: string;
}

export const JSON_CT = { 'content-type': 'application/json' };

export function json(statusCode: number, body: object): LambdaResult {
  return { statusCode, headers: JSON_CT, body: JSON.stringify(body) };
}

export function err(statusCode: number, error: string): LambdaResult {
  return json(statusCode, { error });
}

export function parseBody(event: LambdaEvent): Record<string, any> {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
