// Terms of Use: https://qiqiroon.github.io/momo/terms.html
// momo_disk_bridge.js  v1.00
// MOMO Project - ローカルディスクアクセス JavaScript ブリッジ
// 役割: File System Access API を window.MomoDiskBridge として公開し、
//       Pyodide（Python側）から js モジュール経由で呼び出せるようにする。
// 配置パス: momo/lib/momo_disk/momo_disk_bridge.js
// 対応ブラウザ: Chrome / Edge 86以上（File System Access API 必須）

"use strict";

(function () {

  // ── IndexedDB キー定数 ────────────────────────────────────────────────
  const IDB_NAME    = "MomoDiskBridge";
  const IDB_VERSION = 1;
  const IDB_STORE   = "handles";
  const IDB_KEY     = "rootHandle";

  // ── IndexedDB ヘルパー ────────────────────────────────────────────────

  /** IndexedDB を開いて IDBDatabase を返す Promise */
  function openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = (e) => {
        e.target.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  /** IndexedDB からハンドルを読み込む。なければ null を返す */
  async function idbLoad() {
    try {
      const db = await openIDB();
      return await new Promise((resolve, reject) => {
        const tx  = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = (e) => resolve(e.target.result ?? null);
        req.onerror   = (e) => reject(e.target.error);
      });
    } catch {
      return null;
    }
  }

  /** IndexedDB にハンドルを保存する */
  async function idbSave(handle) {
    try {
      const db = await openIDB();
      await new Promise((resolve, reject) => {
        const tx  = db.transaction(IDB_STORE, "readwrite");
        const req = tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
        req.onsuccess = () => resolve();
        req.onerror   = (e) => reject(e.target.error);
      });
    } catch {
      // IndexedDB 保存失敗は非致命的。ログのみ。
      console.warn("[MomoDiskBridge] IndexedDB save failed");
    }
  }

  /** IndexedDB からハンドルを削除する */
  async function idbDelete() {
    try {
      const db = await openIDB();
      await new Promise((resolve, reject) => {
        const tx  = db.transaction(IDB_STORE, "readwrite");
        const req = tx.objectStore(IDB_STORE).delete(IDB_KEY);
        req.onsuccess = () => resolve();
        req.onerror   = (e) => reject(e.target.error);
      });
    } catch {
      console.warn("[MomoDiskBridge] IndexedDB delete failed");
    }
  }

  // ── パスユーティリティ ────────────────────────────────────────────────

  /**
   * スラッシュ区切りのパス文字列をセグメント配列に変換する。
   * 先頭/末尾の空セグメントは除去する。
   * @param {string} path
   * @returns {string[]}
   */
  function splitPath(path) {
    return (path || "").split("/").filter(Boolean);
  }

  // ── ハンドル解決 ──────────────────────────────────────────────────────

  /**
   * ルートハンドルからの相対パスを辿り、
   * 最終的な FileSystemHandle（File または Directory）を返す。
   *
   * @param {FileSystemDirectoryHandle} rootHandle
   * @param {string} path  - スラッシュ区切りの相対パス（空文字 = ルート自身）
   * @param {"file"|"dir"|"any"} kind
   * @returns {Promise<FileSystemHandle>}
   * @throws {DOMException|Error}
   */
  async function resolveHandle(rootHandle, path, kind = "any") {
    const segments = splitPath(path);
    let current = rootHandle;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLast = (i === segments.length - 1);

      if (isLast && kind === "file") {
        current = await current.getFileHandle(seg);
      } else {
        // 途中セグメント or ディレクトリ指定
        try {
          current = await current.getDirectoryHandle(seg);
        } catch {
          if (isLast && kind !== "dir") {
            // ディレクトリとして見つからなければファイルとして試みる
            current = await current.getFileHandle(seg);
          } else {
            throw new DOMException(
              `Directory not found: ${segments.slice(0, i + 1).join("/")}`,
              "NotFoundError"
            );
          }
        }
      }
    }
    return current;
  }

  /**
   * 親ディレクトリのハンドルとターゲット名を返す。
   *
   * @param {FileSystemDirectoryHandle} rootHandle
   * @param {string} path
   * @returns {Promise<{ parentHandle: FileSystemDirectoryHandle, name: string }>}
   */
  async function resolveParent(rootHandle, path) {
    const segments = splitPath(path);
    if (segments.length === 0) {
      throw new Error("Cannot get parent of root");
    }
    const name = segments[segments.length - 1];
    const parentPath = segments.slice(0, -1).join("/");
    const parentHandle = parentPath
      ? /** @type {FileSystemDirectoryHandle} */ (await resolveHandle(rootHandle, parentPath, "dir"))
      : rootHandle;
    return { parentHandle, name };
  }

  // ── パーミッション確認 ────────────────────────────────────────────────

  /**
   * ハンドルの readwrite パーミッションを確認し、
   * 必要に応じてダイアログで再要求する。
   *
   * @param {FileSystemHandle} handle
   * @returns {Promise<boolean>} - パーミッション取得できれば true
   */
  async function ensurePermission(handle, mode = "readwrite") {
    // iOS Safari では queryPermission / requestPermission が未実装の場合がある
    if (typeof handle.queryPermission !== "function") return true;
    const opts = { mode };
    try {
      if ((await handle.queryPermission(opts)) === "granted") return true;
      if (typeof handle.requestPermission !== "function") return true;
      const result = await handle.requestPermission(opts);
      return result === "granted";
    } catch {
      // パーミッション確認が失敗しても、実際の操作で失敗するまで続行する
      return true;
    }
  }

  // ── ディレクトリ再帰削除 ─────────────────────────────────────────────

  /**
   * ディレクトリを再帰的に削除する。
   * @param {FileSystemDirectoryHandle} dirHandle
   */
  async function removeDirectoryRecursive(dirHandle) {
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === "directory") {
        const subDir = await dirHandle.getDirectoryHandle(name);
        await removeDirectoryRecursive(subDir);
        await dirHandle.removeEntry(name);
      } else {
        await dirHandle.removeEntry(name);
      }
    }
  }

  // ── ディレクトリコピー ───────────────────────────────────────────────

  /**
   * ディレクトリを再帰的にコピーする。
   * @param {FileSystemDirectoryHandle} srcDir
   * @param {FileSystemDirectoryHandle} dstDir
   */
  async function copyDirectoryRecursive(srcDir, dstDir) {
    for await (const [name, entry] of srcDir.entries()) {
      if (entry.kind === "file") {
        const srcFile = await srcDir.getFileHandle(name);
        const dstFile = await dstDir.getFileHandle(name, { create: true });
        const file    = await srcFile.getFile();
        const writable = await dstFile.createWritable();
        await writable.write(await file.arrayBuffer());
        await writable.close();
      } else {
        const srcSub = await srcDir.getDirectoryHandle(name);
        const dstSub = await dstDir.getDirectoryHandle(name, { create: true });
        await copyDirectoryRecursive(srcSub, dstSub);
      }
    }
  }

  // ── MomoDiskBridge 公開オブジェクト ──────────────────────────────────

  window.MomoDiskBridge = {

    /**
     * File System Access API の対応チェック。
     * iOS Safari など typeof チェックが信頼できないブラウザにも対応。
     * @returns {boolean}
     */
    isSupported() {
      // 1) まず typeof チェック
      if (typeof window.showDirectoryPicker === "function") return true;
      // 2) iOS Safari / WebKit では typeof が "function" にならない場合がある
      //    存在するかどうかだけで判定（nullish チェック）
      if (window.showDirectoryPicker != null) return true;
      return false;
    },

    // ────────────────────────────────────────────────────────────────────
    // ルート選択・復元
    // ────────────────────────────────────────────────────────────────────

    /**
     * ブラウザのディレクトリ選択ダイアログを表示して
     * FileSystemDirectoryHandle を返す。
     * IndexedDB にも保存する。
     *
     * @returns {Promise<FileSystemDirectoryHandle>}
     */
    async openRoot() {
      let handle;
      try {
        // 通常: readwrite モード指定
        handle = await window.showDirectoryPicker({ mode: "readwrite" });
      } catch (e) {
        if (e instanceof TypeError) {
          // iOS Safari など、オプション引数を受け付けない実装への fallback
          handle = await window.showDirectoryPicker();
        } else {
          throw e;
        }
      }
      await idbSave(handle);
      return handle;
    },

    /**
     * IndexedDB からルートハンドルを復元する。
     * 復元できた場合はハンドルを、できなかった場合は null を返す。
     * パーミッションが失効していても null を返す（再選択を促す）。
     *
     * @returns {Promise<FileSystemDirectoryHandle|null>}
     */
    async restoreRoot() {
      const handle = await idbLoad();
      if (!handle) return null;
      // パーミッション確認（iOSでは queryPermission が未実装の場合はハンドルをそのまま返す）
      try {
        if (typeof handle.queryPermission !== "function") return handle;
        const perm = await handle.queryPermission({ mode: "readwrite" });
        if (perm === "granted") return handle;
        // パーミッションが "prompt" の場合は呼び出し元に再要求させる
        return handle;  // ハンドル自体は返す（Python側で requestPermission を別途呼ぶ）
      } catch {
        return null;
      }
    },

    /**
     * 保存済みルートハンドルに対して readwrite パーミッションを要求する。
     * ユーザーがキャンセルした場合は false を返す。
     *
     * @param {FileSystemDirectoryHandle} handle
     * @returns {Promise<boolean>}
     */
    async requestPermission(handle) {
      return await ensurePermission(handle, "readwrite");
    },

    /**
     * IndexedDB からルートハンドルを削除する（接続解除）。
     */
    async forgetRoot() {
      await idbDelete();
    },

    // ────────────────────────────────────────────────────────────────────
    // ディレクトリ列挙
    // ────────────────────────────────────────────────────────────────────

    /**
     * 指定パスのディレクトリ内容を返す。
     *
     * @param {FileSystemDirectoryHandle} rootHandle
     * @param {string} path  - ルートからの相対パス（空文字 = ルート）
     * @returns {Promise<Array<{name:string, type:"file"|"dir", size:number, modified:number}>>}
     */
    async listDir(rootHandle, path) {
      const dirHandle = path
        ? /** @type {FileSystemDirectoryHandle} */ (await resolveHandle(rootHandle, path, "dir"))
        : rootHandle;

      const items = [];
      for await (const [name, entry] of dirHandle.entries()) {
        if (entry.kind === "file") {
          const file = await entry.getFile();
          items.push({
            name,
            type: "file",
            size: file.size,
            modified: file.lastModified,  // UNIX ms タイムスタンプ
          });
        } else {
          items.push({
            name,
            type: "dir",
            size: 0,
            modified: 0,
          });
        }
      }

      // フォルダ先・名前昇順でソート
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name, "ja");
      });

      return items;
    },

    // ────────────────────────────────────────────────────────────────────
    // ファイル読み込み
    // ────────────────────────────────────────────────────────────────────

    /**
     * ファイルを ArrayBuffer として読み込む。
     *
     * @param {FileSystemDirectoryHandle} rootHandle
     * @param {string} path
     * @returns {Promise<ArrayBuffer>}
     */
    async readFile(rootHandle, path) {
      const fileHandle = /** @type {FileSystemFileHandle} */ (
        await resolveHandle(rootHandle, path, "file")
      );
      const file = await fileHandle.getFile();
      return await file.arrayBuffer();
    },

    /**
     * ファイルの lastModified (ms) を返す。
     *
     * @param {FileSystemDirectoryHandle} rootHandle
     * @param {string} path
     * @returns {Promise<number>}
     */
    async getModified(rootHandle, path) {
      const fileHandle = /** @type {FileSystemFileHandle} */ (
        await resolveHandle(rootHandle, path, "file")
      );
      const file = await fileHandle.getFile();
      return file.lastModified;
    },

    // ────────────────────────────────────────────────────────────────────
    // ファイル書き込み
    // ────────────────────────────────────────────────────────────────────

    /**
     * バイト列（Uint8Array / ArrayBuffer）をファイルに書き込む。
     * ファイルや途中フォルダが存在しない場合は作成する。
     *
     * @param {FileSystemDirectoryHandle} rootHandle
     * @param {string} path
     * @param {Uint8Array|ArrayBuffer} data
     * @returns {Promise<void>}
     */
    async writeFile(rootHandle, path, data) {
      const { parentHandle, name } = await resolveParent(rootHandle, path);
      const fileHandle = await parentHandle.getFileHandle(name, { create: true });
      const writable   = await fileHandle.createWritable();
      await writable.write(data instanceof Uint8Array ? data : new Uint8Array(data));
      await writable.close();
    },

    /**
     * 途中フォルダを再帰的に作成しながら writeFile を呼び出す。
     * （Python 側の write_text / write_bytes から使用）
     *
     * @param {FileSystemDirectoryHandle} rootHandle
     * @param {string} path
     * @param {Uint8Array|ArrayBuffer} data
     */
    async writeFileEnsureDirs(rootHandle, path, data) {
      const segments = splitPath(path);
      if (segments.length === 0) throw new Error("Invalid path");

      // 親ディレクトリを再帰作成
      let current = rootHandle;
      for (let i = 0; i < segments.length - 1; i++) {
        current = await current.getDirectoryHandle(segments[i], { create: true });
      }
      const fileName   = segments[segments.length - 1];
      const fileHandle = await current.getFileHandle(fileName, { create: true });
      const writable   = await fileHandle.createWritable();
      await writable.write(data instanceof Uint8Array ? data : new Uint8Array(data));
      await writable.close();
    },

    // ────────────────────────────────────────────────────────────────────
    // ディレクトリ作成
    // ────────────────────────────────────────────────────────────────────

    /**
     * 指定パスにディレクトリを再帰的に作成する。既存の場合は何もしない。
     *
     * @param {FileSystemDirectoryHandle} rootHandle
     * @param {string} path
     * @returns {Promise<void>}
     */
    async mkdir(rootHandle, path) {
      const segments = splitPath(path);
      let current = rootHandle;
      for (const seg of segments) {
        current = await current.getDirectoryHandle(seg, { create: true });
      }
    },

    // ────────────────────────────────────────────────────────────────────
    // 削除
    // ────────────────────────────────────────────────────────────────────

    /**
     * ファイルまたはディレクトリを削除する。
     * force=false（デフォルト）の場合、非空ディレクトリはエラー。
     * force=true の場合、再帰削除する。
     *
     * @param {FileSystemDirectoryHandle} rootHandle
     * @param {string} path
     * @param {boolean} force
     * @returns {Promise<void>}
     */
    async deleteEntry(rootHandle, path, force) {
      const { parentHandle, name } = await resolveParent(rootHandle, path);

      // 対象がディレクトリかどうか確認
      let targetHandle;
      try {
        targetHandle = await parentHandle.getDirectoryHandle(name);
        // ディレクトリの場合
        if (!force) {
          // 空チェック
          let count = 0;
          for await (const _ of targetHandle.entries()) { count++; break; }
          if (count > 0) {
            throw new DOMException(
              `Directory is not empty: ${path}. Use force=True to delete recursively.`,
              "InvalidModificationError"
            );
          }
        } else {
          await removeDirectoryRecursive(targetHandle);
        }
        await parentHandle.removeEntry(name);
      } catch (e) {
        if (e.name === "NotFoundError" || e.name === "TypeMismatchError") {
          // ファイルとして削除を試みる
          await parentHandle.removeEntry(name);
        } else {
          throw e;
        }
      }
    },

    // ────────────────────────────────────────────────────────────────────
    // 存在確認
    // ────────────────────────────────────────────────────────────────────

    /**
     * 指定パスが存在するか確認する。
     *
     * @param {FileSystemDirectoryHandle} rootHandle
     * @param {string} path
     * @returns {Promise<boolean>}
     */
    async exists(rootHandle, path) {
      try {
        await resolveHandle(rootHandle, path, "any");
        return true;
      } catch {
        return false;
      }
    },

    /**
     * 指定パスがディレクトリかどうか確認する。
     *
     * @param {FileSystemDirectoryHandle} rootHandle
     * @param {string} path
     * @returns {Promise<boolean>}
     */
    async isDirectory(rootHandle, path) {
      try {
        const h = await resolveHandle(rootHandle, path, "any");
        return h.kind === "directory";
      } catch {
        return false;
      }
    },

    // ────────────────────────────────────────────────────────────────────
    // コピー
    // ────────────────────────────────────────────────────────────────────

    /**
     * ファイルまたはディレクトリを別パスにコピーする。
     * ディレクトリの場合は再帰的にコピーする。
     *
     * @param {FileSystemDirectoryHandle} rootHandle
     * @param {string} srcPath
     * @param {string} dstPath
     * @returns {Promise<void>}
     */
    async copy(rootHandle, srcPath, dstPath) {
      const srcHandle = await resolveHandle(rootHandle, srcPath, "any");

      if (srcHandle.kind === "file") {
        const file = await srcHandle.getFile();
        const buf  = await file.arrayBuffer();
        await this.writeFileEnsureDirs(rootHandle, dstPath, buf);
      } else {
        // ディレクトリコピー
        await this.mkdir(rootHandle, dstPath);
        const dstHandle = /** @type {FileSystemDirectoryHandle} */ (
          await resolveHandle(rootHandle, dstPath, "dir")
        );
        await copyDirectoryRecursive(srcHandle, dstHandle);
      }
    },

  }; // end MomoDiskBridge

  console.info("[MomoDiskBridge] v1.00 loaded. Supported:", window.MomoDiskBridge.isSupported());

})();
