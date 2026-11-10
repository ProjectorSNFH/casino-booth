import { createClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';

const { SUPABASE_URL: U, SUPABASE_ANON_KEY: A, SUPABASE_JWT_SECRET: S } = process.env;
const key = new TextEncoder().encode(S);
const mk = (claims) =>
  new SignJWT({ role: 'authenticated', aud: 'authenticated', ...claims })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(key);

async function listen(name, cardId) {
  const token = await mk({ kind: 'participant', card_id: cardId });
  const sb = createClient(U, A, { auth: { persistSession: false, autoRefreshToken: false } });
  await sb.realtime.setAuth(token);
  sb.channel('state-' + cardId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'card_state' }, (p) => {
      console.log(`[${name}] 받음: card ${p.new?.card_id} coins ${p.new?.coins}`);
    })
    .subscribe((status, err) => console.log(`[${name}] ${status}`, err ? err.message : ''));
  return sb;
}

const a = await listen('P1', 1);
const b = await listen('P2', 2);
console.log('90초 기다림. 지금 SQL 실행해.');
setTimeout(async () => {
  await a.removeAllChannels();
  await b.removeAllChannels();
  process.exit(0);
}, 90000);