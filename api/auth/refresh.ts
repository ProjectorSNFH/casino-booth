import { signAccess, verifyRefresh } from '../../lib/auth';
import { db } from '../../lib/db';
import { ApiError } from '../../lib/errors';
import { handle } from '../../lib/http';

export default handle(['POST'], async ({ body }) => {
  const token = typeof body.refresh === 'string' ? body.refresh : '';
  const c = await verifyRefresh(token);
  if (!c) throw new ApiError('UNAUTHORIZED');

  if (c.kind === 'staff') return { access: await signAccess(c) };

  const { data, error } = await db()
    .from('cards')
    .select('status, token_version')
    .eq('id', c.card_id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status === 'pending') throw new ApiError('UNAUTHORIZED');
  if (data.token_version !== c.tv) throw new ApiError('STALE_TOKEN');

  return { access: await signAccess(c), status: data.status };
});