import { rpc } from '../db';
import { requireStaff } from '../guard';
import { handle } from '../http';
import { parseClaimId } from './issue-reconnect-confirm';

export default handle(['POST'], async ({ req, body }) => {
  await requireStaff(req, 'issue');
  const id = parseClaimId(body.claim_id);
  await rpc('reject_reconnect', { p_claim_id: id });
  return { claim_id: id };
});
