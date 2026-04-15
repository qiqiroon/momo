# Terms of Use: https://qiqiroon.github.io/momo/terms.html
# momo_disk.py  v1.00
# MOMO Project - ローカルディスクアクセス共通ライブラリ
# 役割: File System Access API（JavaScript）を Pyodide 経由で呼び出し、
#       ローカルドライブのファイルを透過的に読み書きする。
# 実行環境: Pyodide 0.2x 以上（ブラウザ内Python / Chrome・Edge 推奨）
# 配置パス: momo/lib/momo_disk/momo_disk.py
# 依存JS:   momo/lib/momo_disk/momo_disk_bridge.js（同ディレクトリに配置）

"""
MOMO Project: ローカルディスクアクセス共通ライブラリ (momo_disk) v1.00

ブラウザの File System Access API を通じて、ユーザーが選択した
ディレクトリ以下のファイルを読み書きする Pyodide 向けライブラリ。

【重要】本ライブラリは momo_disk_bridge.js が window に読み込まれた
状態で使用すること。HTML 側で以下を記述しておく:
    <script src="path/to/momo_disk_bridge.js"></script>

使用例:
    disk = MomoDisk()
    restored = await disk.open_root()   # True=復元成功, False=新規ダイアログ
    items = await disk.list_dir()
    text  = await disk.read_text("notes/memo.txt")
    await disk.write_text("notes/memo.txt", "Hello!")
    await disk.navigate("notes")
    await disk.delete("old.txt")
"""

import time
import json
from datetime import datetime, timezone
from typing import Callable, Optional

# ---------------------------------------------------------------------------
# 実行環境検出
# ---------------------------------------------------------------------------
try:
    import js          # Pyodide JS ブリッジ
    import pyodide.ffi as _ffi
    _IN_PYODIDE = True
except ModuleNotFoundError:
    _IN_PYODIDE = False


# ---------------------------------------------------------------------------
# ブリッジ呼び出しヘルパー
# ---------------------------------------------------------------------------

def _bridge():
    """window.MomoDiskBridge を返す。未ロードの場合は RuntimeError。"""
    if not _IN_PYODIDE:
        raise RuntimeError(
            "MomoDisk は Pyodide 環境でのみ動作します。"
        )
    bridge = getattr(js.window, "MomoDiskBridge", None)
    if bridge is None:
        raise RuntimeError(
            "MomoDiskBridge が window に見つかりません。"
            "momo_disk_bridge.js を読み込んでください。"
        )
    return bridge


async def _await_js(promise):
    """JS の Promise を Python の await に変換する。"""
    return await promise


# ---------------------------------------------------------------------------
# ブラウザ対応チェック
# ---------------------------------------------------------------------------

def check_browser_support():
    """
    File System Access API のブラウザ対応を確認する。
    非対応の場合は NotImplementedError を送出する。
    """
    if not _IN_PYODIDE:
        return  # 開発環境ではスキップ
    try:
        supported = _bridge().isSupported()
    except Exception:
        supported = False
    if not supported:
        raise NotImplementedError(
            "File System Access API はこのブラウザではサポートされていません。"
            "Chrome / Edge 86以上、または Safari（iOS 17以上）をご利用ください。"
        )


# ---------------------------------------------------------------------------
# MomoDisk クラス
# ---------------------------------------------------------------------------

