// MOMO Remaster の Service Worker（1つのスコープに1つ）
//
// 役目は2つで、1つの Service Worker にまとめる（［計画 3.2.1］No.3：同じスコープに2つは登録できない）。
//   (1) オフライン動作：初回の訪問で配信物をすべて取得してキャッシュに置き、以後はキャッシュから返す（［機能 17.4.2］No.1）
//   (2) COOP/COEP の注入：GitHub Pages はヘッダを設定できないため、返す応答にヘッダを付けて
//       crossOriginIsolated を成り立たせる（［概要 11.2］案B の方式。仕組みは自前で書いた）
//
// キャッシュの名と配信物の一覧は、ビルドの時に下の2つの印を置き換えて埋め込む（build/vite-plugin-momo.ts の swPlugin）。

const CACHE_NAME = "momo-remaster-v0.01-5c210f91949e";
const PRECACHE = ["","assets/FredokaOne-Regular-9veppiWx.woff2","assets/IsolationProbe-DZKR8TGT.js","assets/NotoSansJP-subset-zIdWfxs3.woff2","assets/NotoSansSC-subset-BPvscAqb.woff2","assets/V01Probe-DwHejIQg.js","assets/convert.worker-bjGgEOJx.js","assets/feeder.worker-BOqAiJEY.js","assets/index-Npzn5yAf.js","assets/index-ajse9NMv.css","assets/measure.worker-BdG90Mpy.js","assets/player.worklet-ivIL6mtc.js","assets/probe-CkDACvOQ.css","assets/transportProbe.worker-2uPcunG-.js","ffmpeg/ffmpeg-core.js","ffmpeg/ffmpeg-core.wasm","i18n/err.en.json","i18n/err.ja.json","i18n/err.zh.json","i18n/help.en.json","i18n/help.ja.json","i18n/help.zh.json","i18n/ui.en.json","i18n/ui.ja.json","i18n/ui.zh.json","index.html","manifest.webmanifest"];

const scopeUrl = new URL(self.registration.scope);
// MOMO Works の共通の言語ルーチン（スコープの外・同じオリジン）。オフラインでも言語の切替が動くように保存する
const SHARED = ['/momo/lib/momo-lang/momo-lang.js'].map((p) => new URL(p, scopeUrl.origin).href);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(PRECACHE.map((path) => new URL(path, scopeUrl).href));
      // 共通ライブラリは取れなくても入れ替えを止めない（取れなければアプリは日本語で動く）
      await Promise.all(SHARED.map((u) => cache.add(u).catch(() => undefined)));
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('momo-remaster-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skipWaiting') self.skipWaiting();
});

/** 応答に COOP/COEP を付けた写しを作る。opaque な応答は中身を読めないのでそのまま返す */
function withIsolationHeaders(response) {
  if (response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // スコープの外（MOMO Works の他のページ・外部）には手を出さない。共通ライブラリだけは保存したものを返す
  const shared = SHARED.includes(url.href);
  if (url.origin !== scopeUrl.origin || (!url.pathname.startsWith(scopeUrl.pathname) && !shared)) return;
  // only-if-cached は同じオリジンでなければ失敗するため、そのまま通す
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // ページの遷移は、クエリの違い（?coi=off など）をキャッシュの照合で無視する
      if (shared) {
        // 共通ライブラリは新しいものを先に取りにいき、取れなければ保存したものを返す（直せば全アプリが直る設計に従う）
        try {
          const fresh = await fetch(request);
          if (fresh.ok) {
            await cache.put(request, fresh.clone());
            return withIsolationHeaders(fresh);
          }
        } catch {
          // オフライン
        }
        const kept = await cache.match(request);
        return kept ? withIsolationHeaders(kept) : Response.error();
      }
      const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
      if (cached) return withIsolationHeaders(cached);
      const response = await fetch(request);
      return withIsolationHeaders(response);
    })(),
  );
});
