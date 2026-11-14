import { Redis } from '@upstash/redis';

let client: Redis | null = null;
const redis = (): Redis => (client ??= new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL as string,
  token: process.env.UPSTASH_REDIS_REST_TOKEN as string,
}));

/** 캐시는 속도용일 뿐이므로, Redis가 죽어도 요청은 실패하지 않고 DB로 간다 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const v = await redis().get<T>(key);
    return v ?? null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSec: number): Promise<void> {
  try {
    await redis().set(key, value, { ex: ttlSec });
  } catch {
    /* 무시 */
  }
}
