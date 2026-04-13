#  Terms of Use: https://qiqiroon.github.io/momo/terms.html

"""
MOMO Project - Google Drive 共通ライブラリ
momo/lib/momo_drive/momo_gdrive.py

Version : v1.01
Requires: Pyodide 0.2x+ (js モジュール経由で Google Drive API v3 を呼び出す)
Scope   : https://www.googleapis.com/auth/drive.file
"""

import json
import time
from typing import Any

# ---------------------------------------------------------------------------
# Pyodide 環境でのみ利用可能なモジュールを遅延インポートする
# ---------------------------------------------------------------------------
def _js():
    """js モジュールを返す（Pyodide 外でのテスト時は ImportError を送出）。"""
    import js  # type: ignore[import]
    return js


# ---------------------------------------------------------------------------
# 定数
# ---------------------------------------------------------------------------
DRIVE_API   = "https://www.googleapis.com/drive/v3"
UPLOAD_API  = "https://www.googleapis.com/upload/drive/v3"
SCOPE       = "https://www.googleapis.com/auth/drive.file"
CACHE_TTL   = 300          # デフォルトキャッシュ有効期限（秒）
FIELDS_FILE = (
    "id,name,mimeType,modifiedTime,size,parents,trashed"
)
FIELDS_LIST = (
    "files(id,name,mimeType,modifiedTime,size,trashed),nextPageToken"
)
MIME_FOLDER = "application/vnd.google-apps.folder"


