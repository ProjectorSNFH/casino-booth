import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError, toResponse } from '../../lib/errors';

type Method = 'GET' | 'POST';
export type Ctx = { req: VercelRequest; body: Record<string, unknown>; ip: string };

export function getIp(req: VercelRequest): string {
  const xf = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim();
  const real = req.headers['x-real-ip'];
  return first || (typeof real === 'string' ? real : '') || 'unknown';
}

/** 모든 API의 공통 틀: 방식 검사, 본문 읽기, 오류를 안전한 응답으로 */
export function handle(methods: Method[], fn: (c: Ctx) => Promise<Record<string, unknown>>) {
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!methods.includes(req.method as Method)) throw new ApiError('METHOD_NOT_ALLOWED');
      let raw: unknown;
      try {
        raw = req.body;
      } catch {
        throw new ApiError('BAD_REQUEST'); // 깨진 JSON
      }
      const body =
        raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      const out = await fn({ req, body, ip: getIp(req) });
      res.status(200).json({ ok: true, ...out });
    } catch (e) {
      const r = toResponse(e);
      res.status(r.status).json(r.body);
    }
  };
}