class MomoDisk:
    """
    File System Access API を Pyodide 経由で操作するローカルディスクライブラリ。

    Attributes
    ----------
    root_handle : JS object | None
        FileSystemDirectoryHandle（JS オブジェクト）。open_root() 後に設定される。
    root_name : str
        選択されたルートフォルダの表示名。
    current_path : str
        現在の絶対パス（ルートを "/" とする相対表現）。
    current_handle : JS object | None
        現在の FileSystemDirectoryHandle。
    cache : dict
        メモリキャッシュ。{ path: (monotonic_ts, item_list, cached_at) }
    cache_ttl : int
        キャッシュ有効期限（秒）。デフォルト 60 秒。
    on_write_start : callable | None
        書き込み開始コールバック (path) -> None
    on_write_end : callable | None
        書き込み完了コールバック (path) -> None
    """

    VERSION = "1.01"

    def __init__(self, cache_ttl: int = 60):
        # ブラウザ対応チェックは open_root() 時に行う（初期化は通す）
        self.root_handle   = None   # JS FileSystemDirectoryHandle
        self.root_name     = ""
        self.current_path  = "/"
        self.current_handle = None

        self.cache: dict   = {}     # { path: (ts, items, cached_at) }
        self.cache_ttl     = cache_ttl

        # 書き込み通知コールバック（省略可）
        self.on_write_start: Optional[Callable[[str], None]] = None
        self.on_write_end:   Optional[Callable[[str], None]] = None

    # ── プロパティ ──────────────────────────────────────────────────────

    @property
    def is_connected(self) -> bool:
        """ルートが選択済みかどうか。"""
        return self.root_handle is not None

    @property
    def breadcrumb(self) -> str:
        """
        パンくず用文字列を返す。
        例: "music > songs > 2024"
        """
        if not self.root_name:
            return ""
        parts = [self.root_name]
        rel = self.current_path.strip("/")
        if rel:
            parts.extend(rel.split("/"))
        return " > ".join(p for p in parts if p)

    @property
    def relative_path(self) -> str:
        """ルートからの相対パス（先頭スラッシュなし）。"""
        return self.current_path.strip("/")

    # ── ルート選択・復元 ────────────────────────────────────────────────

    async def open_root(self) -> bool:
        """
        ルートディレクトリを選択または復元する。

        IndexedDB にキャッシュされたハンドルがある場合は自動復元を試みる。
        復元できた場合は True、新規ダイアログを表示した場合は False を返す。
        UI 側で「前回の接続を復元しました」等の表示に使用できる。

        Returns
        -------
        bool
            True  = IndexedDB から復元成功
            False = 新規ダイアログを表示してユーザーが選択

        Raises
        ------
        PermissionError
            ユーザーがディレクトリ選択をキャンセルした場合。
        NotImplementedError
            ブラウザが File System Access API に非対応の場合。
        """
        # open_root 時点でブラウザ対応チェック（初期化は通す）
        check_browser_support()

        b = _bridge()

        # IndexedDB から復元を試みる
        cached_handle = await _await_js(b.restoreRoot())
        if cached_handle is not None:
            # パーミッション確認・再要求
            granted = await _await_js(b.requestPermission(cached_handle))
            if granted:
                self.root_handle    = cached_handle
                self.root_name      = cached_handle.name
                self.current_path   = "/"
                self.current_handle = cached_handle
                self.cache.clear()
                return True  # 復元成功
            # パーミッション失効 → 新規選択へ

        # 新規ダイアログ
        try:
            handle = await _await_js(b.openRoot())
        except Exception as e:
            raise PermissionError(
                f"ディレクトリ選択がキャンセルされたか、エラーが発生しました: {e}"
            ) from e

        self.root_handle    = handle
        self.root_name      = handle.name
        self.current_path   = "/"
        self.current_handle = handle
        self.cache.clear()
        return False  # 新規選択

    async def forget_root(self) -> None:
        """
        保存済みルートハンドルを IndexedDB から削除し、接続を解除する。
        """
        if _IN_PYODIDE:
            await _await_js(_bridge().forgetRoot())
        self.root_handle    = None
        self.root_name      = ""
        self.current_path   = "/"
        self.current_handle = None
        self.cache.clear()

    # ── ナビゲーション ──────────────────────────────────────────────────

    async def navigate(self, path: str) -> None:
        """
        カレントディレクトリを変更する。

        Parameters
        ----------
        path : str
            ".."       : 1階層上に移動
            "/abs/path": ルートからの絶対パス
            "rel/path" : カレントからの相対パス

        Raises
        ------
        RuntimeError
            open_root() が未実行の場合。
        FileNotFoundError
            移動先ディレクトリが存在しない場合。
        ValueError
            ルートより上への移動を試みた場合。
        """
        self._require_root()

        new_path = self._resolve_path(path)

        # 実際に存在するか確認してハンドルを取得
        rel = new_path.strip("/")
        try:
            if rel:
                new_handle = await _await_js(
                    _bridge().resolveHandle(self.root_handle, rel, "dir")
                ) if False else await self._get_dir_handle(rel)
            else:
                new_handle = self.root_handle
        except Exception as e:
            raise FileNotFoundError(
                f"ディレクトリが見つかりません: {new_path}  ({e})"
            ) from e

        self.current_path   = new_path
        self.current_handle = new_handle

    async def _get_dir_handle(self, rel_path: str):
        """相対パスのディレクトリハンドルを返す（内部用）。"""
        # JS ブリッジの listDir を使わず Python 側でパスを辿る
        # navigateTo はディレクトリ確認のため listDir を呼ぶ
        items = await _await_js(
            _bridge().listDir(self.root_handle, rel_path)
        )
        # listDir が成功すればそのパスはディレクトリ
        # ハンドル自体は Python では直接保持できないため、
        # current_handle は root_handle からパスで都度解決する
        # → この実装では current_handle は概念的に保持し、
        #    実操作時に root_handle + current_path を使う
        return True  # ダミー（成功 = ディレクトリ存在確認済み）

    # ── ディレクトリ一覧 ────────────────────────────────────────────────

    async def list_dir(
        self,
        path: str = None,
        use_cache: bool = True,
    ) -> list:
        """
        指定パスのディレクトリ内容を返す。

        Parameters
        ----------
        path : str | None
            None の場合はカレントディレクトリ。
        use_cache : bool
            True の場合、有効なキャッシュがあれば再リクエストしない。

        Returns
        -------
        list of dict
            各アイテムは以下のキーを持つ::

                {
                    "name":     str,
                    "type":     "file" | "dir",
                    "size":     int,          # バイト数（ディレクトリは 0）
                    "modified": str,           # 最終更新日時（ISO 8601 UTC）例: "2024-03-15T12:34:56+00:00"
                }

        Raises
        ------
        RuntimeError
            open_root() 未実行。
        FileNotFoundError
            パスが存在しない場合。
        """
        self._require_root()

        if path is None:
            path = self.current_path
        cache_key = self._abs_path(path)

        if use_cache:
            cached = self._get_cache(cache_key)
            if cached is not None:
                return cached

        rel = cache_key.strip("/")
        try:
            js_items = await _await_js(
                _bridge().listDir(self.root_handle, rel)
            )
        except Exception as e:
            raise FileNotFoundError(
                f"ディレクトリの読み込みに失敗しました: {cache_key} ({e})"
            ) from e

        # JS 配列 → Python リスト
        items = self._js_items_to_python(js_items)

        self._set_cache(cache_key, items)
        return items

    # ── ファイル読み込み ────────────────────────────────────────────────

    async def read_text(self, path: str, encoding: str = "utf-8") -> str:
        """
        指定パスのファイルをテキストとして読み込み文字列を返す。

        Raises
        ------
        RuntimeError / FileNotFoundError / PermissionError
        """
        data = await self.read_bytes(path)
        return data.decode(encoding)

    async def read_bytes(self, path: str) -> bytes:
        """
        指定パスのファイルをバイナリとして読み込み bytes を返す。

        Raises
        ------
        RuntimeError / FileNotFoundError / PermissionError
        """
        self._require_root()
        rel = self._abs_path(path).strip("/")
        try:
            buf = await _await_js(
                _bridge().readFile(self.root_handle, rel)
            )
            # buf は JS ArrayBuffer → Python bytes に変換
            return bytes(buf.to_py()) if hasattr(buf, "to_py") else bytes(buf)
        except Exception as e:
            self._raise_access_error(path, e)

    async def read_json(self, path: str) -> "dict | list":
        """
        指定パスの JSON ファイルを読み込みパース結果を返す。
        """
        text = await self.read_text(path, encoding="utf-8")
        return json.loads(text)

    # ── ファイル書き込み ────────────────────────────────────────────────

    async def write_text(
        self,
        path: str,
        content: str,
        encoding: str = "utf-8",
    ) -> None:
        """
        テキストをファイルに書き込む。
        ファイルや途中フォルダが存在しない場合は新規作成する。

        Raises
        ------
        RuntimeError / PermissionError
        """
        await self.write_bytes(path, content.encode(encoding))

    async def write_bytes(self, path: str, data: bytes) -> None:
        """
        バイナリデータをファイルに書き込む。
        途中フォルダが存在しない場合は再帰的に作成する。

        Raises
        ------
        RuntimeError / PermissionError
        """
        self._require_root()
        abs_path = self._abs_path(path)
        rel = abs_path.strip("/")

        if self.on_write_start:
            try: self.on_write_start(abs_path)
            except Exception: pass

        try:
            from js import Uint8Array
            js_data = Uint8Array.new(data)
            await _await_js(
                _bridge().writeFileEnsureDirs(self.root_handle, rel, js_data)
            )
        except Exception as e:
            self._raise_access_error(path, e)
        finally:
            if self.on_write_end:
                try: self.on_write_end(abs_path)
                except Exception: pass

        self._invalidate_cache(abs_path)

    # ── ファイル操作 ────────────────────────────────────────────────────

    async def exists(self, path: str) -> bool:
        """
        指定パスが存在するか bool で返す。
        """
        self._require_root()
        rel = self._abs_path(path).strip("/")
        try:
            result = await _await_js(
                _bridge().exists(self.root_handle, rel)
            )
            return bool(result)
        except Exception:
            return False

    async def mkdir(self, path: str) -> None:
        """
        指定パスにディレクトリを再帰的に作成する。既存の場合は何もしない。

        Raises
        ------
        RuntimeError / PermissionError
        """
        self._require_root()
        rel = self._abs_path(path).strip("/")
        try:
            await _await_js(_bridge().mkdir(self.root_handle, rel))
        except Exception as e:
            self._raise_access_error(path, e)
        self._invalidate_cache(self._parent_path(self._abs_path(path)))

    async def delete(self, path: str, force: bool = False) -> None:
        """
        指定ファイルまたはディレクトリを削除する（ゴミ箱移動）。

        Parameters
        ----------
        path : str
            削除対象のパス。
        force : bool
            True の場合、非空ディレクトリを再帰削除する。
            False（デフォルト）の場合、非空ディレクトリは IsADirectoryError。

        Raises
        ------
        RuntimeError
            open_root() 未実行。
        FileNotFoundError
            パスが存在しない。
        IsADirectoryError
            非空ディレクトリを force=False で削除しようとした場合。
        PermissionError
            書き込み権限がない場合。

        Note
        ----
        File System Access API には OS のゴミ箱へ移動する機能がない。
        本メソッドでは removeEntry による完全削除を行う。
        エクスプローラからの呼び出しでは確認ダイアログを表示すること。
        """
        self._require_root()
        abs_path = self._abs_path(path)
        rel = abs_path.strip("/")

        try:
            await _await_js(
                _bridge().deleteEntry(self.root_handle, rel, force)
            )
        except Exception as e:
            err_str = str(e)
            if "not empty" in err_str.lower() or "InvalidModificationError" in err_str:
                raise IsADirectoryError(
                    f"ディレクトリが空ではありません: {abs_path}  "
                    f"（force=True で再帰削除できます）"
                ) from e
            elif "NotFoundError" in err_str or "not found" in err_str.lower():
                raise FileNotFoundError(f"削除対象が見つかりません: {abs_path}") from e
            else:
                self._raise_access_error(path, e)

        self._invalidate_cache(abs_path)

    async def copy(self, src: str, dst: str) -> None:
        """
        ファイルまたはディレクトリを別パスにコピーする。
        ディレクトリの場合は再帰的にコピーする。

        Raises
        ------
        RuntimeError / FileNotFoundError / PermissionError
        """
        self._require_root()
        src_rel = self._abs_path(src).strip("/")
        dst_rel = self._abs_path(dst).strip("/")

        try:
            await _await_js(
                _bridge().copy(self.root_handle, src_rel, dst_rel)
            )
        except Exception as e:
            self._raise_access_error(f"{src} -> {dst}", e)

        self._invalidate_cache(self._abs_path(dst))

    async def move(self, src: str, dst: str) -> None:
        """
        ファイルまたはディレクトリを別パスに移動する（コピー＋削除）。

        Raises
        ------
        RuntimeError / FileNotFoundError / PermissionError
        """
        await self.copy(src, dst)
        await self.delete(src, force=True)
        self._invalidate_cache(self._abs_path(src))
        self._invalidate_cache(self._abs_path(dst))

    # ── キャッシュ ──────────────────────────────────────────────────────

    async def refresh(self, path: str = None) -> None:
        """
        指定パスのキャッシュを強制破棄し、最新情報を取得できる状態にする。

        Parameters
        ----------
        path : str | None
            None の場合は全キャッシュをクリアする。
        """
        if path is None:
            self.cache.clear()
        else:
            key = self._abs_path(path)
            self.cache.pop(key, None)

    # ── 内部ユーティリティ ──────────────────────────────────────────────

    def _require_root(self) -> None:
        """ルートが未選択の場合に RuntimeError を送出する。"""
        if self.root_handle is None:
            raise RuntimeError(
                "Root not selected. open_root() を先に呼び出してください。"
            )

    def _abs_path(self, path: str) -> str:
        """
        path を現在のカレントディレクトリを基点とした絶対パスに変換する。

        - 先頭が "/" なら絶対パスとして扱う
        - それ以外はカレントからの相対パス
        - ".." を解決する
        """
        if not path or path == "/":
            return "/"
        if path.startswith("/"):
            clean = path
        else:
            base = self.current_path.rstrip("/")
            clean = f"{base}/{path}"

        # ".." 解消
        parts = []
        for seg in clean.split("/"):
            if not seg or seg == ".":
                continue
            elif seg == "..":
                if parts:
                    parts.pop()
                # ルートより上には遡らない
            else:
                parts.append(seg)
        return "/" + "/".join(parts)

    def _resolve_path(self, path: str) -> str:
        """
        navigate() 用パス解決。"/.." はルートより上に出ないようにする。

        Raises
        ------
        ValueError
            ルートより上への移動を試みた場合。
        """
        if path == "..":
            parts = [p for p in self.current_path.split("/") if p]
            if not parts:
                raise ValueError("ルートより上には移動できません。")
            parts.pop()
            return "/" + "/".join(parts)
        return self._abs_path(path)

    @staticmethod
    def _parent_path(abs_path: str) -> str:
        """絶対パスの親パスを返す。"""
        parts = [p for p in abs_path.split("/") if p]
        if not parts:
            return "/"
        return "/" + "/".join(parts[:-1])

    def _get_cache(self, key: str) -> "list | None":
        """TTL 内のキャッシュを返す。なければ None。"""
        entry = self.cache.get(key)
        if entry is None:
            return None
        ts, items, _ = entry
        if (time.monotonic() - ts) > self.cache_ttl:
            return None
        return items

    def _set_cache(self, key: str, items: list) -> None:
        """キャッシュを保存する。"""
        self.cache[key] = (time.monotonic(), items, datetime.now(tz=timezone.utc))

    def _invalidate_cache(self, abs_path: str) -> None:
        """
        指定パスおよびその親パスのキャッシュを破棄する。
        書き込み操作後に呼び出して不整合を防ぐ。
        """
        self.cache.pop(abs_path, None)
        parent = self._parent_path(abs_path)
        if parent != abs_path:
            self.cache.pop(parent, None)

    @staticmethod
    def _js_items_to_python(js_items) -> list:
        """
        JS の配列（MomoDiskBridge.listDir の戻り値）を
        Python の dict リストに変換する。
        """
        result = []
        # Pyodide の JsProxy は to_py() でネイティブ変換できる
        if hasattr(js_items, "to_py"):
            raw_list = js_items.to_py()
        else:
            raw_list = list(js_items)

        for item in raw_list:
            if hasattr(item, "to_py"):
                item = item.to_py()
            # modified は UNIX ms タイムスタンプ → datetime
            modified_ms = item.get("modified", 0)
            if modified_ms:
                modified = datetime.fromtimestamp(
                    modified_ms / 1000, tz=timezone.utc
                )
            else:
                modified = None

            result.append({
                "name":     item.get("name", ""),
                "type":     item.get("type", "file"),
                "size":     item.get("size", 0),
                "modified": modified.isoformat() if modified else None,
            })
        return result

    @staticmethod
    def _raise_access_error(path: str, original: Exception) -> None:
        """
        JS 例外を適切な Python 例外に変換して送出する。
        """
        err_str = str(original)
        if "NotFoundError" in err_str or "not found" in err_str.lower():
            raise FileNotFoundError(f"見つかりません: {path}") from original
        if "NotAllowedError" in err_str or "permission" in err_str.lower():
            raise PermissionError(
                f"アクセス権限がありません: {path}。"
                "open_root() でディレクトリ再選択を試みてください。"
            ) from original
        if "SecurityError" in err_str:
            raise PermissionError(
                f"セキュリティエラー: {path}。"
                "ユーザーの操作によるファイルアクセスのみ許可されています。"
            ) from original
        raise OSError(f"ファイルアクセスエラー: {path}  ({original})") from original

    # ── デバッグ・情報表示 ──────────────────────────────────────────────

    def __repr__(self) -> str:
        return (
            f"MomoDisk(v{self.VERSION}) "
            f"root={self.root_name!r} "
            f"current={self.current_path!r} "
            f"connected={self.is_connected})"
        )

    def info(self) -> dict:
        """現在の状態をまとめた辞書を返す（デバッグ・UI表示用）。"""
        return {
            "version":      self.VERSION,
            "connected":    self.is_connected,
            "root_name":    self.root_name,
            "current_path": self.current_path,
            "breadcrumb":   self.breadcrumb,
            "cache_count":  len(self.cache),
            "cache_ttl":    self.cache_ttl,
        }
