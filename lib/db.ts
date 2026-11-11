import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { ApiError, fromDb } from './errors';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing`);
  return v;
}

let _db: SupabaseClient | undefined;
let _redis: Redis | undefined;

/** 서버 전용. service_role 키라서 보안 규칙(RLS)을 건너뜀. 브라우저로 보내면 안 됨 */
export function db(): SupabaseClient {
  return (_db ??= createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  }));
}

export function redis(): Redis {
  return (_redis ??= Redis.fromEnv());
}

/** DB 함수 호출. DB가 낸 오류 코드는 ApiError로 바꿔서 던짐 */
export async function rpc<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
  client: Pick<SupabaseClient, 'rpc'> = db(),
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw fromDb(error);
  return data as T;
}

type RedisLike = Pick<Redis, 'incr' | 'expire' | 'ttl' | 'del'>;
export type Limit = { ok: boolean; count: number; retryAfter: number };

/** key 기준으로 windowSec 동안 max번까지 허용 */
export async function rateLimit(
  key: string,
  max: number,
  windowSec: number,
  r: RedisLike = redis(),
): Promise<Limit> {
  const k = `rl:${key}`;
  const count = await r.incr(k);
  if (count === 1) await r.expire(k, windowSec);
  if (count <= max) return { ok: true, count, retryAfter: 0 };

  let t = await r.ttl(k);
  if (t < 0) {            // 만료가 안 걸려 있으면 영영 잠기니 다시 걸어 줌
    await r.expire(k, windowSec);
    t = windowSec;
  }
  return { ok: false, count, retryAfter: t };
}

/** 한도를 넘으면 RATE_LIMITED(429)를 던짐 */
export async function enforceLimit(
  key: string,
  max: number,
  windowSec: number,
  r?: RedisLike,
): Promise<void> {
  const l = await rateLimit(key, max, windowSec, r);
  if (!l.ok) throw new ApiError('RATE_LIMITED');
}

/** 성공했을 때 카운터 비우기 (예: PIN을 맞게 입력함) */
export async function clearLimit(key: string, r: RedisLike = redis()): Promise<void> {
  await r.del(`rl:${key}`);
}