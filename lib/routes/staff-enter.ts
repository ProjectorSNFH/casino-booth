import { signAccess, signRefresh } from '../auth';
import { safeEqual } from '../crypto';
import { clearLimit, enforceLimit } from '../db';
import { ApiError } from '../errors';
import { handle } from '../http';
import { STATION_ROLES, parseStation } from '../validate';

const PIN_STATIONS = new Set<string>(['suc2', 'shp1']);

export default handle(['POST'], async ({ body, ip }) => {
  await enforceLimit(`code:${ip}`, 30, 300);

  const st = parseStation(body.code);
  if (!st.ok) throw new ApiError('BAD_STATION');
  const code = st.value;

  if (PIN_STATIONS.has(code)) {
    if (body.pin === undefined || body.pin === null) throw new ApiError('PIN_REQUIRED');
    await enforceLimit(`pin:${ip}`, 5, 300);
    const expected = process.env.STAFF_PIN;
    if (!expected) throw new Error('STAFF_PIN missing');
    const pin = typeof body.pin === 'string' ? body.pin : '';
    if (!safeEqual(pin, expected)) throw new ApiError('WRONG_PIN');
    await clearLimit(`pin:${ip}`);
  }

  const claims = { kind: 'staff' as const, station: code };
  const [access, refresh] = await Promise.all([signAccess(claims), signRefresh(claims)]);
  return { station: code, role: STATION_ROLES[code], access, refresh };
});
