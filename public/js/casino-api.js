/* CASINO 공용 서버 클라이언트.
 * 화면에서는 <script src="/js/casino-api.js"></script> 한 줄만 넣고 window.CasinoAPI를 쓴다.
 * - 토큰 저장(브라우저 localStorage), 만료 전 자동 갱신, 401 한 번 재시도
 * - 오류는 항상 CasinoError(status, code, message, detail)로 던진다. 화면은 e.code로 분기한다.
 * - 이전 기기 로그아웃(STALE_TOKEN)은 onSessionLost 콜백으로 알린다.
 */
(function (root) {
  'use strict';

  function CasinoError(status, code, message, detail) {
    var e = new Error(message || code || '요청에 실패했습니다.');
    e.name = 'CasinoError';
    e.status = status; e.code = code; e.detail = detail;
    return e;
  }

  var KEYS = { staff: 'casino.staff', me: 'casino.me' };
  var SKEW = 30; // 만료 30초 전에 미리 갱신

  function createClient(opt) {
    opt = opt || {};
    var base = (opt.baseUrl || '').replace(/\/+$/, '');
    var doFetch = opt.fetch || (typeof fetch !== 'undefined' ? fetch.bind(root) : null);
    var store = opt.storage || safeStorage();
    var now = opt.now || function () { return Math.floor(Date.now() / 1000); };
    var lostHandlers = [];
    var refreshing = { staff: null, me: null };

    function safeStorage() {
      var mem = {};
      try {
        var ls = root.localStorage; ls.setItem('__t', '1'); ls.removeItem('__t');
        return ls;
      } catch (e) {
        return { getItem: function (k) { return k in mem ? mem[k] : null; }, setItem: function (k, v) { mem[k] = String(v); }, removeItem: function (k) { delete mem[k]; } };
      }
    }
    function load(kind) {
      try { var v = store.getItem(KEYS[kind]); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    }
    function save(kind, s) { try { store.setItem(KEYS[kind], JSON.stringify(s)); } catch (e) { /* 저장 불가: 메모리 없이 계속 */ } }
    function clear(kind) { try { store.removeItem(KEYS[kind]); } catch (e) { /* 무시 */ } }
    function lost(kind, code) { clear(kind); lostHandlers.forEach(function (h) { try { h(kind, code); } catch (e) { /* 무시 */ } }); }

    function raw(method, path, body, token) {
      if (!doFetch) return Promise.reject(CasinoError(0, 'NETWORK', '네트워크를 사용할 수 없습니다.'));
      var headers = { 'content-type': 'application/json' };
      if (token) headers.authorization = 'Bearer ' + token;
      return doFetch(base + '/api/' + path, {
        method: method, headers: headers,
        body: method === 'GET' ? undefined : JSON.stringify(body || {}),
        cache: 'no-store',
      }).then(function (res) {
        return res.text().then(function (text) {
          var json = null;
          try { json = JSON.parse(text); } catch (e) { /* JSON 아님 */ }
          return { status: res.status, json: json };
        });
      }, function () {
        throw CasinoError(0, 'NETWORK', '네트워크 연결을 확인해주세요.');
      });
    }
    function unwrap(r) {
      if (r.json && r.json.ok === true) return r.json;
      var j = r.json || {};
      throw CasinoError(r.status, j.code || 'SERVER', j.message, j.detail);
    }

    /* 토큰 갱신: 같은 종류는 동시에 한 번만 */
    function refresh(kind) {
      if (refreshing[kind]) return refreshing[kind];
      var s = load(kind);
      if (!s || !s.refresh) return Promise.reject(CasinoError(401, 'UNAUTHORIZED', '다시 로그인해주세요.'));
      refreshing[kind] = raw('POST', 'auth/refresh', { refresh: s.refresh.token }).then(function (r) {
        refreshing[kind] = null;
        if (r.json && r.json.ok && r.json.access) {
          s.access = r.json.access; save(kind, s); return s;
        }
        var code = (r.json && r.json.code) || 'UNAUTHORIZED';
        if (r.status === 401 || r.status === 403) lost(kind, code);
        throw CasinoError(r.status, code, r.json && r.json.message);
      }, function (e) { refreshing[kind] = null; throw e; });
      return refreshing[kind];
    }

    function authed(kind, method, path, body) {
      var s = load(kind);
      if (!s || !s.access) return Promise.reject(CasinoError(401, 'UNAUTHORIZED', '로그인이 필요합니다.'));
      var ready = s.access.expiresAt - now() <= SKEW ? refresh(kind) : Promise.resolve(s);
      return ready.then(function (cur) {
        return raw(method, path, body, cur.access.token).then(function (r) {
          if (r.status === 401 && r.json && r.json.code === 'STALE_TOKEN') { lost(kind, 'STALE_TOKEN'); return unwrap(r); }
          if (r.status === 401 && r.json && r.json.code === 'UNAUTHORIZED') {
            return refresh(kind).then(function (n) {
              return raw(method, path, body, n.access.token).then(function (r2) {
                if (r2.status === 401) lost(kind, (r2.json && r2.json.code) || 'UNAUTHORIZED');
                return unwrap(r2);
              });
            });
          }
          return unwrap(r);
        });
      });
    }

    function pub(method, path, body) { return raw(method, path, body).then(unwrap); }

    var api = {
      /* 세션 */
      staffSession: function () { var s = load('staff'); return s ? { station: s.station, role: s.role } : null; },
      meSession: function () { var s = load('me'); return s ? { card_id: s.card_id } : null; },
      logout: function (kind) { clear(kind); },
      onSessionLost: function (fn) { lostHandlers.push(fn); },
      call: authed,

      /* 입장 */
      staffEnter: function (code, pin) {
        var b = { code: code }; if (pin !== undefined && pin !== null && pin !== '') b.pin = pin;
        return pub('POST', 'staff/enter', b).then(function (r) {
          save('staff', { station: r.station, role: r.role, access: r.access, refresh: r.refresh });
          return { station: r.station, role: r.role };
        });
      },
      /* 참여자 입장: 번호+세션명 제출 → 확정 대기 → 토큰 */
      claim: function (cardId, sessionName) {
        return pub('POST', 'entry/claim', { card_id: cardId, session_name: sessionName }).then(function (r) {
          return { claim_id: r.claim_id, secret: r.secret, session_name: r.session_name };
        });
      },
      reconnect: function (sid, name, sessionName) {
        return pub('POST', 'entry/reconnect', { sid: sid, name: name, session_name: sessionName }).then(function (r) {
          return { claim_id: r.claim_id, secret: r.secret, session_name: r.session_name, card_id: r.card_id };
        });
      },
      /* 상태 확인. 확정되면 토큰을 저장하고 {status:'confirmed', card_id}를 돌려준다 */
      claimStatus: function (claim) {
        return pub('POST', 'entry/status', { claim_id: claim.claim_id, secret: claim.secret }).then(function (r) {
          if (r.status === 'confirmed') {
            save('me', { card_id: r.card_id, access: r.access, refresh: r.refresh });
            return { status: 'confirmed', card_id: r.card_id };
          }
          return { status: r.status };
        });
      },
      /* 확정을 기다리며 주기적으로 확인. 끝나면 마지막 상태를 돌려준다. stop()으로 중단 */
      waitClaim: function (claim, o) {
        o = o || {};
        var every = o.every || 2000, stopped = false, timer = null, finish = null;
        var p = new Promise(function (resolve, reject) {
          finish = resolve;
          function tick() {
            if (stopped) return resolve({ status: 'stopped' });
            api.claimStatus(claim).then(function (s) {
              if (o.onStatus) o.onStatus(s);
              if (s.status !== 'waiting') return resolve(s);
              timer = setTimeout(tick, every);
            }, function (e) {
              if (e.code === 'NETWORK') { timer = setTimeout(tick, every * 2); return; }
              reject(e);
            });
          }
          tick();
        });
        p.stop = function () { stopped = true; if (timer) clearTimeout(timer); finish({ status: 'stopped' }); };
        return p;
      },
    };

    /* 자주 쓰는 호출을 이름으로 (staff = 스태프 토큰, me = 참여자 토큰) */
    function S(m, p) { return function (b) { return authed('staff', m, p, b); }; }
    function M(m, p) { return function (b) { return authed('me', m, p, b); }; }
    api.staff = {
      issueState: S('GET', 'issue/state'), issueCards: S('GET', 'issue/cards'),
      issueCreate: S('POST', 'issue/create'), issueConfirm: S('POST', 'issue/confirm'), issueCancel: S('POST', 'issue/cancel'),
      issuePart: S('POST', 'issue/part'), issueExit: S('POST', 'issue/exit'), issueBan: S('POST', 'issue/ban'), issueReveal: S('POST', 'issue/reveal'),
      reconnectConfirm: S('POST', 'issue/reconnect-confirm'), reconnectReject: S('POST', 'issue/reconnect-reject'),
      gameState: S('GET', 'game/state'), gameScan: S('POST', 'game/scan'), gameAccept: S('POST', 'game/accept'), gameReject: S('POST', 'game/reject'),
      gameStart: S('POST', 'game/start'), gameEnd: S('POST', 'game/end'), gameResult: S('POST', 'game/result'),
      gameBack: S('POST', 'game/back'), gameSettle: S('POST', 'game/settle'), gameAbort: S('POST', 'game/abort'),
      shopOrders: S('GET', 'shop/orders'), shopApprove: S('POST', 'shop/approve'), shopReject: S('POST', 'shop/reject'), shopStock: S('POST', 'shop/stock'),
      shopQueue: S('GET', 'shop/queue'), shopDeliver: S('POST', 'shop/deliver'),
      adjustCard: S('POST', 'adjust/card'), adjustAdd: S('POST', 'adjust/tlist-add'), adjustEdit: S('POST', 'adjust/tlist-edit'),
      adjustDelete: S('POST', 'adjust/tlist-delete'), adjustGames: S('POST', 'adjust/glist-set'),
      eventSlot: S('POST', 'event/slot'), hofList: S('GET', 'hof/list'), hofPii: S('POST', 'hof/winner-pii'),
    };
    api.me = {
      state: M('GET', 'me/state'), bet: M('POST', 'me/bet'), leave: M('POST', 'me/leave'), ack: M('POST', 'me/ack'),
      products: M('GET', 'shop/products'), order: M('POST', 'shop/order'), cancelOrder: M('POST', 'shop/cancel'),
    };
    return api;
  }

  var out = { createClient: createClient, CasinoError: CasinoError };
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
  if (root && typeof root === 'object') { root.CasinoError = CasinoError; if (!root.CasinoAPI && root.document) root.CasinoAPI = createClient({}); }
})(typeof window !== 'undefined' ? window : globalThis);
