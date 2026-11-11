const base = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!base) throw new Error('주소를 넣어줘: node --env-file=.env scripts/check-api.mjs https://내주소.vercel.app');

const send = async (path, body) => {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try {
    return { status: r.status, json: JSON.parse(text) };
  } catch {
    return { status: r.status, json: { raw: text.slice(0, 200) } };
  }
};
const say = (label, x, ...fields) =>
  console.log(label, x.status, x.json.raw ? `JSON 아님: ${x.json.raw}` : fields.map((f) => x.json[f]).join(' '));

const e = await send('/api/staff/enter', { code: 'hg21' });
say('1 hg21 입장     ', e, 'ok', 'role');
if (!e.json.ok) {
  console.log('1번이 실패해서 멈춤. Vercel > 프로젝트 > Logs 에서 에러 줄을 확인해줘.');
  process.exit(1);
}

say('2 잘못된 코드   ', await send('/api/staff/enter', { code: 'zzzz' }), 'code');
say('3 PIN 없이 suc2 ', await send('/api/staff/enter', { code: 'suc2' }), 'code');
say('4 틀린 PIN      ', await send('/api/staff/enter', { code: 'suc2', pin: 'abcd' }), 'code');

const r = await send('/api/auth/refresh', { refresh: e.json.refresh.token });
say('5 토큰 갱신     ', r, 'ok');

const sb = await fetch(`${process.env.SUPABASE_URL}/rest/v1/matches?select=id`, {
  headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${r.json.access.token}` },
});
console.log('6 갱신 토큰 읽기', sb.status, await sb.text());

say('7 access로 갱신  ', await send('/api/auth/refresh', { refresh: e.json.access.token }), 'code');