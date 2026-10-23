/**
 * momo-matchmaking.js  v1.05
 * MOMO Works 共通マッチング・通信モジュール
 * WebSocket（シグナリング）と WebRTC（P2P通信）を内包する。
 * ゲーム側は MomoMatchmaking.init() でコールバックを登録するだけで対戦相手との通信を確立できる。
 *
 * 対応ゲーム: MOMO Reversi v2.06 以降、その他 MOMO Works ブラウザゲーム
 * GitHub Pages: qiqiroon.github.io/momo/
 * Terms of Use: https://qiqiroon.github.io/momo/terms.html
 *
 * v1.01 (2026-05-15): _resetConnection() 内で WS が CLOSED/CLOSING の場合
 *   自動再接続を発火するよう変更。これにより「対戦中切断 → ロビー戻り → 新部屋作成/参加」
 *   が再起動なしで成立する（Darts の対戦中止フロー / 他ゲームの切断後動作で必要）。
 *
 * v1.02 (2026-07-30): 多人数（mode:'multi'）対応を追加（従来1対1は完全温存）。
 *   多人数ではWebRTCを張らず、サーバー中継（WebSocket）で送受信する。
 *   - createRoom に mode/maxPlayers/maxSpectators、joinRoom に role（第4引数）
 *   - send(data, to) に宛先を追加（'all'|'host'|pid）。従来の send(data) は挙動不変
 *   - onRoomCreated/onJoinedRoom の末尾に多人数情報 {mode,pid,role,roster} を追加引数で通知
 *   - 新コールバック onParticipantJoined / onParticipantLeft
 *   多人数の送受信は _sendMulti に集約（将来の直結経路へ差し替え可能な出入口）。
 *
 * v1.05 (2026-10-23): 対局中の切断からの復帰（従来1対1の部屋だけ・頼んだアプリにだけ効く）。
 *   アプリが reviveBegin() を呼んだときだけ動く。呼ばないアプリ（Reversi・Darts・Hanafuda・Control・Mahjong・Shogi）は動きが変わらない。
 *   サーバーは変えない。「切れた」はアプリどうしで判断し（10 秒ごとの mm_rv_here・25 秒届かなければ）、部屋は残った人が持つ：
 *   残った人がホストならそのまま（居座った接続は追い出す）、ゲストなら元の部屋をのぞいてから同じ名前で作り直してホストになる。
 *   戻る人は一覧から「同じ部屋名で、ホストが相手」の部屋を探し、合言葉（mm_rv_back）で本人と確かめてもらう。
 *   盤面の渡し直し・CPU の引き継ぎはアプリの仕事（設計の正本 games/matchmaking/docs/reconnect-design）。
 *   ★合言葉（secret）は端末の中だけ。診断の記録・チャット・URL に出さない。
 *
 * v1.04 (2026-10-20): サーバーからの「生きていますか」（mm_alive_q）に自動で答える（mm_alive_a）。アプリへは渡さない。
 *   一覧に入る知らせ（enter_lobby）に「答えられる版」の印 alive:1 を添える（サーバーは印のある接続にだけ知らせで尋ねる）。
 *   本番は Render の中継が回線の ping に代わりに答えてしまい、止まった端末も生きて見えるため（10-20 に実測）。
 *   ほかの口・コールバック・getState() は不変。
 *
 * v1.03 (2026-10-20): 新しい問い合わせ口 getToken() を追加（既存の口・コールバック・getState() は一切不変）。
 *   サーバーが room_created / joined_room に入れて送る合言葉（token＝切れたあとに同じ席へ戻るためのもの）を
 *   内側に控え、部屋にいるあいだだけ返す（部屋にいなければ null）。呼ばないアプリの動きは変わらない。
 *   ★合言葉は診断の記録・チャット・URL などに出さないこと（設計の正本 docs に記載）。
 */

