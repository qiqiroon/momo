# Terms of Use: https://qiqiroon.github.io/momo/terms.html
# momo_github.py  v1.01
# MOMO Project - GitHub 共通ライブラリ
# 役割: GitHubリポジトリ上のファイルを読み出し専用で取得するPyodide向け共通インターフェース
# 実行環境: Pyodide 0.2x 以上（ブラウザ内Python）
# 配置パス: momo/lib/momo_github/momo_github.py

"""
MOMO Project: GitHub 共通ライブラリ (momo_github) v1.01

各WebアプリがGitHubリポジトリ上のファイルを透過的に読み出すための
共通インターフェースを提供する。書き込み操作は一切サポートしない。

主な特徴:
  - pyodide.http.pyfetch による HTTPS GET（Pyodide環境）
  - 通常のPython環境では urllib.request にフォールバック（テスト用）
  - GitHub Contents API によるディレクトリ列挙
  - TTLベースのメモリキャッシュ（デフォルト600秒）
  - base_path によるスコープ制限
  - レート制限への対応と警告通知

使用例:
    gh = MomoGitHub(
        owner="your-org",
        repo="momo-works",
        branch="main",
        base_path="tools/calc"
    )
    config = await gh.read_json("config.json")
    script = await gh.read_text("logic/calc_core.py")
    items  = await gh.list_dir("assets")
"""

import json
import time
from datetime import datetime, timezone
from typing import Union

# ---------------------------------------------------------------------------
# Pyodide 環境の検出
# ---------------------------------------------------------------------------
try:
    import pyodide.http as _pyodide_http  # noqa: F401
    _IN_PYODIDE = True
except ModuleNotFoundError:
    _IN_PYODIDE = False


# ---------------------------------------------------------------------------
# 内部HTTPユーティリティ
# ---------------------------------------------------------------------------

async def _http_get(url: str, headers: dict = None) -> dict:
    """
    GETリクエストを実行し、レスポンス情報を辞書で返す。

    返り値の構造:
        {
            "status":   int,           # HTTPステータスコード
            "text":     str,           # レスポンスボディ（テキスト）
            "bytes":    bytes,         # レスポンスボディ（バイナリ）
            "headers":  dict,          # レスポンスヘッダ（小文字キー）
        }
    """
    headers = headers or {}

    if _IN_PYODIDE:
        import pyodide.http as ph
        resp = await ph.pyfetch(url, method="GET", headers=headers)
        status  = resp.status
        body_b  = await resp.bytes()
        # ヘッダはMappingLikeオブジェクト → 辞書化
        try:
            raw_headers = dict(resp.headers)
        except Exception:
            raw_headers = {}
        resp_headers = {k.lower(): v for k, v in raw_headers.items()}
        text = body_b.decode("utf-8", errors="replace")
        return {"status": status, "text": text, "bytes": body_b, "headers": resp_headers}

    else:
        # --- 通常Python（テスト・開発用フォールバック） ---
        import urllib.request
        import urllib.error

        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body_b = r.read()
                status = r.status
                resp_headers = {k.lower(): v for k, v in r.headers.items()}
        except urllib.error.HTTPError as e:
            body_b = e.read()
            status = e.code
            resp_headers = {k.lower(): v for k, v in e.headers.items()}
        except urllib.error.URLError as e:
            raise ConnectionError(f"Network error: {e.reason}") from e

        text = body_b.decode("utf-8", errors="replace")
        return {"status": status, "text": text, "bytes": body_b, "headers": resp_headers}


