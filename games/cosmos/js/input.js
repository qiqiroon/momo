/*
 * MOMO Cosmos — 落下操作（仕様書 第6.1節）
 * タッチ：タップで即落下／0.25秒以上の長押し、または10px超の移動で照準モード→離して落下
 *         照準モード中に盤面の外で離すと取り消し
 *         指を離さずに 0.6 秒たつと、指の位置で続けて落とす（離しても追加では落とさない）
 * マウス：移動で照準が追従、クリックでその位置に落下。押したまま 0.6 秒で続けて落とす
 * キー  ：← → で照準移動、Space で落下（押したまま 0.6 秒で続けて落とす）、Esc で一時停止・再開
 * 続けて落とす間隔は連打防止（dropCooldownMs）と同じ。2026-10-31 作者の指示
 */
(function (root) {
  'use strict';

  class CosmosInput {
    constructor(canvas, game, renderer, C, hooks) {
      this.cv = canvas; this.g = game; this.r = renderer; this.C = C;
      this.hooks = hooks || {};
      this.touch = null;   // 進行中のタッチ
      this.keys = { left: false, right: false };
      this.held = null;    // 押したまま（マウス・Space）：{ t0 }。タッチは this.touch.t0
      this.enabled = () => true; // main.js が「設定パネルを開いている間は false」に差し替える
      this._bind();
    }

    toBoardX(clientX) {
      const rect = this.cv.getBoundingClientRect();
      return (clientX - rect.left) / rect.width * this.C.board.width;
    }

    toBoardY(clientY) {
      const rect = this.cv.getBoundingClientRect();
      return (clientY - rect.top) / rect.height * this.C.board.height;
    }

    insideBoard(clientX, clientY) {
      const rect = this.cv.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }

    _playable() { return this.g.controllable && this.enabled(); }

    _bind() {
      const cv = this.cv, I = this.C.input;

      cv.addEventListener('pointerdown', e => {
        if (!this._playable()) return;
        e.preventDefault();
        const x = this.toBoardX(e.clientX);
        // ミサイルを選んでいる間は、落とさずに、触れた天体を壊す（天体のない所なら何もしない）
        if (this.g.missileArmed) {
          if (e.button === 0 || e.pointerType !== 'mouse') this.g.fireMissile(x, this.toBoardY(e.clientY));
          return;
        }
        if (e.pointerType === 'mouse') {
          if (e.button !== 0) return;
          this.g.setAim(x);
          this.r.aimVisible = true;
          this.g.drop(x);
          this.held = { t0: performance.now() };
          return;
        }
        try { cv.setPointerCapture(e.pointerId); } catch (_) { /* 古い環境 */ }
        const t = { id: e.pointerId, x0: e.clientX, y0: e.clientY, aiming: false, timer: 0, t0: performance.now(), repeated: false };
        t.timer = setTimeout(() => {
          if (this.touch === t) { t.aiming = true; this.g.setAim(this.toBoardX(t.lastX != null ? t.lastX : t.x0)); this.r.aimVisible = true; }
        }, I.tapMaxMs);
        this.touch = t;
      }, { passive: false });

      cv.addEventListener('pointermove', e => {
        // ミサイルの狙い：マウスの下の天体を render.js が赤い輪で示す
        this.r.pointer = this.insideBoard(e.clientX, e.clientY) ? { x: this.toBoardX(e.clientX), y: this.toBoardY(e.clientY) } : null;
        if (e.pointerType === 'mouse') {
          if (!this._playable()) return;
          this.g.setAim(this.toBoardX(e.clientX));
          this.r.aimVisible = true;
          return;
        }
        const t = this.touch;
        if (!t || t.id !== e.pointerId) return;
        t.lastX = e.clientX;
        if (!t.aiming && Math.hypot(e.clientX - t.x0, e.clientY - t.y0) > I.tapMaxMovePx) {
          t.aiming = true; this.r.aimVisible = true;
        }
        if (t.aiming && this._playable()) this.g.setAim(this.toBoardX(e.clientX));
      });

      const end = (e, cancelled) => {
        const t = this.touch;
        if (!t || t.id !== e.pointerId) return;
        clearTimeout(t.timer);
        this.touch = null;
        this.r.aimVisible = false;
        if (cancelled || !this._playable() || t.repeated) return;
        if (t.aiming) {
          if (this.insideBoard(e.clientX, e.clientY)) this.g.drop(this.toBoardX(e.clientX));
          // 盤面の外で離した：取り消し
        } else {
          this.g.drop(this.toBoardX(e.clientX)); // タップ
        }
      };
      cv.addEventListener('pointerup', e => end(e, false));
      cv.addEventListener('pointercancel', e => end(e, true));
      cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { this.r.aimVisible = false; this.r.pointer = null; this.held = null; } });
      root.addEventListener('pointerup', e => { if (e.pointerType === 'mouse') this.held = null; });
      cv.addEventListener('contextmenu', e => e.preventDefault());

      root.addEventListener('keydown', e => {
        if (e.target && /INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName) && e.key === ' ') return;
        if (e.key === 'Escape') { this.hooks.togglePause && this.hooks.togglePause(); return; }
        if (!this._playable()) return;
        if (e.key === 'ArrowLeft') { this.keys.left = true; this.r.aimVisible = true; e.preventDefault(); }
        else if (e.key === 'ArrowRight') { this.keys.right = true; this.r.aimVisible = true; e.preventDefault(); }
        else if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault();
          if (!e.repeat && !this.g.missileArmed) { this.r.aimVisible = true; this.g.drop(); this.held = { t0: performance.now() }; }
        }
      });
      root.addEventListener('keyup', e => {
        if (e.key === 'ArrowLeft') this.keys.left = false;
        if (e.key === 'ArrowRight') this.keys.right = false;
        if (e.key === ' ' || e.code === 'Space') this.held = null;
      });
      root.addEventListener('blur', () => { this.keys.left = this.keys.right = false; this.held = null; });
    }

    /** 毎フレーム：キーでの照準移動と、押したままで続けて落とす */
    update(dt) {
      if (!this._playable()) return;
      const d = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
      if (d) this.g.setAim(this.g.aimX + d * this.C.input.keyAimSpeed * dt);
      if (this.g.missileArmed) return;
      const now = performance.now(), wait = this.C.input.holdRepeatMs;
      if (this.held && now - this.held.t0 >= wait) this.g.drop();
      const t = this.touch;
      if (t && now - t.t0 >= wait) {
        const cx = t.lastX != null ? t.lastX : t.x0;
        t.aiming = true; this.r.aimVisible = true;
        if (this.g.drop(this.toBoardX(cx))) t.repeated = true;
      }
    }
  }

  root.CosmosInput = CosmosInput;
})(window);