# ---------------------------------------------------------------------------
# MomoGDrive
# ---------------------------------------------------------------------------
class MomoGDrive:
    """
    Google Drive をエクスプローラ風に操作する共通ライブラリ。

    他の momo_*.py（momo_github.py / momo_disk.py）と共通の
    メソッド名シグネチャを持ち、上位ツールから差し替え可能な
    インターフェースを提供する。

    ステート
    --------
    current_path : str   現在の絶対パス（例: "/momo/calc"）
    current_id   : str   current_path に対応する Drive フォルダ ID
    cache        : dict  { folder_id: (timestamp, [item, ...]) }
    """

    # ------------------------------------------------------------------
    # 初期化 / 認証
    # ------------------------------------------------------------------
    def __init__(self, cache_ttl: int = CACHE_TTL) -> None:
        self.current_path: str  = "/"
        self.current_id  : str  = "root"
        self.cache       : dict = {}
        self._ttl        : int  = cache_ttl
        self._token      : str | None = None  # OAuth2 アクセストークン

    # ---------- 認証 ----------

    async def connect(self) -> None:
        """
        OAuth2 認証フローを実行し、アクセストークンを取得する。
        リフレッシュトークンが取得済みの場合は自動再接続を試みる。
        Pyodide の js.google.accounts.oauth2 を利用する。
        """
        js = _js()
        token_client = js.google.accounts.oauth2.initTokenClient(
            js.Object.fromEntries(
                js.Map.new([
                    ["client_id"  , js.window.MOMO_GOOGLE_CLIENT_ID],
                    ["scope"      , SCOPE],
                    ["callback"   , self._on_token],
                ])
            )
        )
        token_client.requestAccessToken()
        # _on_token で self._token がセットされるまで待つ
        while self._token is None:
            await _sleep_ms(100)

    def _on_token(self, token_response: Any) -> None:
        """OAuth2 コールバック（js から呼び出される）。"""
        self._token = str(token_response.access_token)

    # ------------------------------------------------------------------
    # ナビゲーション（ステート管理）
    # ------------------------------------------------------------------

    async def navigate(self, path: str) -> None:
        """
        指定パスへ移動し current_path / current_id を更新する。

        Parameters
        ----------
        path : str
            絶対パス（例: "/momo/calc"）または ".." で上位移動。
        """
        if path == "..":
            if self.current_path == "/":
                return
            parent = "/".join(self.current_path.rstrip("/").split("/")[:-1]) or "/"
            path = parent

        folder_id = await self.resolve_path(path)
        self.current_id   = folder_id
        self.current_path = path if path.startswith("/") else "/" + path

    # 旧 API 互換エイリアス
    async def cd(self, path: str) -> None:
        """navigate() のエイリアス（後方互換）。"""
        await self.navigate(path)

    async def refresh(self) -> None:
        """
        カレントディレクトリのキャッシュを破棄して最新情報を取得する。
        UI の「再読み込み」ボタン等から呼び出す。
        """
        self._invalidate(self.current_id)
        await self.list_dir()

    # ------------------------------------------------------------------
    # ディレクトリ操作
    # ------------------------------------------------------------------

    async def list_dir(
        self,
        path: str | None = None,
        use_cache: bool = True,
    ) -> list[dict]:
        """
        指定フォルダ（省略時はカレント）の内容を返す。

        Returns
        -------
        list[dict]
            各アイテムは {"id", "name", "mimeType", "modifiedTime",
            "size", "isFolder"} を持つ。
        """
        if path is None:
            folder_id = self.current_id
        else:
            folder_id = await self.resolve_path(path)

        if use_cache:
            cached = self._get_cache(folder_id)
            if cached is not None:
                return cached

        items = await self._list_children(folder_id)
        self._set_cache(folder_id, items)
        return items

    async def mkdir(self, path: str) -> str:
        """
        パスが示すフォルダを再帰的に作成する（既存フォルダは再利用）。

        Returns
        -------
        str
            作成（または既存）フォルダの Drive ID。
        """
        parts = [p for p in path.strip("/").split("/") if p]
        current = "root"
        built   = ""
        for part in parts:
            built += "/" + part
            try:
                current = await self.resolve_path(built)
            except FileNotFoundError:
                current = await self._create_folder(part, current)
        return current

    async def exists(self, path: str) -> bool:
        """指定パスが存在するか確認する。"""
        try:
            await self.resolve_path(path)
            return True
        except FileNotFoundError:
            return False

    # ------------------------------------------------------------------
    # ファイル読み書き
    # ------------------------------------------------------------------

    async def read_text(self, path: str, encoding: str = "utf-8") -> str:
        """テキストファイルを読み込んで文字列で返す。"""
        data = await self.read_bytes(path)
        return data.decode(encoding)

    async def read_bytes(self, path: str) -> bytes:
        """ファイルをバイト列で返す。"""
        file_id = await self.resolve_path(path)
        url     = f"{DRIVE_API}/files/{file_id}?alt=media"
        resp    = await self._fetch(url)
        return bytes(resp)

    async def read_json(self, path: str, encoding: str = "utf-8") -> Any:
        """JSON ファイルを読み込んでオブジェクトで返す。"""
        text = await self.read_text(path, encoding)
        return json.loads(text)

    async def write_text(
        self,
        path    : str,
        content : str,
        encoding: str = "utf-8",
    ) -> str:
        """
        テキストを保存する。ファイルが存在しない場合は新規作成し、
        親フォルダも必要に応じて作成する。

        Returns
        -------
        str
            保存したファイルの Drive ID。
        """
        return await self.write_bytes(path, content.encode(encoding))

    async def write_bytes(self, path: str, data: bytes) -> str:
        """
        バイト列を保存する。ファイルが存在しない場合は新規作成。

        Returns
        -------
        str
            保存したファイルの Drive ID。
        """
        name      = path.strip("/").split("/")[-1]
        parent_p  = "/" + "/".join(path.strip("/").split("/")[:-1])
        parent_id = await self.mkdir(parent_p) if parent_p != "/" else "root"

        # 既存ファイルの ID を確認
        try:
            file_id = await self.resolve_path(path)
            # 既存ファイルを更新（PATCH multipart）
            file_id = await self._upload(
                data, name, parent_id, file_id=file_id
            )
        except FileNotFoundError:
            # 新規作成（POST multipart）
            file_id = await self._upload(data, name, parent_id)

        self._invalidate(parent_id)
        return file_id

    # ------------------------------------------------------------------
    # ファイル管理
    # ------------------------------------------------------------------

    async def delete(self, path: str, trash: bool = True) -> None:
        """
        ファイルまたはフォルダを削除する。

        Parameters
        ----------
        path  : str
        trash : bool
            True（デフォルト）: ゴミ箱へ移動（安全）。
            False            : 完全削除。
        """
        file_id   = await self.resolve_path(path)
        parent_p  = "/" + "/".join(path.strip("/").split("/")[:-1])
        parent_id = await self.resolve_path(parent_p) if parent_p != "/" else "root"

        if trash:
            await self._fetch(
                f"{DRIVE_API}/files/{file_id}",
                method  = "PATCH",
                body    = json.dumps({"trashed": True}),
                headers = {"Content-Type": "application/json"},
            )
        else:
            await self._fetch(
                f"{DRIVE_API}/files/{file_id}",
                method = "DELETE",
            )
        self._invalidate(parent_id)

    async def copy(self, src: str, dst: str) -> str:
        """
        ファイルを src から dst へコピーする。

        Returns
        -------
        str
            コピー先ファイルの Drive ID。
        """
        src_id    = await self.resolve_path(src)
        dst_name  = dst.strip("/").split("/")[-1]
        dst_par_p = "/" + "/".join(dst.strip("/").split("/")[:-1])
        dst_par   = await self.mkdir(dst_par_p) if dst_par_p != "/" else "root"

        body = json.dumps({"name": dst_name, "parents": [dst_par]})
        resp = await self._fetch(
            f"{DRIVE_API}/files/{src_id}/copy",
            method  = "POST",
            body    = body,
            headers = {"Content-Type": "application/json"},
        )
        self._invalidate(dst_par)
        return resp["id"]

    async def move(self, src: str, dst: str) -> str:
        """
        ファイルを src から dst へ移動する。

        Returns
        -------
        str
            移動後ファイルの Drive ID。
        """
        file_id   = await self.resolve_path(src)
        src_par_p = "/" + "/".join(src.strip("/").split("/")[:-1])
        src_par   = await self.resolve_path(src_par_p) if src_par_p != "/" else "root"
        dst_name  = dst.strip("/").split("/")[-1]
        dst_par_p = "/" + "/".join(dst.strip("/").split("/")[:-1])
        dst_par   = await self.mkdir(dst_par_p) if dst_par_p != "/" else "root"

        params = f"addParents={dst_par}&removeParents={src_par}&fields=id"
        body   = json.dumps({"name": dst_name})
        resp   = await self._fetch(
            f"{DRIVE_API}/files/{file_id}?{params}",
            method  = "PATCH",
            body    = body,
            headers = {"Content-Type": "application/json"},
        )
        self._invalidate(src_par)
        self._invalidate(dst_par)
        return resp["id"]

    # ------------------------------------------------------------------
    # プロパティ / 情報取得
    # ------------------------------------------------------------------

    @property
    def breadcrumb(self) -> list[dict]:
        """
        現在位置のパンくずリストを返す。

        Returns
        -------
        list[dict]
            [{"name": "My Drive", "path": "/"}, {"name": "momo", "path": "/momo"}, ...]
        """
        crumbs = [{"name": "My Drive", "path": "/"}]
        parts  = [p for p in self.current_path.strip("/").split("/") if p]
        built  = ""
        for part in parts:
            built += "/" + part
            crumbs.append({"name": part, "path": built})
        return crumbs

    def info(self) -> dict:
        """
        現在のドライブ接続状態を辞書で返す。

        Returns
        -------
        dict
            {
                "current_path": str,
                "current_id"  : str,
                "authenticated": bool,
                "cache_entries": int,
                "ttl": int,
            }
        """
        return {
            "current_path" : self.current_path,
            "current_id"   : self.current_id,
            "authenticated": self._token is not None,
            "cache_entries": len(self.cache),
            "ttl"          : self._ttl,
        }

    # ------------------------------------------------------------------
    # パス解決（内部）
    # ------------------------------------------------------------------

    async def resolve_path(self, path: str) -> str:
        """
        パス文字列から Google Drive のファイル/フォルダ ID を返す。
        同名アイテムが複数存在する場合は最終更新日時が新しいものを優先。

        Raises
        ------
        FileNotFoundError
            パスが存在しない場合。
        """
        parts   = [p for p in path.strip("/").split("/") if p]
        node_id = "root"

        for part in parts:
            items = await self._list_children(node_id)
            # 同名アイテムを修正日時降順でソートし先頭を採用
            matches = sorted(
                [i for i in items if i["name"] == part],
                key=lambda x: x["modifiedTime"],
                reverse=True,
            )
            if not matches:
                raise FileNotFoundError(f"パスが見つかりません: {path!r} ('{part}' で失敗)")
            node_id = matches[0]["id"]

        return node_id

    # ------------------------------------------------------------------
    # キャッシュ（内部）
    # ------------------------------------------------------------------

    def _get_cache(self, folder_id: str) -> list[dict] | None:
        entry = self.cache.get(folder_id)
        if entry is None:
            return None
        ts, data = entry
        if time.time() - ts > self._ttl:
            del self.cache[folder_id]
            return None
        return data

    def _set_cache(self, folder_id: str, data: list[dict]) -> None:
        self.cache[folder_id] = (time.time(), data)

    def _invalidate(self, folder_id: str) -> None:
        """指定フォルダのキャッシュを即座に破棄する。"""
        self.cache.pop(folder_id, None)

    # ------------------------------------------------------------------
    # Drive API ヘルパー（内部）
    # ------------------------------------------------------------------

    async def _list_children(self, folder_id: str) -> list[dict]:
        """フォルダ内の全アイテムを（ページネーション考慮で）取得する。"""
        items      : list[dict] = []
        page_token : str | None = None
        q = (
            f"'{folder_id}' in parents"
            " and trashed = false"
        )

        while True:
            params = (
                f"q={_urlencode(q)}"
                f"&fields={_urlencode(FIELDS_LIST)}"
                f"&orderBy=name"
                f"&pageSize=1000"
            )
            if page_token:
                params += f"&pageToken={page_token}"

            data       = await self._fetch(f"{DRIVE_API}/files?{params}")
            raw_items  = data.get("files", [])
            for item in raw_items:
                items.append({
                    "id"          : item["id"],
                    "name"        : item["name"],
                    "mimeType"    : item["mimeType"],
                    "modifiedTime": item.get("modifiedTime", ""),
                    "size"        : item.get("size", 0),
                    "isFolder"    : item["mimeType"] == MIME_FOLDER,
                })
            page_token = data.get("nextPageToken")
            if not page_token:
                break

        return items

    async def _create_folder(self, name: str, parent_id: str) -> str:
        """親フォルダ内に新しいフォルダを作成し、その ID を返す。"""
        body = json.dumps({
            "name"    : name,
            "mimeType": MIME_FOLDER,
            "parents" : [parent_id],
        })
        resp = await self._fetch(
            f"{DRIVE_API}/files?fields=id",
            method  = "POST",
            body    = body,
            headers = {"Content-Type": "application/json"},
        )
        self._invalidate(parent_id)
        return resp["id"]

    async def _upload(
        self,
        data     : bytes,
        name     : str,
        parent_id: str,
        file_id  : str | None = None,
        mime_type: str = "application/octet-stream",
    ) -> str:
        """
        multipart アップロードでファイルを作成または更新する。

        file_id が指定された場合は更新（PATCH）、なければ新規作成（POST）。
        """
        boundary = "momo_boundary_xXx"
        metadata = json.dumps({
            "name"   : name,
            "parents": [parent_id],
        })
        body = (
            f"--{boundary}\r\n"
            f"Content-Type: application/json; charset=UTF-8\r\n\r\n"
            f"{metadata}\r\n"
            f"--{boundary}\r\n"
            f"Content-Type: {mime_type}\r\n\r\n"
        ).encode() + data + f"\r\n--{boundary}--".encode()

        if file_id:
            url    = f"{UPLOAD_API}/files/{file_id}?uploadType=multipart&fields=id"
            method = "PATCH"
        else:
            url    = f"{UPLOAD_API}/files?uploadType=multipart&fields=id"
            method = "POST"

        resp = await self._fetch(
            url,
            method  = method,
            body    = body,
            headers = {
                "Content-Type": f"multipart/related; boundary={boundary}",
            },
            raw_body = True,
        )
        return resp["id"]

    async def _fetch(
        self,
        url     : str,
        method  : str = "GET",
        body    : bytes | str | None = None,
        headers : dict | None = None,
        raw_body: bool = False,
    ) -> Any:
        """
        js.fetch() 経由で Drive API を呼び出す薄いラッパー。
        JSON レスポンスはデコードして dict で返す。
        バイナリ（alt=media）は bytes で返す。
        """
        js = _js()

        req_headers = {"Authorization": f"Bearer {self._token}"}
        if headers:
            req_headers.update(headers)

        # js.Object に変換
        js_headers = js.Object.fromEntries(
            js.Map.new([[k, v] for k, v in req_headers.items()])
        )

        init = js.Object.new()
        init.method  = method
        init.headers = js_headers

        if body is not None:
            if raw_body and isinstance(body, bytes):
                arr     = js.Uint8Array.new(len(body))
                arr.set(js.Array.from_(list(body)))
                init.body = arr
            else:
                init.body = body if isinstance(body, str) else body.decode()

        resp = await js.fetch(url, init)

        if not resp.ok:
            text = await resp.text()
            raise IOError(
                f"Drive API エラー {resp.status}: {text}"
            )

        # alt=media の場合は ArrayBuffer → bytes
        content_type = str(resp.headers.get("Content-Type") or "")
        if "application/json" in content_type or url.endswith("fields=id"):
            text = await resp.text()
            return json.loads(text) if text else {}
        else:
            buf = await resp.arrayBuffer()
            return bytes(js.Uint8Array.new(buf).to_py())


# ---------------------------------------------------------------------------
# ユーティリティ
# ---------------------------------------------------------------------------

def _urlencode(s: str) -> str:
    """最小限の URL エンコード（js.encodeURIComponent 相当）。"""
    import urllib.parse
    return urllib.parse.quote(s, safe="")


async def _sleep_ms(ms: int) -> None:
    """Pyodide 向けの非同期スリープ（ミリ秒指定）。"""
    import asyncio
    await asyncio.sleep(ms / 1000)
