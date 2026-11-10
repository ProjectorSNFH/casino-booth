import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';

const NAMES = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_JWT_SECRET', 'SUPABASE_SERVICE_ROLE_KEY',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'PII_ENC_KEY', 'SID_HMAC_KEY', 'STAFF_PIN',
];

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const out: Record<string, unknown> = {
    region: process.env.VERCEL_REGION,
    env: Object.fromEntries(NAMES.map((n) => [n, Boolean(process.env[n])])),
    pii_len: Buffer.from(process.env.PII_ENC_KEY ?? '', 'base64').length,
    hmac_len: Buffer.from(process.env.SID_HMAC_KEY ?? '', 'base64').length,
  };
  try {
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const { data, error } = await sb.from('config').select('key');
    out.supabase = error ? 'ERR ' + error.message : `config ${data?.length}`;
  } catch (e) {
    out.supabase = 'ERR ' + (e as Error).message;
  }
  try {
    out.redis = await Redis.fromEnv().ping();
  } catch (e) {
    out.redis = 'ERR ' + (e as Error).message;
  }
  res.status(200).json(out);
}