async def _http_head(url: str, headers: dict = None) -> dict:
    """
    HEADリクエストを実行してステータスコードとヘッダを返す。
    Pyodide の pyfetch は HEAD をサポートするが、
    フォールバック時も同様に扱う。
    """
    headers = headers or {}

    if _IN_PYODIDE:
        import pyodide.http as ph
        resp = await ph.pyfetch(url, method="HEAD", headers=headers)
        status = resp.status
        try:
            resp_headers = {k.lower(): v for k, v in dict(resp.headers).items()}
        except Exception:
            resp_headers = {}
        return {"status": status, "headers": resp_headers}

    else:
        import urllib.request
        import urllib.error

        req = urllib.request.Request(url, method="HEAD", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return {"status": r.status, "headers": {k.lower(): v for k, v in r.headers.items()}}
        except urllib.error.HTTPError as e:
            return {"status": e.code, "headers": {k.lower(): v for k, v in e.headers.items()}}
        except urllib.error.URLError as e:
            raise ConnectionError(f"Network error: {e.reason}") from e


# ---------------------------------------------------------------------------
# レート制限情報パーサ
# ---------------------------------------------------------------------------

def _parse_rate_limit(headers: dict) -> dict:
    """
    GitHub APIレスポンスヘッダからレート制限情報を抽出する。

    返り値:
        {
            "limit":     int | None,   # 上限リクエスト数
            "remaining": int | None,   # 残リクエスト数
            "reset_at":  str | None,       # リセット時刻（ISO 8601 文字列, UTC）
            "low_rate":  bool,         # 残10回以下で True
        }
    """
    def _int(key):
        v = headers.get(key)
        return int(v) if v is not None else None

    limit     = _int("x-ratelimit-limit")
    remaining = _int("x-ratelimit-remaining")
    reset_ts  = _int("x-ratelimit-reset")
    reset_at  = (
        datetime.fromtimestamp(reset_ts, tz=timezone.utc).isoformat()
        if reset_ts else None
    )
    low_rate = (remaining is not None and remaining <= 10)

    return {
        "limit":     limit,
        "remaining": remaining,
        "reset_at":  reset_at,   # ISO 8601 文字列（JSONシリアライズ可能）
        "low_rate":  low_rate,
    }


# ---------------------------------------------------------------------------
# MomoGitHub クラス
# ---------------------------------------------------------------------------

class MomoGitHub:
    """
    GitHubリポジトリ上のファイルを読み出し専用で取得するPyodide向けライブラリ。

    Parameters
    ----------
    owner : str
        GitHubのユーザー名または組織名。
    repo : str
        リポジトリ名。
    branch : str
        対象ブランチ名。デフォルト "main"。
    base_path : str
        このインスタンスが参照するサブフォルダのルートパス。
        省略時はリポジトリルートを参照する。
    cache_ttl : int
        キャッシュの有効期限（秒）。デフォルト 600 秒。
    """

    VERSION = "1.01"

    def __init__(
        self,
        owner: str,
        repo: str,
        branch: str = "main",
        base_path: str = "",
        cache_ttl: int = 600,
    ):
        self.owner       = owner
        self.repo        = repo
        self.branch      = branch
        self.base_path   = base_path.strip("/")
        self.cache_ttl   = cache_ttl

        # カレントディレクトリ（base_path からの相対パス）
        self.current_path: str = ""

        # キャッシュ構造: { url: (timestamp, data) }
        self.cache: dict = {}

        # 最後に確認されたレート制限情報
        self._rate_limit: dict = {
            "limit": None, "remaining": None, "reset_at": None, "low_rate": False
        }

        # ベースURL
        self._raw_base = (
            f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}"
        )
        self._api_base = (
            f"https://api.github.com/repos/{owner}/{repo}/contents"
        )

    # ------------------------------------------------------------------
    # プロパティ
    # ------------------------------------------------------------------

    @property
    def breadcrumb(self) -> str:
        """
        UIのパンくず用文字列を返す。
        例: "tools/calc > assets > images"
        """
        parts = []
        if self.base_path:
            parts.append(self.base_path)
        if self.current_path:
            parts.extend(self.current_path.split("/"))
        return " > ".join(p for p in parts if p)

    @property
    def full_current_path(self) -> str:
        """
        リポジトリ内の現在位置のフルパスを返す。
        例: "tools/calc/assets"
        """
        return self._full_path(self.current_path)

    @property
    def rate_limit_info(self) -> dict:
        """最後に取得したレート制限情報を返す。"""
        return dict(self._rate_limit)

    # ------------------------------------------------------------------
    # 読み出し操作
    # ------------------------------------------------------------------

    async def read_text(self, path: str, encoding: str = "utf-8") -> str:
        """
        指定パスのファイルをテキストとして取得し文字列を返す。

        Parameters
        ----------
        path : str
            base_path + current_path からの相対パス（またはカレントからの相対）。
        encoding : str
            文字エンコーディング。デフォルト "utf-8"。

        Raises
        ------
        FileNotFoundError
            ファイルが存在しない場合（HTTP 404）。
        ConnectionError
            ネットワークエラー。
        PermissionError
            レート制限超過（HTTP 403/429）。
        """
        url  = self._raw_url(path)
        resp = await self._fetch_raw(url)
        return resp["bytes"].decode(encoding)

    async def read_bytes(self, path: str) -> bytes:
        """
        指定パスのファイルをバイナリとして取得し bytes を返す。

        Raises
        ------
        FileNotFoundError / ConnectionError / PermissionError
        """
        url  = self._raw_url(path)
        resp = await self._fetch_raw(url)
        return resp["bytes"]

    async def read_json(self, path: str) -> Union[dict, list]:
        """
        指定パスのJSONファイルを取得しパース結果を返す。

        Raises
        ------
        FileNotFoundError / ConnectionError / PermissionError
        json.JSONDecodeError
            JSON形式が不正な場合。
        """
        text = await self.read_text(path, encoding="utf-8")
        return json.loads(text)

    async def exists(self, path: str) -> bool:
        """
        指定パスのファイルが存在するかを確認する（HEADリクエスト）。

        Returns
        -------
        bool
            存在する場合 True、しない場合 False。
        ネットワークエラー時は False を返す（例外は送出しない）。
        """
        url = self._raw_url(path)
        try:
            resp = await _http_head(url)
            return resp["status"] == 200
        except (ConnectionError, Exception):
            return False

    # ------------------------------------------------------------------
    # ディレクトリ操作
    # ------------------------------------------------------------------

    async def list_dir(
        self,
        path: str = None,
        use_cache: bool = True,
    ) -> list:
        """
        指定パスのディレクトリ内容を取得して返す。

        Parameters
        ----------
        path : str | None
            base_path + current_path からの相対パス。
            None の場合はカレントディレクトリを対象とする。
        use_cache : bool
            True の場合、有効なキャッシュがあれば再リクエストしない。

        Returns
        -------
        list of dict
            各アイテムは以下のキーを持つ::

                {
                    "name":         str,          # ファイル/フォルダ名
                    "type":         "file"|"dir", # 種別
                    "size":         int,          # ファイルサイズ（バイト）
                    "download_url": str | None,   # rawダウンロードURL
                }

            リストの末尾にメタ情報エントリが付与される::

                {
                    "_cached":    bool,
                    "_cached_at": str | None,     # キャッシュ保存時刻（ISO 8601 文字列）
                    "_rate_limit": dict,
                }

        Raises
        ------
        FileNotFoundError
            パスが存在しない場合（HTTP 404）。
        ConnectionError
            ネットワークエラー。
        PermissionError
            レート制限超過（HTTP 403/429）。
        """
        if path is None:
            path = self.current_path

        url = self._api_url(path)

        # --- キャッシュ確認 ---
        if use_cache:
            cached = self._get_cache(url, self.cache_ttl)
            if cached is not None:
                items, cached_at = cached
                meta = {
                    "_cached":    True,
                    "_cached_at": cached_at,
                    "_rate_limit": self._rate_limit,
                }
                return list(items) + [meta]

        # --- API リクエスト ---
        try:
            resp = await _http_get(url)
        except ConnectionError:
            # ネットワークエラー時はキャッシュを優先返却（期限切れでも）
            cached = self._get_cache(url, ttl=None)
            if cached is not None:
                items, cached_at = cached
                meta = {
                    "_cached":    True,
                    "_cached_at": cached_at,
                    "_rate_limit": self._rate_limit,
                }
                return list(items) + [meta]
            raise

        # レート制限ヘッダを更新
        self._rate_limit = _parse_rate_limit(resp["headers"])

        status = resp["status"]

        if status == 404:
            raise FileNotFoundError(
                f"Path not found in repository: {self._full_path(path)}"
            )

        if status in (403, 429):
            reset_at = self._rate_limit.get("reset_at")
            reset_str = reset_at if reset_at else "unknown"
            # レート制限時はキャッシュを優先返却
            cached = self._get_cache(url, ttl=None)
            if cached is not None:
                items, cached_at = cached
                meta = {
                    "_cached":    True,
                    "_cached_at": cached_at,
                    "_rate_limit": self._rate_limit,
                }
                return list(items) + [meta]
            raise PermissionError(
                f"GitHub API rate limit exceeded. "
                f"Reset at: {reset_str}. "
                f"Remaining: {self._rate_limit.get('remaining')}"
            )

        if status != 200:
            raise ConnectionError(
                f"GitHub API returned unexpected status {status} for URL: {url}"
            )

        # --- レスポンス解析 ---
        try:
            raw_items = json.loads(resp["text"])
        except json.JSONDecodeError as e:
            raise ConnectionError(
                f"Failed to parse GitHub API response as JSON: {e}"
            ) from e

        if not isinstance(raw_items, list):
            raise FileNotFoundError(
                f"The path is a file, not a directory: {self._full_path(path)}"
            )

        # フォルダを先、ファイルを後に並び替えてから返す
        items = []
        for item in raw_items:
            entry = {
                "name":         item.get("name", ""),
                "type":         "dir" if item.get("type") == "dir" else "file",
                "size":         item.get("size", 0),
                "download_url": item.get("download_url"),
            }
            items.append(entry)

        items.sort(key=lambda x: (0 if x["type"] == "dir" else 1, x["name"].lower()))

        # キャッシュ保存（cached_at は ISO 8601 文字列で保持）
        cached_at = datetime.now(tz=timezone.utc).isoformat()
        self.cache[url] = (time.monotonic(), items, cached_at)

        meta = {
            "_cached":    False,
            "_cached_at": None,
            "_rate_limit": self._rate_limit,
        }
        return list(items) + [meta]

    async def navigate(self, path: str) -> None:
        """
        カレントディレクトリを変更する。

        Parameters
        ----------
        path : str
            移動先パス。以下の形式をサポートする:
            - ".."           : 1階層上に移動
            - "subdir"       : 相対パス（カレントからの移動）
            - "/abs/path"    : base_path からの絶対パス
            - "github/..."   : リポジトリルートからの絶対パス（先頭スラッシュなし）

        Raises
        ------
        ValueError
            base_path より上位への移動を試みた場合。
        FileNotFoundError
            移動先ディレクトリが存在しない場合。
        """
        if path == "..":
            new_rel = self._parent_of(self.current_path)
        elif path.startswith("/"):
            # base_path からの絶対指定
            new_rel = path.lstrip("/")
        else:
            # 相対指定（カレントに連結）
            if self.current_path:
                new_rel = f"{self.current_path}/{path}".strip("/")
            else:
                new_rel = path.strip("/")

        # ".." コンポーネントを解決してサニタイズ
        new_rel = self._resolve_dots(new_rel)

        # base_path 外への移動を禁止（new_rel が空のままなら base_path がルート = OK）
        # 実際にディレクトリが存在するか確認
        full = self._full_path(new_rel)
        api_url = (
            f"{self._api_base}/{full}?ref={self.branch}"
            if full else
            f"{self._api_base}?ref={self.branch}"
        )

        try:
            resp = await _http_get(api_url)
        except ConnectionError as e:
            raise ConnectionError(
                f"Cannot navigate to '{path}': network error — {e}"
            ) from e

        self._rate_limit = _parse_rate_limit(resp.get("headers", {}))

        if resp["status"] == 404:
            raise FileNotFoundError(
                f"Directory not found: {full or '(root)'}"
            )
        if resp["status"] in (403, 429):
            # レート制限時は存在確認をスキップして移動を許可する
            pass
        elif resp["status"] != 200:
            raise ConnectionError(
                f"GitHub API returned status {resp['status']} "
                f"when navigating to '{full}'"
            )

        self.current_path = new_rel

    async def refresh(self, path: str = None) -> None:
        """
        指定パスのキャッシュを強制破棄する。

        Parameters
        ----------
        path : str | None
            None の場合は全キャッシュを破棄する。
        """
        if path is None:
            self.cache.clear()
            return

        url = self._api_url(path)
        if url in self.cache:
            del self.cache[url]

    # ------------------------------------------------------------------
    # 書き込み操作（禁止）
    # ------------------------------------------------------------------

    def write_text(self, *args, **kwargs):
        """書き込み操作は未サポート。"""
        raise NotImplementedError("GitHub access is read-only")

    def write_bytes(self, *args, **kwargs):
        """書き込み操作は未サポート。"""
        raise NotImplementedError("GitHub access is read-only")

    def delete(self, *args, **kwargs):
        """削除操作は未サポート。"""
        raise NotImplementedError("GitHub access is read-only")

    def mkdir(self, *args, **kwargs):
        """フォルダ作成は未サポート。"""
        raise NotImplementedError("GitHub access is read-only")

    def move(self, *args, **kwargs):
        """移動操作は未サポート。"""
        raise NotImplementedError("GitHub access is read-only")

    def copy(self, *args, **kwargs):
        """コピー操作はサポートしない（読み出し元としてのみ使用可）。"""
        raise NotImplementedError("GitHub access is read-only")

    # ------------------------------------------------------------------
    # 内部ユーティリティ
    # ------------------------------------------------------------------

    def _full_path(self, path: str) -> str:
        """
        base_path と path を組み合わせてリポジトリ内フルパスを返す。

        Parameters
        ----------
        path : str
            base_path + current_path からの相対パス。

        Returns
        -------
        str
            スラッシュ区切りのフルパス（先頭・末尾スラッシュなし）。
        """
        segments = [s for s in [self.base_path, path] if s]
        return "/".join(segments)

    def _raw_url(self, path: str) -> str:
        """
        raw コンテンツ取得用の完全URLを返す。
        path が指定されない場合はカレントディレクトリを基点とする。
        """
        # path が空でなければカレントと結合
        if path:
            full = self._full_path(f"{self.current_path}/{path}".strip("/"))
        else:
            full = self._full_path(self.current_path)
        return f"{self._raw_base}/{full}"

    def _api_url(self, path: str) -> str:
        """
        GitHub Contents API の完全URLを返す。
        """
        if path is None:
            path = self.current_path

        # path が絶対パス指定の場合（カレント連結済みのフルパス）
        if path.startswith("/"):
            full = self._full_path(path.lstrip("/"))
        else:
            if self.current_path and path:
                combined = f"{self.current_path}/{path}"
            elif self.current_path:
                combined = self.current_path
            else:
                combined = path
            full = self._full_path(combined.strip("/"))

        if full:
            return f"{self._api_base}/{full}?ref={self.branch}"
        else:
            return f"{self._api_base}?ref={self.branch}"

    def _get_cache(self, url: str, ttl: int = None):
        """
        キャッシュを確認し、有効なエントリがあれば (items, cached_at) を返す。
        存在しない場合・TTL切れの場合は None を返す。

        Parameters
        ----------
        ttl : int | None
            None の場合はTTLを無視して返す（ネットワークエラー時のフォールバック用）。
        """
        entry = self.cache.get(url)
        if entry is None:
            return None

        ts, items, cached_at = entry

        if ttl is not None and (time.monotonic() - ts) > ttl:
            return None

        return items, cached_at

    async def _fetch_raw(self, url: str) -> dict:
        """
        raw URL から GETリクエストを実行し、エラーハンドリングを行って返す。

        Raises
        ------
        FileNotFoundError / ConnectionError / PermissionError
        """
        try:
            resp = await _http_get(url)
        except ConnectionError:
            raise

        status = resp["status"]

        if status == 404:
            raise FileNotFoundError(f"File not found: {url}")

        if status in (403, 429):
            reset_at = self._rate_limit.get("reset_at")
            reset_str = reset_at if reset_at else "unknown"
            raise PermissionError(
                f"GitHub rate limit exceeded. Reset at: {reset_str}."
            )

        if status != 200:
            raise ConnectionError(
                f"Unexpected HTTP status {status} for URL: {url}"
            )

        return resp

    @staticmethod
    def _resolve_dots(path: str) -> str:
        """
        パス中の ".." コンポーネントを解消する。
        ルートより上には遡らない。

        Parameters
        ----------
        path : str
            スラッシュ区切りの相対パス。

        Returns
        -------
        str
            解消後のパス（先頭・末尾スラッシュなし）。

        Raises
        ------
        ValueError
            ".." によってルート（空パス）より上に出ようとした場合。
        """
        parts = [p for p in path.split("/") if p]
        resolved = []
        for part in parts:
            if part == "..":
                if not resolved:
                    raise ValueError(
                        "Cannot navigate above base_path"
                    )
                resolved.pop()
            elif part != ".":
                resolved.append(part)
        return "/".join(resolved)

    @staticmethod
    def _parent_of(path: str) -> str:
        """
        パスの1階層上を返す。ルートの場合は ValueError を送出する。

        Parameters
        ----------
        path : str
            base_path からの相対パス。

        Raises
        ------
        ValueError
            base_path がルート（空文字）のときさらに上に移動しようとした場合。
        """
        segments = [p for p in path.split("/") if p]
        if not segments:
            raise ValueError("Cannot navigate above base_path")
        return "/".join(segments[:-1])

    # ------------------------------------------------------------------
    # デバッグ・情報表示
    # ------------------------------------------------------------------

    def __repr__(self) -> str:
        return (
            f"MomoGitHub(v{self.VERSION}) "
            f"owner={self.owner!r} repo={self.repo!r} branch={self.branch!r} "
            f"base_path={self.base_path!r} current_path={self.current_path!r})"
        )

    def info(self) -> dict:
        """
        現在の状態をまとめた辞書を返す（デバッグ・UI表示用）。
        """
        return {
            "version":      self.VERSION,
            "owner":        self.owner,
            "repo":         self.repo,
            "branch":       self.branch,
            "base_path":    self.base_path,
            "current_path": self.current_path,
            "full_current": self.full_current_path,
            "breadcrumb":   self.breadcrumb,
            "cache_keys":   list(self.cache.keys()),
            "rate_limit":   self._rate_limit,
        }
