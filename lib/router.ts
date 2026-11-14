import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError, toResponse } from './errors';
import adjustCard from './routes/adjust-card';
import adjustGlistSet from './routes/adjust-glist-set';
import adjustTlistAdd from './routes/adjust-tlist-add';
import adjustTlistDelete from './routes/adjust-tlist-delete';
import adjustTlistEdit from './routes/adjust-tlist-edit';
import authRefresh from './routes/auth-refresh';
import entryClaim from './routes/entry-claim';
import entryReconnect from './routes/entry-reconnect';
import entryStatus from './routes/entry-status';
import gameAccept from './routes/game-accept';
import eventSlot from './routes/event-slot';
import gameAbort from './routes/game-abort';
import gameBack from './routes/game-back';
import gameEnd from './routes/game-end';
import gameReject from './routes/game-reject';
import gameResult from './routes/game-result';
import gameScan from './routes/game-scan';
import gameSettle from './routes/game-settle';
import gameStart from './routes/game-start';
import gameState from './routes/game-state';
import hofList from './routes/hof-list';
import hofWinnerPii from './routes/hof-winner-pii';
import issueCancel from './routes/issue-cancel';
import issueConfirm from './routes/issue-confirm';
import issueCreate from './routes/issue-create';
import issueReconnectConfirm from './routes/issue-reconnect-confirm';
import issueReconnectReject from './routes/issue-reconnect-reject';
import issueState from './routes/issue-state';
import meAck from './routes/me-ack';
import meBet from './routes/me-bet';
import meLeave from './routes/me-leave';
import shopApprove from './routes/shop-approve';
import shopCancel from './routes/shop-cancel';
import shopDeliver from './routes/shop-deliver';
import shopOrder from './routes/shop-order';
import shopOrders from './routes/shop-orders';
import shopProducts from './routes/shop-products';
import shopQueue from './routes/shop-queue';
import shopReject from './routes/shop-reject';
import shopStock from './routes/shop-stock';
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
  'game/scan': gameScan,
  'game/accept': gameAccept,
  'game/reject': gameReject,
  'game/state': gameState,
  'game/start': gameStart,
  'game/end': gameEnd,
  'game/result': gameResult,
  'game/back': gameBack,
  'game/settle': gameSettle,
  'game/abort': gameAbort,
  'me/ack': meAck,
  'shop/products': shopProducts,
  'shop/order': shopOrder,
  'shop/cancel': shopCancel,
  'shop/orders': shopOrders,
  'shop/approve': shopApprove,
  'shop/reject': shopReject,
  'shop/stock': shopStock,
  'shop/queue': shopQueue,
  'shop/deliver': shopDeliver,
  'adjust/card': adjustCard,
  'adjust/tlist-add': adjustTlistAdd,
  'adjust/tlist-edit': adjustTlistEdit,
  'adjust/tlist-delete': adjustTlistDelete,
  'adjust/glist-set': adjustGlistSet,
  'event/slot': eventSlot,
  'hof/list': hofList,
  'hof/winner-pii': hofWinnerPii,
  'me/bet': meBet,
  'me/leave': meLeave,
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
