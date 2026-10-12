export type ApiErrorCode =
  | 'INSUFFICIENT_FUNDS'
  | 'RESTOCKING'
  | 'TX_NOT_FOUND'
  | 'TX_MISMATCH'
  | 'EXPIRED'
  | 'GEO_BLOCKED'
  | 'UNAUTHENTICATED'
  | 'UNKNOWN';

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message: string, public status = 400, public hint?: string) {
    super(message);
  }
}

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) return json({ code: error.code, message: error.message, hint: error.hint }, error.status);
  console.error(error);
  return json({ code: 'UNKNOWN', message: 'Internal server error' }, 500);
}

export async function body<T extends Record<string, unknown>>(request: Request): Promise<T> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError('UNKNOWN', 'Expected JSON body', 415);
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as T;
  } catch {
    throw new ApiError('UNKNOWN', 'Invalid JSON body');
  }
}

export function requiredString(value: unknown, name: string, max = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new ApiError('UNKNOWN', `Invalid ${name}`);
  return value;
}

export function idempotencyKey(request: Request, parsed: Record<string, unknown>): string {
  const header = request.headers.get('idempotency-key');
  const fromBody = parsed.idem;
  if (header && fromBody && header !== fromBody) throw new ApiError('UNKNOWN', 'Idempotency key mismatch');
  return requiredString(header ?? fromBody, 'idempotency key', 128);
}
