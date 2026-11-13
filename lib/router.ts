import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError, toResponse } from './errors';
import authRefresh from './routes/auth-refresh';
import entryClaim from './routes/entry-claim';
import entryReconnect from './routes/entry-reconnect';
import entryStatus from './routes/entry-status';
import issueCancel from './routes/issue-cancel';
import issueConfirm from './routes/issue-confirm';
import issueCreate from './routes/issue-create';
import issueReconnectConfirm from './routes/issue-reconnect-confirm';
import issueReconnectReject from './routes/issue-reconnect-reject';
import issueState from './routes/issue-state';
import staffEnter from './routes/staff-enter';

type Route = (req: VercelRequest, res: VercelResponse) => Promise<void>;

/** 새 API를 만들면 여기에 한 줄 추가 */
export const routes: Record<string, Route> = {
  'staff/enter': staffEnter,
  'auth/refresh': authRefresh,
  'issue/state': issueState,
  'issue/create': issueCreate,
  'issue/confirm': issueConfirm,
  'issue/cancel': issueCancel,
  'issue/reconnect-confirm': issueReconnectConfirm,
  'issue/reconnect-reject': issueReconnectReject,
  'entry/claim': entryClaim,
  'entry/status': entryStatus,
  'entry/reconnect': entryReconnect,
};

/** /api/staff/enter?x=1 → staff/enter */
export function routeOf(req: Pick<VercelRequest, 'url' | 'query'>): string {
  const fromUrl = (req.url ?? '').split('?')[0].replace(/^\/api\//, '').replace(/\/+$/, '');
  if (fromUrl) return fromUrl;
  const q = req.query?.path;
  return Array.isArray(q) ? q.join('/') : typeof q === 'string' ? q : '';
}

export async function dispatch(req: VercelRequest, res: VercelResponse): Promise<void> {
  const path = routeOf(req);
  const route = Object.hasOwn(routes, path) ? routes[path] : undefined;
  if (!route) {
    res.setHeader('Cache-Control', 'no-store');
    const r = toResponse(new ApiError('NO_ROUTE'));
    res.status(r.status).json(r.body);
    return;
  }
  await route(req, res);
}
