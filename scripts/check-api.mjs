const base = process.argv[2];
if (!base) throw new Error('주소를 넣어줘: node ... scripts/check-api.mjs https://내주소.vercel.app');

const post = async (path, body) => {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
};

const e = await post('/api/staff/enter', { code: 'hg21' });
console.log('1 hg21 입장     ', e.status, e.json.ok, e.json.role);

const bad = await post('/api/staff/enter', { code: 'zzzz' });
console.log('2 잘못된 코드   ', bad.status, bad.json.code);

const need = await post('/api/staff/enter', { code: 'suc2' });
console.log('3 PIN 없이 suc2 ', need.status, need.json.code);

const wrong = await post('/api/staff/enter', { code: 'suc2', pin: 'abcd' });
console.log('4 틀린 PIN      ', wrong.status, wrong.json.code);

const r = await post('/api/auth/refresh', { refresh: e.json.refresh.token });
console.log('5 토큰 갱신     ', r.status, r.json.ok);

const sb = await fetch(`${process.env.SUPABASE_URL}/rest/v1/matches?select=id`, {
  headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${r.json.access.token}` },
});
console.log('6 갱신 토큰 읽기', sb.status, await sb.text());

const g = await post('/api/auth/refresh', { refresh: e.json.access.token });
console.log('7 access로 갱신 ', g.status, g.json.code);