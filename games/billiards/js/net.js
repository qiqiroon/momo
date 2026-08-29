/**
 * MOMO Billiards — 通信対戦・観戦
 * 仕様書 momo_billiards_spec.md 第9章9.5節／MOMO 共通トランスポート games/matchmaking/
 *
 * 同期の方式（9.5.2節）
 *   進行の骨格は入力列である。送るのは「1ゲームの乱数シード」と「各ショットの入力5値」、
 *   それに進行イベント（タイムアウト・離脱・やり直し・設定変更）。
 *   各端末は決定論の物理で同じ盤面を独立に再現する。
 *   **そのうえで、1ショットごとに撞いた端末が撞き終わった時点の結果を配る。**
 *   受け取った側は自分の玉が止まってからそれへ合わせる。玉の見え方は端末ごとに違ってよいが、
 *   撞き終わった時点の盤面・手番・得点・勝敗は必ず一致させる。
 *   入力列だけでは、ずれた端末が同じ入力から同じずれを作り直すため復旧できない。
 *   玉の位置を毎フレーム送る全状態同期は採らない（配るのは1ショットにつき1回だけ）。
 *   観戦者も同じ入力列と結果を受け取り、最初から再生して現在の局面へ追いつく（9.5.8節）。
 *
 * 版番号の照合（9.5.4節）
 *   接続時に双方の版番号を照らし合わせ、一致しなければ接続しない。
 *   ホストは部屋の rules に版番号を載せる。ゲストは入る前に見て、違えば入室しない。
 *
 * 名前の取り決め
 *   共通トランスポートは type/to/roomId などを自分用に予約している。
 *   本アプリの伝言はすべて { type:'bl', p:{...} } の1種類に包んで送る。
 *   包まずに送ると、途中で黙って解釈・上書きされる経路ができてしまう。
 */
const BilliardsNet = (() => {
  'use strict';

  const SIGNALING_URL = 'wss://momo-server-reversi.onrender.com';
  const GAME_TYPE = 'billiards';

  let handler = null;
  let myVersion = '0.00';
  let started = false;
  let roomVersions = {};   // roomId → 版番号（一覧から拾っておき、入る前に照合する）

  function emit(kind, data) { if (handler) handler(kind, data || {}); }

  function init(opts) {
    handler = opts.onEvent;
    myVersion = opts.version;
    if (started) return;
    started = true;
    MomoMatchmaking.init({
      signalingUrl: SIGNALING_URL,
      gameType: GAME_TYPE,

      onWsOpen: () => emit('ws-open'),
      onWsClose: () => emit('ws-close'),

      onRoomList: rooms => {
        roomVersions = {};
        (rooms || []).forEach(r => {
          const v = r.rules && r.rules.ver;
          if (v) roomVersions[r.id] = v;
        });
        emit('rooms', { rooms: rooms || [] });
      },

      onRoomCreated: (roomId, roomName, rules, multi) =>
        emit('created', { roomId, roomName, rules, multi: multi || null }),

      onJoinedRoom: (roomId, roomName, hostName, rules, multi) => {
        const theirs = rules && rules.ver;
        if (theirs && theirs !== myVersion) {
          // 版が違う対局には入らない（9.5.4節）。入ってしまうと盤面が食い違う
          emit('ver-mismatch', { theirs, mine: myVersion });
          try { MomoMatchmaking.leaveRoom(); } catch (e) {}
          return;
        }
        emit('joined', { roomId, roomName, hostName, rules, multi: multi || null });
      },

      onGuestJoined: name => emit('participant', { name, joined: true }),
      onGuestLeft: () => emit('participant-left', {}),
      onParticipantJoined: (pid, role, name, roster) => emit('participant', { pid, role, name, roster, joined: true }),
      onParticipantLeft: (pid, roster) => emit('participant-left', { pid, roster }),

      onConnected: () => emit('connected'),
      onDisconnected: msg => emit('disconnected', { msg }),
      onKicked: () => emit('kicked'),
      onError: msg => emit('error', { msg }),

      onMessage: d => {
        if (!d || d.type !== 'bl' || !d.p) return;
        emit('msg', { payload: d.p, from: d.from || null });
      },
    });
  }

  /**
   * 部屋を作る。多人数モードで開くので観戦者を受け入れられる。
   * @param {object} o { hostName, roomName, password, isPublic, maxPlayers, config }
   */
  function createRoom(o) {
    MomoMatchmaking.createRoom({
      hostName: o.hostName,
      name: o.roomName,
      password: o.password || '',
      isPublic: o.isPublic !== false,
      rules: { ver: myVersion, config: o.config, hasPassword: (o.password || '').length > 0 },
      mode: 'multi',
      maxPlayers: o.maxPlayers || 2,
      maxSpectators: 8,
    });
  }

  /** 入室。role は 'player' か 'spectator'（観戦）。入る前に版番号を照らす。 */
  function joinRoom(roomId, password, name, role) {
    const theirs = roomVersions[roomId];
    if (theirs && theirs !== myVersion) {
      emit('ver-mismatch', { theirs, mine: myVersion });
      return false;
    }
    MomoMatchmaking.joinRoom(roomId, password || '', name || 'ゲスト', role || 'player');
    return true;
  }

  /** 伝言はすべて包んで送る。to は 'all' / 'host' / 参加者ID。 */
  function send(payload, to) {
    MomoMatchmaking.send({ type: 'bl', p: payload }, to);
  }

  function leave() { try { MomoMatchmaking.leaveRoom(); } catch (e) {} }
  function refresh() { try { MomoMatchmaking.refreshRooms(); } catch (e) {} }
  function state() { try { return MomoMatchmaking.getState(); } catch (e) { return {}; } }
  function roomVersionOf(roomId) { return roomVersions[roomId] || null; }

  return { init, createRoom, joinRoom, send, leave, refresh, state, roomVersionOf, SIGNALING_URL, GAME_TYPE };
})();

if (typeof window !== 'undefined') window.BilliardsNet = BilliardsNet;