const MomoMatchmaking = (() => {

  // ===== プライベート変数 =====
  let _ws = null;
  let _pc = null;
  let _dc = null;

  let _options = {};
  let _isHost = false;
  let _connected = false;
  let _currentRoomId = null;
  let _currentRoomName = '';

  let _keepaliveTimer = null;
  let _sleepGuardTimer = null;

  // 多人数（mode:'multi'）用の状態。従来1対1では未使用（_mode='classic'のまま）。
  let _mode = 'classic';   // 'classic'(従来1対1・WebRTC) | 'multi'(多人数・サーバー中継)
  let _pid = null;         // 多人数：自分の参加者ID
  let _pRole = null;       // 多人数：'host' | 'player' | 'spectator'
  let _roster = [];        // 多人数：参加者名簿 [{pid, role, name}]

  // v1.03：サーバーが部屋を作った・入ったときに送る合言葉（getToken() で返すだけ。ほかでは使わない）
  let _token = null;
  // サーバーの項目名は 多人数＝token／1対1のホスト＝hostToken／1対1のゲスト＝guestToken
  function _tokenOf(d, classicName) {
    const t = d.mode === 'multi' ? d.token : d[classicName];
    return typeof t === 'string' ? t : null;
  }

  // v1.05：いまの部屋の作りの控え（切断からの復帰で、同じ名前・同じパスワードの部屋を探す／作り直すのに使う）
  let _pendingCreate = null; // createRoom で送った中身（room_created で確定）
  let _pendingJoinPw = '';   // joinRoom で送ったパスワード（joined_room で確定）
  let _roomPw = '';
  let _roomPublic = true;
  let _roomRules = null;

  // ===== WebSocket 接続 =====
  function _connectWS() {
    _ws = new WebSocket(_options.signalingUrl);

    _ws.onopen = () => {
      // ロビーに入室（gameTypeを送信）
      _ws.send(JSON.stringify({
        type: 'enter_lobby',
        gameType: _options.gameType,
        alive: 1 // v1.04：「生きていますか」に答えられる版の印
      }));

      // keepalive（25秒間隔でping送信）
      if (_keepaliveTimer) clearInterval(_keepaliveTimer);
      _keepaliveTimer = setInterval(() => {
        if (_ws && _ws.readyState === WebSocket.OPEN) {
          _ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);

      if (_options.onWsOpen) _options.onWsOpen();
    };

    _ws.onmessage = e => {
      let d;
      try { d = JSON.parse(e.data); } catch { return; }
      _handleWS(d);
    };

    _ws.onclose = () => {
      if (_keepaliveTimer) { clearInterval(_keepaliveTimer); _keepaliveTimer = null; }

      if (_rv) {
        // v1.05：復帰を頼まれているあいだ
        if (_rv.op) {
          // 探している／作り直している途中で切れた → つなぎ直して続ける（探す・作り直すのはタイマーが続ける）
          if (_rv.probeTimer) { clearTimeout(_rv.probeTimer); _rv.probeTimer = null; }
          _rv.joining = null;
          _resetConnection();
        } else if (_currentRoomId) {
          // 対局中に自分の接続が切れた → 戻る側になる（アプリへは onSelfReconnecting）
          _rvSelfLost();
        } else {
          setTimeout(_connectWS, 1000);
        }
      } else if (_currentRoomId) {
        // 部屋に入っている最中の切断 → ゲーム側に通知
        if (_options.onDisconnected) {
          _options.onDisconnected('接続が切断されました。再接続中...');
        }
      } else {
        // ロビー画面での切断 → 3秒後に再接続
        setTimeout(_connectWS, 3000);
      }

      if (_options.onWsClose) _options.onWsClose();
    };

    _ws.onerror = () => {};
  }

  // ===== WebSocket メッセージハンドラ =====
  function _handleWS(d) {
    // v1.04：サーバーからの「生きていますか」に、アプリへ渡さずに自動で答える（回線の ping は中継が代わりに答えてしまうため、知らせで尋ねる）
    if (d.type === 'mm_alive_q') {
      if (_ws && _ws.readyState === WebSocket.OPEN) _ws.send(JSON.stringify({ type: 'mm_alive_a', n: d.n }));
      return;
    }

    // v1.05：復帰の知らせ（アプリへは渡さない）
    if (typeof d.type === 'string' && d.type.indexOf('mm_rv_') === 0) { _rvOnMsg(d); return; }

    // 部屋一覧
    if (d.type === 'room_list') {
      if (_rv && _rv.op && !_rv.joining && !_currentRoomId) _rvTryRooms(d.rooms);
      if (_options.onRoomList) _options.onRoomList(d.rooms);
      return;
    }

    // 部屋作成完了（自分がホスト）
    if (d.type === 'room_created') {
      _currentRoomId = d.roomId;
      _currentRoomName = d.roomName;
      _isHost = true;
      _token = _tokenOf(d, 'hostToken');
      const pc = _pendingCreate || {};
      _pendingCreate = null;
      _roomPw = pc.password || '';
      _roomPublic = pc.isPublic !== false;
      _roomRules = d.rules || pc.rules || null;
      if (_rv && _rv.op === 'recreate' && d.mode !== 'multi') {
        // v1.05：残ったゲストが同じ名前で作り直した部屋。アプリの画面は変えない（待っている画面のまま）
        _mode = 'classic';
        _initRTC(true);
        _rvRecreated();
        return;
      }
      if (d.mode === 'multi') {
        // 多人数：WebRTCは張らずWS中継で送受信。この時点で送受信可能。
        _mode = 'multi';
        _pid = d.yourPid || 'p0';
        _pRole = 'host';
        _roster = d.roster || [];
        _connected = true;
        if (_options.onRoomCreated) _options.onRoomCreated(d.roomId, d.roomName, d.rules, { mode: 'multi', pid: _pid, role: 'host', roster: _roster });
        if (_options.onConnected) _options.onConnected();
      } else {
        _mode = 'classic';
        _initRTC(true);
        if (_options.onRoomCreated) _options.onRoomCreated(d.roomId, d.roomName, d.rules);
      }
      return;
    }

    // 入室完了（自分がゲスト）
    if (d.type === 'joined_room') {
      _currentRoomId = d.roomId;
      _currentRoomName = d.roomName;
      _isHost = false;
      _token = _tokenOf(d, 'guestToken');
      _roomPw = _pendingJoinPw || '';
      _pendingJoinPw = '';
      _roomRules = d.rules || null;
      if (_rv && _rv.joining && d.mode !== 'multi') {
        // v1.05：戻る側（またはホストの部屋をのぞいた残ったゲスト）が入れた。本人だと確かめてもらう
        _mode = 'classic';
        _initRTC(false);
        _rvJoined();
        return;
      }
      if (d.mode === 'multi') {
        _mode = 'multi';
        _pid = d.yourPid || null;
        _pRole = d.role || 'player';
        _roster = d.roster || [];
        _connected = true;
        if (_options.onJoinedRoom) _options.onJoinedRoom(d.roomId, d.roomName, d.hostName, d.rules, { mode: 'multi', pid: _pid, role: _pRole, roster: _roster });
        if (_options.onConnected) _options.onConnected();
      } else {
        _mode = 'classic';
        _initRTC(false);
        if (_options.onJoinedRoom) _options.onJoinedRoom(d.roomId, d.roomName, d.hostName, d.rules);
      }
      return;
    }

    // ゲストが入室してきた（ホスト側に通知）
    if (d.type === 'guest_joined') {
      // v1.05：復帰を頼まれた対局中は、入ってきた人が戻ってきた相手かを合言葉で確かめる（アプリへは渡さない）
      if (_rv && _isHost) { _rvGuestJoined(); return; }
      if (_options.onGuestJoined) _options.onGuestJoined(d.guestName);
      return;
    }

    // ゲストが退出した（ホスト側に通知）
    if (d.type === 'guest_left') {
      if (_rv && _isHost) { _rvGuestLeft(); return; }
      if (_options.onGuestLeft) _options.onGuestLeft();
      return;
    }

    // 多人数：参加者が入った
    if (d.type === 'participant_joined') {
      _roster = d.roster || _roster;
      if (_options.onParticipantJoined) _options.onParticipantJoined(d.pid, d.role, d.name, _roster);
      return;
    }

    // 多人数：参加者が抜けた
    if (d.type === 'participant_left') {
      _roster = d.roster || _roster;
      if (_options.onParticipantLeft) _options.onParticipantLeft(d.pid, _roster);
      return;
    }

    // サーバーエラー（部屋が満員、パスワード不一致など）
    if (d.type === 'error') {
      // v1.05：探している途中の「満員」「パスワードが違う」などは自分で次を試す（アプリへは渡さない）
      if (_rv && _rv.op) { _rvJoinError(); return; }
      if (_options.onError) {
        _options.onError(d.message);
      } else {
        console.warn('[MomoMatchmaking] サーバーエラー:', d.message);
      }
      return;
    }

    // キックされた
    if (d.type === 'kicked') {
      if (_rv) { _rvKicked(); return; } // v1.05：相手に「いなくなった」と思われた → 戻る側になる
      _resetConnection();
      if (_options.onKicked) _options.onKicked();
      return;
    }

    // 部屋が閉じられた（ホスト切断など）
    if (d.type === 'room_closed') {
      const msg = d.reason || '接続が切断されました。';
      _resetConnection();
      if (_rv) { _rvRoomClosed(); return; } // v1.05：ホストがいなくなった → 残ったゲストが部屋を持つ
      if (_options.onDisconnected) _options.onDisconnected(msg);
      return;
    }

    // WebRTC シグナリング
    if (d.type === 'offer')  { _handleOffer(d);  return; }
    if (d.type === 'answer') { _handleAnswer(d); return; }
    if (d.type === 'ice')    { _handleIce(d);    return; }

    // DataChannel未確立時のWSシグナリング経由ゲームメッセージ中継
    if (_options.onMessage) {
      // モジュールが内部的に使うtypeを除いて、残りはゲーム側に素通し
      const internalTypes = [
        'room_list','room_created','joined_room','guest_joined','guest_left',
        'error','kicked','room_closed','offer','answer','ice','ping','pong',
        'enter_lobby','create_room','join_room','guest_leave','host_leave',
        'kick_guest','game_state_update','admin_clear_all'
      ];
      if (!internalTypes.includes(d.type)) {
        if (_rv) _rvHeard(); // v1.05：相手から何か届いた＝生きている
        _options.onMessage(d);
      }
    }
  }

  // ===== WebRTC 初期化 =====
  function _initRTC(host) {
    _pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    if (host) {
      _dc = _pc.createDataChannel('game');
      _bindDC();
    }

    _pc.ondatachannel = e => {
      _dc = e.channel;
      _bindDC();
    };

    _pc.onicecandidate = e => {
      if (e.candidate && _ws && _ws.readyState === WebSocket.OPEN) {
        _ws.send(JSON.stringify({ type: 'ice', candidate: e.candidate }));
      }
    };

    _pc.onconnectionstatechange = () => {
      if (!_pc) return;
      if (_pc.connectionState === 'failed' || _pc.connectionState === 'disconnected') {
        if (_rv) { _rvDropP2P(); return; } // v1.05：直結が切れても部屋は出ない（サーバー経由で続ける）
        const msg = '通信が切断されました。対局を中断します。';
        _resetConnection();
        if (_options.onDisconnected) _options.onDisconnected(msg);
      }
    };

    if (host) _startOffer();
  }

  // ===== DataChannel バインド =====
  function _bindDC() {
    _dc.onopen = () => {
      _connected = true;
      if (_options.onConnected) _options.onConnected();
    };

    _dc.onmessage = e => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      if (data && typeof data.type === 'string' && data.type.indexOf('mm_rv_') === 0) { _rvOnMsg(data); return; }
      if (_rv) _rvHeard();
      if (_options.onMessage) _options.onMessage(data);
    };

    _dc.onclose = () => {
      if (_rv) { _rvDropP2P(); return; } // v1.05
      if (_currentRoomId) {
        const msg = '通信が切断されました。対局を中断します。';
        _resetConnection();
        if (_options.onDisconnected) _options.onDisconnected(msg);
      }
    };
  }

  // ===== WebRTC オファー/アンサー/ICE =====
  async function _startOffer() {
    const offer = await _pc.createOffer();
    await _pc.setLocalDescription(offer);
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'offer', offer }));
    }
  }

  async function _handleOffer(d) {
    await _pc.setRemoteDescription(d.offer);
    const answer = await _pc.createAnswer();
    await _pc.setLocalDescription(answer);
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'answer', answer }));
    }
  }

  async function _handleAnswer(d) {
    await _pc.setRemoteDescription(d.answer);
  }

  async function _handleIce(d) {
    try { await _pc.addIceCandidate(d.candidate); } catch {}
  }

  // ===== 接続状態リセット（内部用）=====
  // 部屋状態・WebRTC接続だけをクリアする。WSは切断しない（自動再接続に任せる）。
  // v1.01: ただし、対戦中の切断起因でここに来たケースでは WS 自体が既に CLOSED
  //   になっていることがある。その場合は再接続を発火する。
  //   （元の _ws.onclose 内の再接続は _currentRoomId が null の時だけ走るので、
  //   onclose タイミングで _currentRoomId が残っていると WS が閉じたまま固まり
  //   再起動するまで新規部屋に入れなくなる）
  function _resetConnection() {
    _currentRoomId = null;
    _currentRoomName = '';
    _isHost = false;
    _connected = false;
    _mode = 'classic'; _pid = null; _pRole = null; _roster = [];
    if (_dc) { try { _dc.close(); } catch {} _dc = null; }
    if (_pc) { try { _pc.close(); } catch {} _pc = null; }
    if (!_ws || _ws.readyState === WebSocket.CLOSED || _ws.readyState === WebSocket.CLOSING) {
      setTimeout(_connectWS, 100);
    }
  }

  // ===== Renderスリープ抑止 =====
  function _startSleepGuard() {
    if (_sleepGuardTimer) return;
    _sleepGuardTimer = setInterval(() => {
      if (!document.hidden) {
        fetch(
          _options.signalingUrl.replace('wss://', 'https://').replace('ws://', 'http://'),
          { method: 'GET', mode: 'no-cors' }
        ).catch(() => {});
      }
    }, 5 * 60 * 1000); // 5分ごと（Render無料枠の15分スリープより短い）
  }

  // ===================================================
  // ===== v1.05：対局中の切断からの復帰（reviveBegin を呼んだアプリだけ） =====
  // ===================================================
  // _rv が null のあいだは何もしない（呼ばないアプリの動きは変わらない）。
  // phase: 'idle'（相手がいる）/ 'away'（相手がいなくなり、戻るのを待っている）
  // op: null / 'probe'（残ったゲストが元のホストの部屋をのぞく）/ 'recreate'（作り直す）/ 'rejoin'（自分が戻る）
  const RV_HERE_MS = 10000;               // 「ここにいます」を送る間隔
  const RV_CHECK_MS = 12000;              // これだけ届かなければ「確かめています」
  const RV_SILENT_MS = 25000;             // これだけ届かなければ「いなくなった」
  const RV_WAIT_MS = 3 * 60 * 1000;       // 戻るのを待つ長さ（大方針の 3 分）
  const RV_PROBE_MS = 8000;               // 部屋に入ってから本人確認の返事を待つ長さ
  const RV_PEEK_MS = 12000;               // 残ったゲストが元のホストの部屋をのぞく長さ
  const RV_SEARCH_MS = 60000;             // 戻る人が部屋を探す長さ
  const RV_KEEP_MS = 6 * 60 * 60 * 1000;  // 端末の控えを使える長さ
  let _rv = null;
  let _rvInitPending = null; // ゲストの reviveBegin より先に届いた mm_rv_init

  function _rvCall(name, ...args) {
    const f = _options[name];
    if (typeof f !== 'function') return;
    try { f(...args); } catch (e) { console.error('[MomoMatchmaking] ' + name, e); }
  }
  function _rvId() {
    const a = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }
  function _rvKey() { return 'momo-mm-revive.' + (_options.reviveKey || _options.gameType || 'app'); }
  function _rvSave() {
    if (!_rv || !_rv.info.s) return;
    try { localStorage.setItem(_rvKey(), JSON.stringify(Object.assign({}, _rv.info, { ts: Date.now() }))); } catch (e) {}
  }
  function _rvLoad() {
    try {
      const s = JSON.parse(localStorage.getItem(_rvKey()) || 'null');
      if (!s || !s.s || !s.g) return null;
      if (Date.now() - (s.ts || 0) > RV_KEEP_MS) { localStorage.removeItem(_rvKey()); return null; }
      return s;
    } catch (e) { return null; }
  }
  function _rvSend(msg) {
    if (_dc && _dc.readyState === 'open') { try { _dc.send(JSON.stringify(msg)); return; } catch (e) {} }
    if (_ws && _ws.readyState === WebSocket.OPEN) _ws.send(JSON.stringify(msg));
  }
  function _rvClearTimers() {
    if (!_rv) return;
    ['hereTimer', 'watchTimer'].forEach(k => { if (_rv[k]) clearInterval(_rv[k]); _rv[k] = null; });
    ['waitTimer', 'probeTimer', 'searchTimer', 'recreateTimer', 'peekTimer'].forEach(k => { if (_rv[k]) clearTimeout(_rv[k]); _rv[k] = null; });
  }
  function _rvDrop() {
    _rvClearTimers();
    _rv = null;
    _rvInitPending = null;
    try { localStorage.removeItem(_rvKey()); } catch (e) {}
  }
  function _rvNew(info) {
    _rv = { info: info || {}, phase: 'idle', op: null, heardAt: Date.now(), checking: false, joining: null, probing: false, tried: {} };
    _rv.hereTimer = setInterval(_rvHere, RV_HERE_MS);
    _rv.watchTimer = setInterval(_rvWatch, 1000);
  }
  function _rvApplyInit(d) {
    if (!_rv || typeof d.g !== 'string' || typeof d.s !== 'string') return;
    _rv.info.g = d.g;
    _rv.info.s = d.s;
    _rv.info.isPublic = d.p !== false;
    _rvSave();
  }

  // 10 秒ごと：相手がいるあいだ「ここにいます」（控えの時刻も更新）
  function _rvHere() {
    if (!_rv || _rv.phase !== 'idle' || _rv.op || !_currentRoomId) return;
    _rvSend({ type: 'mm_rv_here' });
    _rvSave();
  }
  // 1 秒ごと：相手から何も届かない時間を見る
  function _rvWatch() {
    if (!_rv || _rv.phase !== 'idle' || _rv.op || !_currentRoomId) return;
    const quiet = Date.now() - _rv.heardAt;
    if (quiet >= RV_SILENT_MS) { _rvPeerAway('silent'); return; }
    if (quiet >= RV_CHECK_MS && !_rv.checking) {
      _rv.checking = true;
      _rvCall('onPeerChecking', _rv.info.oppName || '');
    }
  }
  function _rvHeard() {
    if (!_rv) return;
    _rv.heardAt = Date.now();
    if (_rv.checking && _rv.phase === 'idle') {
      _rv.checking = false;
      _rvCall('onPeerAlive');
    }
  }

  // 直結の通り道が切れた：部屋は出ずにサーバー経由で続ける
  function _rvDropP2P() {
    if (_dc) { try { _dc.onclose = null; _dc.close(); } catch (e) {} _dc = null; }
    if (_pc) { try { _pc.onconnectionstatechange = null; _pc.close(); } catch (e) {} _pc = null; }
  }

  // 自分の席を残したまま、知らせを出さずに部屋を出る（アプリの画面は変えない）
  function _rvQuietLeave() {
    if (_currentRoomId && _ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: _isHost ? 'host_leave' : 'guest_leave' }));
    }
    _resetConnection();
  }

  // 相手がいなくなった（reason: 'silent'＝黙った / 'left'＝ゲストが外れた / 'closed'＝ホストの部屋が閉じた）
  function _rvPeerAway(reason) {
    if (!_rv || _rv.phase === 'away') return;
    _rv.phase = 'away';
    _rv.checking = false;
    const until = Date.now() + RV_WAIT_MS;
    if (_rv.waitTimer) clearTimeout(_rv.waitTimer);
    _rv.waitTimer = setTimeout(() => {
      _rv.waitTimer = null;
      if (_rv && _rv.phase === 'away') _rvCall('onPeerTimeout');
    }, RV_WAIT_MS);
    _rvCall('onPeerAway', _rv.info.oppName || '', until);
    if (_isHost && _currentRoomId) {
      // 残ったのはホスト：部屋はそのまま。居座った接続があれば外して席を空ける
      if (reason === 'silent') kickGuest();
      return;
    }
    if (reason === 'closed' || !_currentRoomId) { _rvRecreate(); return; }
    // 残ったのはゲスト：まず元のホストの部屋をのぞく（ホストが生きていればそこへ戻る＝元のホストの部屋を優先）
    _rvQuietLeave();
    _rvSearch('probe');
  }

  // ホスト：ゲストが外れた
  function _rvGuestLeft() {
    if (_rv.probing) { _rv.probing = false; if (_rv.probeTimer) { clearTimeout(_rv.probeTimer); _rv.probeTimer = null; } return; }
    _rvPeerAway('left');
  }
  // ホスト：誰かが入ってきた → 合言葉を待つ（来なければ外す）
  function _rvGuestJoined() {
    _rv.probing = true;
    if (_rv.probeTimer) clearTimeout(_rv.probeTimer);
    _rv.probeTimer = setTimeout(() => {
      _rv.probeTimer = null;
      if (_rv && _rv.probing) { _rv.probing = false; kickGuest(); }
    }, RV_PROBE_MS);
  }
  // ゲスト：ホストの部屋が閉じた
  function _rvRoomClosed() {
    if (_rv.op) { _rvJoinError(); return; } // のぞいている／戻ろうとしている部屋が閉じた → 次を試す
    _rvPeerAway('closed');
  }
  // 外された：相手に「いなくなった」と思われた → 戻る側になる
  function _rvKicked() {
    _resetConnection();
    if (_rv.op) { _rvJoinError(); return; }
    _rvSelfLost();
  }

  // 自分の接続が切れた → 戻る側になる
  function _rvSelfLost() {
    if (!_rv || _rv.op === 'rejoin') return;
    _rv.phase = 'idle';
    _rv.checking = false;
    if (_rv.waitTimer) { clearTimeout(_rv.waitTimer); _rv.waitTimer = null; }
    _rvCall('onSelfReconnecting');
    _resetConnection(); // WS が閉じていればつなぎ直す
    _rvSearch('rejoin');
  }

  // 一覧から「同じ部屋名で、ホストが相手」の部屋を探して入る
  function _rvSearch(op) {
    _rv.op = op;
    _rv.joining = null;
    _rv.tried = {};
    _rv.searchUntil = Date.now() + (op === 'probe' ? RV_PEEK_MS : RV_SEARCH_MS);
    _rvSearchStep();
  }
  function _rvSearchStep() {
    if (!_rv || (_rv.op !== 'probe' && _rv.op !== 'rejoin')) return;
    if (_rv.searchTimer) { clearTimeout(_rv.searchTimer); _rv.searchTimer = null; }
    if (_rv.joining) return;
    if (Date.now() > _rv.searchUntil) { _rvSearchFailed(); return; }
    if (_ws && _ws.readyState === WebSocket.OPEN && !_currentRoomId) refreshRooms();
    _rv.searchTimer = setTimeout(_rvSearchStep, 3000);
  }
  function _rvTryRooms(rooms) {
    if (_rv.op !== 'probe' && _rv.op !== 'rejoin') return;
    const inf = _rv.info;
    const list = (rooms || []).filter(r => r && r.name === inf.roomName && r.hostName === inf.oppName && !r.guestConnected && (_rv.tried[r.id] || 0) < 9);
    for (const r of list) {
      // パスワード：元の部屋＝元のパスワード、作り直した部屋＝合言葉。どちらの部屋か分からないので順に試す
      const pws = r.hasPassword ? [inf.s, inf.pw].filter((p, i, a) => p && a.indexOf(p) === i) : [''];
      const n = _rv.tried[r.id] || 0;
      if (n >= pws.length) { _rv.tried[r.id] = 9; continue; }
      _rv.tried[r.id] = n + 1;
      _rv.joining = { roomId: r.id };
      _pendingJoinPw = pws[n];
      _ws.send(JSON.stringify({ type: 'join_room', roomId: r.id, password: pws[n], guestName: inf.myName || 'ゲスト' }));
      return;
    }
  }
  // 入れなかった（満員・パスワード違い・部屋が閉じた・返事が来ない）→ 少し置いて次を試す
  function _rvJoinError() {
    if (!_rv) return;
    if (_rv.op === 'recreate') { // 作り直しに失敗 → やり直す
      if (_rv.recreateTimer) clearTimeout(_rv.recreateTimer);
      _rv.recreateTimer = setTimeout(_rvRecreateStep, 2000);
      return;
    }
    if (_rv.probeTimer) { clearTimeout(_rv.probeTimer); _rv.probeTimer = null; }
    _rv.joining = null;
    if (_rv.searchTimer) clearTimeout(_rv.searchTimer);
    _rv.searchTimer = setTimeout(_rvSearchStep, 500);
  }
  // 入れた → 合言葉を送り、ホストの「おかえり」を待つ
  function _rvJoined() {
    _rvSend({ type: 'mm_rv_back', g: _rv.info.g, s: _rv.info.s });
    if (_rv.probeTimer) clearTimeout(_rv.probeTimer);
    _rv.probeTimer = setTimeout(() => {
      _rv.probeTimer = null;
      if (!_rv || !_rv.joining) return;
      if (_rv.joining.roomId) _rv.tried[_rv.joining.roomId] = 9; // この部屋は答えない（居座った接続など）
      _rvQuietLeave();
      _rvJoinError();
    }, RV_PROBE_MS);
  }
  function _rvSearchFailed() {
    const op = _rv.op;
    _rv.op = null;
    _rv.joining = null;
    if (op === 'probe') { _rvRecreate(); return; }
    _rvDrop();
    _rvCall('onReviveFailed');
  }
  // 戻れた（戻る側・のぞいた残ったゲスト）
  function _rvRevived() {
    _rvClearTimers();
    _rv.op = null;
    _rv.joining = null;
    _rv.phase = 'idle';
    _rv.checking = false;
    _rv.heardAt = Date.now();
    _rv.info.pw = _roomPw;
    _rv.hereTimer = setInterval(_rvHere, RV_HERE_MS);
    _rv.watchTimer = setInterval(_rvWatch, 1000);
    _rvSave();
    _rvCall('onRevived');
  }

  // 残ったゲスト：同じ名前・合言葉のパスワードで部屋を作り直してホストになる（戻るのを待つのは続ける）
  function _rvRecreate() {
    _rv.op = 'recreate';
    _rvRecreateStep();
  }
  function _rvRecreateStep() {
    if (!_rv || _rv.op !== 'recreate') return;
    if (_rv.recreateTimer) { clearTimeout(_rv.recreateTimer); _rv.recreateTimer = null; }
    if (!_ws || _ws.readyState !== WebSocket.OPEN || _currentRoomId) { _rv.recreateTimer = setTimeout(_rvRecreateStep, 500); return; }
    const inf = _rv.info;
    _pendingCreate = { password: inf.s, isPublic: inf.isPublic !== false, rules: inf.rules };
    _ws.send(JSON.stringify({
      type: 'create_room', gameType: inf.gameType || _options.gameType,
      hostName: inf.myName || 'ホスト', name: inf.roomName, password: inf.s,
      isPublic: inf.isPublic !== false, rules: inf.rules
    }));
  }
  function _rvRecreated() {
    _rv.op = null;
    _rv.info.pw = _roomPw;
    _rvSave();
  }

  // 復帰の知らせ（mm_rv_*）
  function _rvOnMsg(d) {
    if (d.type === 'mm_rv_init') { // ホスト → ゲスト：対局の番号と合言葉
      if (_rv) _rvApplyInit(d); else _rvInitPending = d;
      return;
    }
    if (!_rv) return;
    if (d.type === 'mm_rv_here') { _rvHeard(); return; }
    if (d.type === 'mm_rv_bye') { _rvDrop(); return; } // 相手が自分で出た＝待たない（このあとの知らせは今までどおりアプリへ）
    if (d.type === 'mm_rv_back') { // ホスト：入ってきた人の合言葉
      if (!_isHost) return;
      _rv.probing = false;
      if (_rv.probeTimer) { clearTimeout(_rv.probeTimer); _rv.probeTimer = null; }
      if (d.g !== _rv.info.g || d.s !== _rv.info.s) { _rvSend({ type: 'mm_rv_ng' }); kickGuest(); return; }
      _rvSend({ type: 'mm_rv_ok' });
      if (_rv.waitTimer) { clearTimeout(_rv.waitTimer); _rv.waitTimer = null; }
      _rv.phase = 'idle';
      _rv.checking = false;
      _rv.heardAt = Date.now();
      _rvSave();
      _rvCall('onPeerBack', _rv.info.oppName || '');
      return;
    }
    if (d.type === 'mm_rv_ok') { if (_rv.joining) _rvRevived(); return; }
    if (d.type === 'mm_rv_ng') {
      if (_rv.joining) { if (_rv.joining.roomId) _rv.tried[_rv.joining.roomId] = 9; _rvQuietLeave(); _rvJoinError(); }
      return;
    }
  }

  // ===================================================
  // ===== 公開API =====
  // ===================================================

  /**
   * モジュールを初期化する。ページ読み込み後に1回だけ呼ぶ。
   * @param {object} options
   */
  function init(options) {
    _options = options || {};
    _connectWS();
    _startSleepGuard();
  }

  /**
   * 部屋を作成する。成功すると onRoomCreated が呼ばれる。
   * @param {object} options - { hostName, name, password, isPublic, rules }
   *   rules はゲーム固有のルール設定オブジェクト（任意）。
   *   サーバーは中身を保持・配信するのみで解釈はしない。
   */
  function createRoom(options) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    const msg = {
      type: 'create_room',
      gameType: _options.gameType,
      hostName: options.hostName || 'ホスト',
      name: options.name || '名無しの部屋',
      password: options.password || '',
      isPublic: options.isPublic !== false,
      rules: options.rules
    };
    _pendingCreate = { password: msg.password, isPublic: msg.isPublic, rules: msg.rules };
    // 多人数モード（指定時のみ）。未指定なら従来1対1。
    if (options.mode === 'multi') {
      msg.mode = 'multi';
      msg.maxPlayers = options.maxPlayers || 2;
      msg.maxSpectators = options.maxSpectators || 0;
    }
    _ws.send(JSON.stringify(msg));
  }

  /**
   * 部屋に入室する。成功すると onJoinedRoom が呼ばれる。
   * @param {string} roomId
   * @param {string} password
   * @param {string} guestName
   */
  function joinRoom(roomId, password, guestName, role) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    const msg = {
      type: 'join_room',
      roomId,
      password: password || '',
      guestName: guestName || 'ゲスト'
    };
    if (role) msg.role = role; // 多人数：'player' | 'spectator'
    _pendingJoinPw = msg.password;
    _ws.send(JSON.stringify(msg));
  }

  /**
   * 接続中の相手にデータを送信する。onConnected 後に使用可能。
   * DataChannel確立済みならP2P送信、未確立ならWS経由でフォールバック。
   * @param {object} data
   */
  function send(data, to) {
    if (_mode === 'multi') { _sendMulti(data, to); return; }
    if (_dc && _dc.readyState === 'open') {
      _dc.send(JSON.stringify(data));
    } else if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify(data));
    }
  }

  // 多人数の送信はこの1関数に集約（将来、直結の速い経路へ差し替え可能な"出入口"）。
  // 宛先 to は 'all'（既定・自分以外の全員） / 'host' / 参加者ID(pid)。
  function _sendMulti(data, to) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    const msg = Object.assign({}, data, { to: to || 'all' });
    _ws.send(JSON.stringify(msg));
  }

  /**
   * 部屋から退出する。ホストの場合は部屋ごと閉鎖。
   * コールバック（onDisconnected 等）は呼ばれない（ゲーム側で制御する）。
   */
  function leaveRoom() {
    // v1.05：自分で出る＝相手に「待たなくてよい」と伝えて、復帰の控えを消す
    if (_rv) {
      if (_currentRoomId) _rvSend({ type: 'mm_rv_bye' });
      _rvDrop();
    }
    if (_currentRoomId && _ws && _ws.readyState === WebSocket.OPEN) {
      if (_mode === 'multi') {
        _ws.send(JSON.stringify({ type: 'leave' }));
      } else if (_isHost) {
        _ws.send(JSON.stringify({ type: 'host_leave' }));
      } else {
        _ws.send(JSON.stringify({ type: 'guest_leave' }));
      }
    }
    _resetConnection();
  }

  /**
   * 部屋一覧を再取得する。onRoomList が呼ばれる。
   */
  function refreshRooms() {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ws.send(JSON.stringify({
      type: 'enter_lobby',
      gameType: _options.gameType,
      alive: 1
    }));
  }

  /**
   * ゲストをキックする（ホストのみ有効）。
   */
  function kickGuest() {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ws.send(JSON.stringify({ type: 'kick_guest' }));
  }

  /**
   * 現在の接続状態を返す。
   * @returns {{ isHost: boolean, connected: boolean, currentRoomId: string|null, currentRoomName: string }}
   */
  function getState() {
    return {
      isHost: _isHost,
      connected: _connected,
      currentRoomId: _currentRoomId,
      currentRoomName: _currentRoomName,
      mode: _mode,
      pid: _pid,
      role: _pRole,
      roster: _roster
    };
  }

  /**
   * 接続を維持したまま gameType を変更する（タブ切替などで利用）。
   * 内部状態の gameType を更新し、サーバーに enter_lobby を再送信して
   * 部屋一覧の対象ゲームを切り替える。reversi は呼び出さないため影響なし。
   * @param {string} gameType - 新しい gameType ('gomoku' | 'go' など)
   */
  function changeGameType(gameType) {
    _options.gameType = gameType;
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({
        type: 'enter_lobby',
        gameType: gameType,
        alive: 1
      }));
    }
  }

  /**
   * v1.03：いまの部屋の合言葉（切れたあとに同じ席へ戻るためにサーバーが渡すもの）。部屋にいなければ null。
   * 戻るときに使うので、アプリは部屋に入った直後に控えておく。診断の記録・チャット・URL などには出さないこと。
   * @returns {string|null}
   */
  function getToken() {
    return _currentRoomId ? _token : null;
  }

  /**
   * v1.05：この部屋の対局を「切れても戻れる」ようにする（従来1対1の部屋だけ）。対局を始めるたびに両方の端末で呼ぶ。
   * 呼んだあとは、相手が切れても onDisconnected / onGuestLeft / onKicked は呼ばれず、代わりに次が呼ばれる。
   *   onPeerChecking(name)      相手から 12 秒何も届かない（「確かめています」）
   *   onPeerAlive()             また届いた
   *   onPeerAway(name, until)   相手がいなくなった（until＝3 分後の時刻）。部屋はこの端末が持つ
   *   onPeerTimeout()           3 分たった（戻るのを待つのは続ける）
   *   onPeerBack(name)          相手が戻ってきて本人と確かめた（盤面を渡すのはアプリ）
   *   onSelfReconnecting()      自分の接続が切れた。部屋を探して戻ろうとしている
   *   onRevived()               戻れた（盤面は相手から受け取る）
   *   onReviveFailed()          戻れなかった（部屋が見つからない＝対局はもう終わっている）
   * 自分で部屋を出る（leaveRoom）か reviveEnd を呼ぶまで続く。
   * @param {{myName:string, oppName:string}} opt
   * @returns {boolean} 始められたか
   */
  function reviveBegin(opt) {
    if (!_currentRoomId || _mode !== 'classic') return false;
    const o = opt || {};
    // 前の対局の控え・探している途中のこと（別の部屋）は捨てる。同じ部屋の次の対局は番号と合言葉を続けて使う
    if (_rv && (_rv.op || _rv.info.roomName !== _currentRoomName)) _rvDrop();
    if (!_rv) _rvNew({});
    const inf = _rv.info;
    inf.roomName = _currentRoomName;
    inf.myName = o.myName || inf.myName || '';
    inf.oppName = o.oppName || inf.oppName || '';
    inf.gameType = _options.gameType;
    inf.pw = _roomPw;
    inf.rules = _roomRules;
    if (_isHost) {
      if (!inf.g) { inf.g = _rvId(); inf.s = _rvId() + _rvId(); inf.isPublic = _roomPublic; }
      _rvSend({ type: 'mm_rv_init', g: inf.g, s: inf.s, p: inf.isPublic !== false });
    } else if (_rvInitPending) {
      _rvApplyInit(_rvInitPending);
      _rvInitPending = null;
    }
    _rv.heardAt = Date.now();
    _rvSave();
    return true;
  }

  /** v1.05：「切れても戻れる」をやめる（対局を終えて部屋を出るとき・相手が自分で出たとき）。端末の控えも消す。 */
  function reviveEnd() { _rvDrop(); }

  /**
   * v1.05：開き直したときに戻れる対局の控え（無ければ null）。合言葉は返さない。
   * @returns {{roomName:string, oppName:string, myName:string, gameType:string, ts:number}|null}
   */
  function reviveSaved() {
    const s = _rvLoad();
    return s ? { roomName: s.roomName, oppName: s.oppName, myName: s.myName, gameType: s.gameType, ts: s.ts } : null;
  }

  /** v1.05：控えの対局へ戻りにいく（開き直したとき）。結果は onRevived / onReviveFailed。 */
  function reviveResume() {
    const s = _rvLoad();
    if (!s) { _rvCall('onReviveFailed'); return false; }
    if (s.gameType && s.gameType !== _options.gameType) changeGameType(s.gameType);
    _rvDrop();
    _rvNew(s);
    _rvSearch('rejoin');
    return true;
  }

  // 公開API
  return { init, createRoom, joinRoom, send, leaveRoom, refreshRooms, kickGuest, getState, changeGameType, getToken,
    reviveBegin, reviveEnd, reviveSaved, reviveResume };

})();

// ES module / bundler consumer (Vite 等) 用: window にも露出する。
// 従来の <script src> 直接読込 (Reversi/Go/Darts/Control 等) では local const がスコープ内なので
// この行は補助情報として扱われ、既存動作を一切変更しない。
if (typeof window !== 'undefined') {
  window.MomoMatchmaking = MomoMatchmaking;
}
