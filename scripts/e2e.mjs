// 통합 시험: 배포된 서버에 실제 요청을 보내 행사 전체 흐름을 한 번 돌린다.
// 사용: node scripts/e2e.mjs https://내-vercel-주소
// 주의: 시험용 카드 3장이 DB에 실제로 생긴다. 끝나면 출력되는 정리 SQL을 Supabase에서 실행한다.
import { readFileSync } from 'node:fs';

const BASE = (process.argv[2] || process.env.E2E_BASE || '').replace(/\/+$/, '');
if (!/^https:\/\//.test(BASE)) {
  console.log('사용법: node scripts/e2e.mjs https://내-vercel-주소');
  process.exit(1);
}

// .env에서 STAFF_PIN만 읽는다 (화면에 출력하지 않는다)
let PIN = process.env.STAFF_PIN || '';
if (!PIN) {
  try {
    const m = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^STAFF_PIN=(.*)$/m);
    if (m) PIN = m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* 없으면 아래에서 안내 */ }
}
if (!PIN) { console.log('.env에 STAFF_PIN이 없습니다.'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const created = [];

async function api(method, path, { body, token } = {}) {
  const res = await fetch(BASE + '/api/' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* JSON 아님 */ }
  return { status: res.status, json, text };
}
const post = (path, body, token) => api('POST', path, { body, token });
const get = (path, token) => api('GET', path, { token });

class Stop extends Error {}
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label); return true; }
  fail++; console.log('  ✗ ' + label);
  if (detail !== undefined) console.log('      ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400));
  return false;
}
// 이게 실패하면 뒤 단계가 의미 없으므로 멈춘다
function must(label, cond, detail) { if (!check(label, cond, detail)) throw new Stop(label); }
const okRes = (r) => r.status === 200 && r.json?.ok === true;
const code = (r) => r.json?.code;
const step = (t) => console.log('\n■ ' + t);
const rnd = (n, set) => Array.from({ length: n }, () => set[Math.floor(Math.random() * set.length)]).join('');
const letters = () => rnd(5, 'abcdefghijklmnopqrstuvwxyz');

async function staffLogin(station, pin) {
  const r = await post('staff/enter', pin ? { code: station, pin } : { code: station });
  must(`${station} 입장`, okRes(r), r.text);
  return r.json.access.token;
}

const NAMES = ['테스트', '테스터', '테스투'];
const people = []; // {name, sid, card_id, token, refresh, claim}

async function issueOne(T, i) {
  const sid = '9' + rnd(4, '0123456789');
  const name = NAMES[i];
  let r = await post('issue/create', { sid, name, part: 1 }, T.suc1);
  must(`[${name}] 발급 요청`, okRes(r) && Number.isInteger(r.json.card_id), r.text);
  const card_id = r.json.card_id;
  created.push(card_id);

  const session = letters();
  r = await post('entry/claim', { card_id, session_name: session });
  must(`[${name}] 참여자가 번호+세션명 제출`, okRes(r) && r.json.claim_id && r.json.secret, r.text);
  const claim = r.json;

  r = await get('issue/state', T.suc1);
  check(`[${name}] 발급 화면에 세션명 ${session} 도착`, okRes(r) && r.json.pending?.card_id === card_id && r.json.pending?.claim?.session_name === session, r.text);

  r = await post('issue/confirm', { card_id }, T.suc1);
  must(`[${name}] 발급 확인`, okRes(r), r.text);

  r = await post('entry/status', { claim_id: claim.claim_id, secret: claim.secret });
  must(`[${name}] 참여자가 토큰 받음`, okRes(r) && r.json.status === 'confirmed' && r.json.access?.token, r.text);
  people.push({ name, sid, card_id, token: r.json.access.token, refresh: r.json.refresh.token });
}

async function balanceOf(T, p) {
  const r = await post('adjust/card', { card_id: p.card_id }, T.suc2);
  return okRes(r) ? r.json : null;
}

