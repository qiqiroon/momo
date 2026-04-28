/**
 * momo-matchmaking.js  v1.00
 * MOMO Works 共通マッチング・通信モジュール
 * WebSocket（シグナリング）と WebRTC（P2P通信）を内包する。
 * ゲーム側は MomoMatchmaking.init() でコールバックを登録するだけで対戦相手との通信を確立できる。
 *
 * 対応ゲーム: MOMO Reversi v2.06 以降、その他 MOMO Works ブラウザゲーム
 * GitHub Pages: qiqiroon.github.io/momo/
 * Terms of Use: https://qiqiroon.github.io/momo/terms.html
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

  // ===== WebSocket 接続 =====
  function _connectWS() {
    _ws = new WebSocket(_options.signalingUrl);

    _ws.onopen = () => {
      // ロビーに入室（gameTypeを送信）
      _ws.send(JSON.stringify({
        type: 'enter_lobby',
        gameType: _options.gameType
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

      if (_currentRoomId) {
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
    // 部屋一覧
    if (d.type === 'room_list') {
      if (_options.onRoomList) _options.onRoomList(d.rooms);
      return;
    }

    // 部屋作成完了（自分がホスト）
    if (d.type === 'room_created') {
      _currentRoomId = d.roomId;
      _currentRoomName = d.roomName;
      _isHost = true;
      _initRTC(true);
      if (_options.onRoomCreated) _options.onRoomCreated(d.roomId, d.roomName, d.rules);
      return;
    }

    // 入室完了（自分がゲスト）
    if (d.type === 'joined_room') {
      _currentRoomId = d.roomId;
      _currentRoomName = d.roomName;
      _isHost = false;
      _initRTC(false);
      if (_options.onJoinedRoom) _options.onJoinedRoom(d.roomId, d.roomName, d.hostName, d.rules);
      return;
    }

    // ゲストが入室してきた（ホスト側に通知）
    if (d.type === 'guest_joined') {
      if (_options.onGuestJoined) _options.onGuestJoined(d.guestName);
      return;
    }

    // ゲストが退出した（ホスト側に通知）
    if (d.type === 'guest_left') {
      if (_options.onGuestLeft) _options.onGuestLeft();
      return;
    }

    // サーバーエラー（部屋が満員、パスワード不一致など）
    if (d.type === 'error') {
      if (_options.onError) {
        _options.onError(d.message);
      } else {
        console.warn('[MomoMatchmaking] サーバーエラー:', d.message);
      }
      return;
    }

    // キックされた
    if (d.type === 'kicked') {
      _resetConnection();
      if (_options.onKicked) _options.onKicked();
      return;
    }

    // 部屋が閉じられた（ホスト切断など）
    if (d.type === 'room_closed') {
      const msg = d.reason || '接続が切断されました。';
      _resetConnection();
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
      if (_pc.connectionState === 'failed' || _pc.connectionState === 'disconnected') {
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
      if (_options.onMessage) _options.onMessage(data);
    };

    _dc.onclose = () => {
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
  function _resetConnection() {
    _currentRoomId = null;
    _currentRoomName = '';
    _isHost = false;
    _connected = false;
    if (_dc) { try { _dc.close(); } catch {} _dc = null; }
    if (_pc) { try { _pc.close(); } catch {} _pc = null; }
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
    _ws.send(JSON.stringify({
      type: 'create_room',
      gameType: _options.gameType,
      hostName: options.hostName || 'ホスト',
      name: options.name || '名無しの部屋',
      password: options.password || '',
      isPublic: options.isPublic !== false,
      rules: options.rules
    }));
  }

  /**
   * 部屋に入室する。成功すると onJoinedRoom が呼ばれる。
   * @param {string} roomId
   * @param {string} password
   * @param {string} guestName
   */
  function joinRoom(roomId, password, guestName) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ws.send(JSON.stringify({
      type: 'join_room',
      roomId,
      password: password || '',
      guestName: guestName || 'ゲスト'
    }));
  }

  /**
   * 接続中の相手にデータを送信する。onConnected 後に使用可能。
   * DataChannel確立済みならP2P送信、未確立ならWS経由でフォールバック。
   * @param {object} data
   */
  function send(data) {
    if (_dc && _dc.readyState === 'open') {
      _dc.send(JSON.stringify(data));
    } else if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify(data));
    }
  }

  /**
   * 部屋から退出する。ホストの場合は部屋ごと閉鎖。
   * コールバック（onDisconnected 等）は呼ばれない（ゲーム側で制御する）。
   */
  function leaveRoom() {
    if (_currentRoomId && _ws && _ws.readyState === WebSocket.OPEN) {
      if (_isHost) {
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
      gameType: _options.gameType
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
      currentRoomName: _currentRoomName
    };
  }

  // 公開API
  return { init, createRoom, joinRoom, send, leaveRoom, refreshRooms, kickGuest, getState };

})();
