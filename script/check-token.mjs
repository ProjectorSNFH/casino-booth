import { SignJWT } from 'jose';

const { SUPABASE_URL: U, SUPABASE_ANON_KEY: A, SUPABASE_JWT_SECRET: S } = process.env;
if (!U || !A || !S) throw new Error('.env 값이 비어 있음');
const key = new TextEncoder().encode(S);

const mk = (claims) =>
  new SignJWT({ role: 'authenticated', aud: 'authenticated', ...claims })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(key);

const get = async (path, token) => {
  const r = await fetch(`${U}/rest/v1/${path}`, {
    headers: { apikey: A, Authorization: `Bearer ${token ?? A}` },
  });
  return `${r.status} ${(await r.text()).slice(0, 100)}`;
};

const p1 = await mk({ kind: 'participant', card_id: 1 });
const p2 = await mk({ kind: 'participant', card_id: 2 });
const bad = p1.slice(0, -4) + 'AAAA';

console.log('1 익명 products     ', await get('products?select=name&limit=1'));
console.log('2 참여자1 내 카드   ', await get('card_state?select=card_id,coins', p1));
console.log('3 참여자2 내 카드   ', await get('card_state?select=card_id,coins', p2));
console.log('4 참여자1 cards 읽기', await get('cards?select=id', p1));
console.log('5 잘못된 서명       ', await get('card_state?select=card_id', bad));