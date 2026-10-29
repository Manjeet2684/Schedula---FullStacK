import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionClaims {
  sub: string;
  iat: number;
  exp: number;
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function secret(): string {
  const value = process.env['AUTH_SECRET'];
  if (!value || value.length < 32) {
    throw new Error('AUTH_SECRET must be set to a random value of at least 32 characters');
  }
  return value;
}

export function createSessionToken(userId: string, lifetimeSeconds = 60 * 60 * 24 * 7): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: userId, iat: now, exp: now + lifetimeSeconds }));
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', secret()).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

export function verifySessionToken(token: string): SessionClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts as [string, string, string];
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: string };
    if (parsedHeader.alg !== 'HS256') return null;
    const expected = createHmac('sha256', secret()).update(`${header}.${payload}`).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims;
    if (!claims.sub || !Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export function readSessionToken(cookieHeader: string | undefined, authorization: string | undefined): string | null {
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim() || null;
  if (!cookieHeader) return null;
  const pair = cookieHeader.split(';').map((item) => item.trim()).find((item) => item.startsWith('schedula_session='));
  return pair ? decodeURIComponent(pair.slice('schedula_session='.length)) : null;
}

export function sessionCookie(token: string): string {
  const secure = process.env['NODE_ENV'] === 'production' ? '; Secure' : '';
  return `schedula_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${secure};`;
}

export const clearSessionCookie = `schedula_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${process.env['NODE_ENV'] === 'production' ? '; Secure' : ''};`;