function cleanupSql() {
  const ids = created.join(', ');
  return `-- 시험 데이터 정리 (카드 ${ids || '없음'})
do $$
declare ids int[] := array[${ids}]::int[]; mids bigint[];
begin
  select array_agg(distinct match_id) into mids from (
    select match_id from public.match_slots where card_id = any(ids)
    union select match_id from public.tlist where card_id = any(ids) and match_id is not null
    union select match_id from public.glist where card_id = any(ids) and match_id is not null) x;
  delete from public.tlist where card_id = any(ids);
  delete from public.glist where card_id = any(ids);
  delete from public.match_slots where card_id = any(ids) or match_id = any(coalesce(mids, '{}'));
  delete from public.orders where card_id = any(ids);
  delete from public.claims where card_id = any(ids);
  delete from public.matches where id = any(coalesce(mids, '{}'));
  delete from public.matches m where m.phase = 'prep'
    and not exists (select 1 from public.match_slots s where s.match_id = m.id);
  delete from public.cards where id = any(ids);
  delete from public.audit_log;
  update public.stations set current_card_id = null where code = 'suc1';
end $$;
select (select count(*) from public.cards where id = any(array[${ids}]::int[])) as 남은_시험카드;`;
}

async function main() {
  console.log('서버: ' + BASE);

  step('0. 문 잠금 확인 (토큰 없이 부르면 막혀야 함)');
  for (const [m, p] of [['GET', 'issue/cards'], ['POST', 'game/settle'], ['POST', 'me/bet'], ['GET', 'hof/list'], ['POST', 'adjust/tlist-delete'], ['POST', 'shop/approve'], ['POST', 'hof/winner-pii']]) {
    const r = await api(m, p, { body: {} });
    check(`${p} → 401`, r.status === 401 && code(r) === 'UNAUTHORIZED', r.text);
  }
  const nr = await get('no/such/route');
  check('없는 주소 → 404', nr.status === 404, nr.text);

  step('1. 스태프 입장');
  const T = {};
  T.suc1 = await staffLogin('suc1');
  T.suc2 = await staffLogin('suc2', PIN);
  T.hg21 = await staffLogin('hg21');
  T.shp1 = await staffLogin('shp1', PIN);
  T.shp2 = await staffLogin('shp2');
  T.tbs1 = await staffLogin('tbs1');
  T.slt1 = await staffLogin('slt1');
  let r = await post('staff/enter', { code: 'suc2', pin: '000000x' });
  check('틀린 PIN은 거부', r.status === 401, r.text);

  step('2. 회차 시작 + 발급 슬롯 확인');
  r = await post('issue/part', { part: 1, status: 'active' }, T.suc1);
  must('1부 시작', okRes(r), r.text);
  r = await get('issue/state', T.suc1);
  must('발급 슬롯이 비어 있음', okRes(r) && r.json.pending === null, r.json?.pending ?? r.text);
  check('1부 진행중', r.json.parts?.['1'] === 'active', r.json.parts);

  step('3. 시험 카드 3장 발급 (발급 → 번호 입력 → 확인 → 토큰)');
  for (let i = 0; i < 3; i++) await issueOne(T, i);
  const [A, B, C] = people;
  r = await post('entry/claim', { card_id: A.card_id, session_name: letters() });
  check('이미 활성인 카드는 또 연결 불가', r.status === 409, r.text);
  r = await post('issue/create', { sid: A.sid, name: '테스트', part: 1 }, T.suc1);
  check('같은 학번 중복 발급 거부', r.status === 409 && code(r) === 'DUPLICATE_SID', r.text);
  if (okRes(r)) { await post('issue/cancel', { card_id: r.json.card_id }, T.suc1); }
  for (const p of people) {
    const b = await balanceOf(T, p);
    check(`[${p.name}] WELCOME +5 → 잔고 5`, b && b.balance === 5 && b.tlist[0]?.kind === 'WELCOME', b);
  }
  r = await post('auth/refresh', { refresh: A.refresh });
  check('refresh로 새 access 발급', okRes(r) && r.json.access?.token, r.text);

  step('4. 친구 대결 (A vs B, 할리갈리)');
  r = await post('game/scan', { card_id: A.card_id }, T.hg21);
  must('A 스캔', okRes(r), r.text);
  const matchId = r.json.match_id; const slotA = r.json.slot;
  r = await post('game/scan', { card_id: B.card_id }, T.hg21);
  must('B 스캔', okRes(r) && r.json.match_id === matchId, r.text);
  const slotB = r.json.slot;
  r = await post('game/scan', { card_id: A.card_id }, T.hg21);
  check('같은 카드 또 스캔은 같은 칸을 돌려줌 (중복 배정 없음)', okRes(r) && r.json.match_id === matchId && r.json.slot === slotA, r.text);
  r = await post('game/accept', { match_id: matchId, slot: slotA }, T.hg21);
  check('베팅 전 수락은 거부 (BET_NOT_SET)', code(r) === 'BET_NOT_SET', r.text);
  r = await post('me/bet', { bet: 2 }, A.token);
  must('A 베팅 2', okRes(r), r.text);
  r = await post('me/bet', { bet: 2 }, B.token);
  must('B 베팅 2', okRes(r), r.text);
  r = await post('me/bet', { bet: 99 }, B.token);
  console.log(`  · 잔고보다 큰 베팅 99 → 응답 ${r.status} ${code(r) ?? ''} (거부가 아니면 수락 단계에서 막힘)`);
  r = await post('me/bet', { bet: 2 }, B.token);
  must('B 베팅 2로 다시 확정', okRes(r), r.text);
  r = await post('game/accept', { match_id: matchId, slot: slotA }, T.hg21);
  must('A 수락', okRes(r), r.text);
  r = await post('game/accept', { match_id: matchId, slot: slotB }, T.hg21);
  must('B 수락', okRes(r), r.text);
  r = await post('game/accept', { match_id: matchId, slot: slotB }, T.shp1);
  check('다른 역할 스태프는 수락 못 함', r.status === 403, r.text);
  r = await post('game/settle', { match_id: matchId }, T.hg21);
  check('시작 전 정산은 거부 (BAD_PHASE)', r.status === 409, r.text);
  r = await post('game/start', {}, T.hg21);
  must('시작 (친구 대결)', okRes(r) && r.json.vs === 'friends', r.text);
  r = await get('game/state', T.hg21);
  check('진행 상태 복구 가능', okRes(r) && r.json.match?.phase === 'playing' && r.json.slots.length === 2, r.text);
  r = await post('game/end', {}, T.hg21);
  must('종료', okRes(r), r.text);
  r = await post('game/result', { win: 'Z' }, T.hg21);
  check('이상한 결과값 거부', code(r) === 'BAD_RESULT', r.text);
  r = await post('game/result', { win: slotA }, T.hg21);
  must('결과: A 승', okRes(r), r.text);
  r = await post('game/back', {}, T.hg21);
  check('결과 다시 고르기', okRes(r), r.text);
  r = await post('game/result', { win: slotA }, T.hg21);
  must('결과 다시: A 승', okRes(r), r.text);
  r = await post('me/ack', {}, A.token);
  check('A 결과 확인', okRes(r), r.text);
  r = await post('game/settle', { match_id: matchId }, T.hg21);
  must('정산', okRes(r) && r.json.already === false, r.text);
  r = await post('game/settle', { match_id: matchId }, T.hg21);
  check('정산 두 번째는 already (코인 중복 지급 없음)', okRes(r) && r.json.already === true, r.text);
  const a1 = await balanceOf(T, A), b1 = await balanceOf(T, B);
  // 규칙: 친구 대결 승자 = 내 베팅 2배 + 다른 사람 베팅 → 변화량 +(2+2)=+4, 패자 -2
  check(`정산 금액: A 5→9 (+4), B 5→3 (-2) (실제 A=${a1?.balance}, B=${b1?.balance})`, a1?.balance === 9 && b1?.balance === 3, { a1: a1?.balance, b1: b1?.balance });
  check('A, B 모두 RESULT 기록 1줄', a1?.tlist.filter((x) => x.kind === 'RESULT').length === 1 && b1?.tlist.filter((x) => x.kind === 'RESULT').length === 1);
  check('A 할리갈리 참여 횟수 1', a1?.glist.find((g) => g.game === 'HALLIGALLI')?.n === 1, a1?.glist);

  step('5. 운영진 대결 (C 혼자)');
  r = await post('game/scan', { card_id: C.card_id }, T.hg21);
  must('C 스캔', okRes(r), r.text);
  const m2 = r.json.match_id; const slotC = r.json.slot;
  r = await post('me/bet', { bet: 2 }, C.token);
  must('C 베팅 2', okRes(r), r.text);
  r = await post('game/accept', { match_id: m2, slot: slotC }, T.hg21);
  must('C 수락', okRes(r), r.text);
  r = await post('game/start', {}, T.hg21);
  must('시작 (운영진 대결)', okRes(r) && r.json.vs === 'staff', r.text);
  r = await post('game/end', {}, T.hg21);
  must('종료', okRes(r), r.text);
  r = await post('game/result', { win: 'W' }, T.hg21);
  must('결과 W', okRes(r), r.text);
  r = await post('game/settle', { match_id: m2 }, T.hg21);
  must('정산', okRes(r), r.text);
  const c1 = await balanceOf(T, C);
  check(`C 잔고 변동 (5 → ${c1?.balance})`, c1 && c1.balance !== 5, c1?.balance);

  step('6. 스태프가 베팅 중인 참여자를 내보내기 + 참여자 나가기');
  r = await post('game/scan', { card_id: B.card_id }, T.hg21);
  must('B 다시 스캔', okRes(r), r.text);
  const m3 = r.json.match_id; const slotB3 = r.json.slot;
  r = await post('game/reject', { match_id: m3, slot: slotB3 }, T.hg21);
  check('✕ 로 내보내기', okRes(r), r.text);
  r = await post('game/scan', { card_id: B.card_id }, T.hg21);
  must('B 또 스캔', okRes(r), r.text);
  r = await post('me/leave', {}, B.token);
  check('참여자가 직접 나가기', okRes(r), r.text);
  r = await get('game/state', T.hg21);
  check('빈 칸만 남은 매치는 진행 중 아님 또는 칸 0개', okRes(r) && (r.json.match === null || r.json.slots.length === 0), r.json);

  step('7. 슬롯 머신 이벤트 (slt1)');
  r = await post('event/slot', { card_id: A.card_id, reward: 6 }, T.slt1);
  check('A 당첨 6', okRes(r) && r.json.reward === 6 && r.json.already === false, r.text);
  const beforeA = a1.balance;
  r = await post('event/slot', { card_id: A.card_id, reward: 6 }, T.slt1);
  check('같은 값 재전송은 already', okRes(r) && r.json.already === true, r.text);
  r = await post('event/slot', { card_id: A.card_id, reward: 12 }, T.slt1);
  check('다른 값은 ALREADY_PLAYED', code(r) === 'ALREADY_PLAYED', r.text);
  r = await post('event/slot', { card_id: B.card_id, reward: 5 }, T.slt1);
  check('없는 금액 5는 거부', code(r) === 'BAD_REWARD', r.text);
  const a2 = await balanceOf(T, A);
  check(`A 잔고 +6 한 번만 (${beforeA} → ${a2?.balance})`, a2?.balance === beforeA + 6, a2?.balance);

  step('8. 정정 (suc2): 추가, 수정, 삭제, 횟수');
  r = await post('adjust/tlist-add', { card_id: A.card_id, delta: 3, reason: 'e2e 시험' }, T.suc2);
  must('+3 정정 추가', okRes(r) && r.json.id, r.text);
  const adjId = r.json.id;
  let a3 = await balanceOf(T, A);
  check('잔고 +3', a3?.balance === a2.balance + 3, a3?.balance);
  r = await post('adjust/tlist-edit', { id: adjId, coin_delta: 4 }, T.suc2);
  check('+4 로 수정', okRes(r), r.text);
  a3 = await balanceOf(T, A);
  check('잔고 +4', a3?.balance === a2.balance + 4, a3?.balance);
  r = await post('adjust/tlist-delete', { id: adjId }, T.suc2);
  check('정정 삭제', okRes(r), r.text);
  a3 = await balanceOf(T, A);
  check('잔고 원래대로', a3?.balance === a2.balance, a3?.balance);
  check('최대 보유치 ≥ 잔고', a3 && a3.peak >= a3.balance, { peak: a3?.peak, bal: a3?.balance });
  r = await post('adjust/tlist-add', { card_id: A.card_id, delta: -1000, reason: 'e2e 과다' }, T.suc2);
  check('잔고보다 크게 깎기는 거부', code(r) === 'BALANCE_LOW', r.text);
  r = await post('adjust/glist-set', { card_id: A.card_id, game: 'JOKER', n: 2 }, T.suc2);
  check('게임 횟수 직접 지정', okRes(r), r.text);
  r = await post('adjust/glist-set', { card_id: A.card_id, game: 'POKER', n: 2 }, T.suc2);
  check('모르는 게임은 거부', r.status === 400, r.text);
  r = await post('adjust/card', { card_id: A.card_id }, T.hg21);
  check('suc2가 아니면 거부', r.status === 403, r.text);

  step('9. 재연결 (C의 새 기기)');
  r = await post('entry/reconnect', { sid: C.sid, name: '엉뚱함', session_name: letters() });
  check('이름이 틀리면 INFO_MISMATCH', code(r) === 'INFO_MISMATCH', r.text);
  const sess = letters();
  r = await post('entry/reconnect', { sid: C.sid, name: C.name, session_name: sess });
  must('학번+이름으로 재연결 요청', okRes(r) && r.json.claim_id, r.text);
  const rc = r.json;
  r = await post('entry/status', { claim_id: rc.claim_id, secret: rc.secret });
  check('확정 전에는 waiting', okRes(r) && r.json.status === 'waiting', r.text);
  r = await post('entry/status', { claim_id: rc.claim_id, secret: 'x'.repeat(24) });
  check('비밀이 틀리면 401', r.status === 401, r.text);
  r = await get('issue/state', T.suc1);
  check('발급 화면에 재연결 요청 도착', okRes(r) && r.json.reconnects?.some((x) => x.claim_id === rc.claim_id && x.session_name === sess), r.json?.reconnects);
  r = await post('issue/reconnect-confirm', { claim_id: rc.claim_id }, T.suc1);
  must('suc1이 재연결 확정', okRes(r), r.text);
  r = await post('entry/status', { claim_id: rc.claim_id, secret: rc.secret });
  must('새 기기가 새 토큰 받음', okRes(r) && r.json.status === 'confirmed', r.text);
  const oldC = C.token; C.token = r.json.access.token; C.refresh = r.json.refresh.token;
  r = await post('me/bet', { bet: 1 }, oldC);
  check('이전 기기는 STALE_TOKEN', code(r) === 'STALE_TOKEN', r.text);
  r = await post('auth/refresh', { refresh: C.refresh });
  check('새 기기 refresh 정상', okRes(r), r.text);
  r = await post('me/bet', { bet: 1 }, C.token);
  check('새 기기 토큰은 통과 (게임 중이 아니라 NOT_IN_MATCH)', code(r) === 'NOT_IN_MATCH', r.text);

  step('10. 퇴장과 이용 제한 (발급 데스크)');
  r = await post('issue/exit', { card_id: B.card_id }, T.suc1);
  check('B 퇴장', okRes(r), r.text);
  r = await post('issue/exit', { card_id: B.card_id }, T.suc1);
  check('B 퇴장 두 번째도 오류 없음 (기록 중복 없음)', okRes(r), r.text);
  r = await post('game/scan', { card_id: B.card_id }, T.hg21);
  check('퇴장한 카드는 스캔 불가', r.status >= 400, r.text);
  r = await post('issue/ban', { card_id: C.card_id }, T.suc1);
  check('C 이용 제한', okRes(r), r.text);
  r = await post('me/bet', { bet: 1 }, C.token);
  check('제한된 카드는 게임 불가', r.status >= 400, r.text);
  r = await get('issue/cards', T.suc1);
  const row = (p) => r.json?.cards?.find((x) => x.id === p.card_id);
  check('카드 표: A 활성, B 퇴장, C 제한', okRes(r) && row(A)?.status === 'active' && row(B)?.status === 'done' && row(C)?.status === 'banned', r.json?.cards?.filter((x) => created.includes(x.id)));
  check('카드 표에 가린 이름만', row(A)?.name === '테*트' && !r.text.includes('name_enc'), row(A));
  r = await post('issue/reveal', { card_id: A.card_id }, T.suc1);
  check('이름 보기', okRes(r) && r.json.name === '테스트' && r.json.sid === undefined, r.text);

  step('11. 상점 (A): 주문 → 승인 → 배부');
  r = await get('shop/products', A.token);
  must('상품 목록', okRes(r) && r.json.products.length > 0, r.text);
  const sale = r.json.products.filter((p) => p.status === 'on_sale').sort((x, y) => x.price - y.price)[0];
  must('판매 중인 상품 있음', !!sale, r.json.products);
  const ab = await balanceOf(T, A);
  if (ab.balance < sale.price) {
    r = await post('adjust/tlist-add', { card_id: A.card_id, delta: sale.price - ab.balance + 1, reason: 'e2e 상점 시험' }, T.suc2);
    check('잔고 보충 (정정)', okRes(r), r.text);
  }
  r = await post('shop/order', { items: [{ id: sale.id, qty: 1 }], total: 0 }, A.token);
  if (code(r) === 'NOT_ENOUGH_PLAYS') {
    console.log('  · 참여 횟수 부족 → suc2로 게임 횟수를 올린 뒤 다시 주문');
    for (const g of ['SKEWER', 'CHAMCHAMCHAM', 'JOKER', 'RANDOMBALL', 'TABLESOCCER']) {
      await post('adjust/glist-set', { card_id: A.card_id, game: g, n: 3 }, T.suc2);
    }
    r = await post('shop/order', { items: [{ id: sale.id, qty: 1 }] }, A.token);
  }
  must(`주문 (${sale.name})`, okRes(r) && r.json.order_id, r.text);
  const orderId = r.json.order_id;
  r = await post('shop/order', { items: [{ id: sale.id, qty: 1 }] }, A.token);
  check('같은 주문 재전송은 기존 주문을 돌려줌 (중복 주문 없음)', okRes(r) && r.json.order_id === orderId, r.text);
  r = await get('shop/orders', T.shp1);
  const mine = r.json?.orders?.find((o) => o.id === orderId);
  check('shp1 대기열에 주문이 보임 (잔고 포함)', okRes(r) && mine && typeof mine.balance === 'number', r.text);
  r = await post('shop/approve', { order_id: orderId }, T.shp2);
  check('shp2는 승인 못 함', r.status === 403, r.text);
  const pre = await balanceOf(T, A);
  r = await post('shop/approve', { order_id: orderId }, T.shp1);
  must('shp1 승인', okRes(r), r.text);
  r = await post('shop/approve', { order_id: orderId }, T.shp1);
  check('승인 두 번째는 already (이중 차감 없음)', okRes(r) && r.json.already === true, r.text);
  const post1 = await balanceOf(T, A);
  check(`잔고 ${sale.price} 차감 (${pre.balance} → ${post1.balance})`, post1.balance === pre.balance - sale.price, post1.balance);
  check('구매 후 A 퇴장 처리', post1.card.status === 'done', post1.card);
  r = await get('shop/queue', T.shp2);
  check('shp2 배부 대기열에 보임', okRes(r) && r.json.orders.some((o) => o.id === orderId), r.text);
  r = await post('shop/deliver', { order_id: orderId }, T.shp2);
  check('shp2 배부 완료', okRes(r), r.text);
  r = await post('shop/stock', { id: sale.id, status: 'sold_out' }, T.shp1);
  check('shp1 품절 처리', okRes(r), r.text);
  r = await get('shop/products', A.token);
  check('목록에 품절 반영', r.json?.products?.find((p) => p.id === sale.id)?.status === 'sold_out', r.json);
  r = await post('shop/stock', { id: sale.id, status: 'on_sale' }, T.shp1);
  check('판매 복구', okRes(r), r.text);

  step('12. 명예의 전당 (10초 캐시를 기다리는 중…)');
  await sleep(11000);
  r = await get('hof/list', T.tbs1);
  must('목록', okRes(r) && Array.isArray(r.json.ranks), r.text);
  const hr = (p) => r.json.ranks.find((x) => x.card_id === p.card_id);
  check('이용 제한된 C는 제외', !hr(C), hr(C));
  check('퇴장한 A, B는 포함', !!hr(A) && !!hr(B), { A: hr(A), B: hr(B) });
  const sorted = r.json.ranks.every((x, i, arr) => i === 0 || arr[i - 1].v >= x.v);
  check('값 내림차순', sorted);
  check('이름은 가린 상태', hr(A)?.n === '테*트', hr(A));
  const peakA = (await balanceOf(T, A)).peak;
  check(`A 순위값 = 최대 보유치 (${hr(A)?.v} = ${peakA})`, hr(A)?.v === peakA, { v: hr(A)?.v, peak: peakA });
  const r2 = await get('hof/list', T.tbs1);
  check('두 번째 호출은 캐시에서 (Redis 동작)', okRes(r2) && r2.json.cached === true, r2.json?.cached);
  r = await post('hof/winner-pii', { card_id: A.card_id, pin: '000000x' }, T.tbs1);
  check('PIN 틀리면 거부', r.status === 401, r.text);
  r = await post('hof/winner-pii', { card_id: A.card_id, pin: PIN }, T.tbs1);
  check('PIN 맞으면 실명·학번 (우승 순위 안일 때만)', (okRes(r) && r.json.name === A.name && r.json.sid === A.sid) || (r.status === 403 && code(r) === 'FORBIDDEN'), r.text);
  r = await post('hof/winner-pii', { card_id: C.card_id, pin: PIN }, T.tbs1);
  check('제한된 C는 열람 불가', r.status === 403, r.text);
  r = await get('hof/list', T.suc1);
  check('tbs1이 아니면 거부', r.status === 403, r.text);
}

let stopped = false;
try {
  await main();
} catch (e) {
  stopped = true;
  if (e instanceof Stop) console.log('\n✗ 여기서 멈춤: ' + e.message);
  else console.log('\n✗ 예상 못한 오류: ' + (e?.message ?? e));
}

console.log('\n==============================');
console.log(`통과 ${pass}  /  실패 ${fail}${stopped ? '  (중간에 멈춤)' : ''}`);
console.log(fail === 0 && !stopped ? '모두 정상입니다.' : '실패한 줄의 ✗ 아래 내용을 알려주세요.');
console.log('\n아래 SQL을 Supabase SQL Editor에서 실행해 시험 데이터를 지웁니다.');
console.log('(행사 전에만 사용. audit_log 전체도 지워집니다.)\n');
console.log(cleanupSql());
process.exit(fail === 0 && !stopped ? 0 : 1);
