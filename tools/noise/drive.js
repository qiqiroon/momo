// drive.js - MOMO Noise Google Drive Integration v0.03
'use strict';

const Drive = (() => {
  const VERSION   = 'v0.03';
  const CLIENT_ID = '1053350886212-q87r5msugnqbb3saoq1fh3uj3t648hcg.apps.googleusercontent.com';
  const SCOPES    = 'https://www.googleapis.com/auth/drive.file';
  const FOLDER    = ['momo-works', 'noise'];
  const API       = 'https://www.googleapis.com/drive/v3';
  const UPLOAD    = 'https://www.googleapis.com/upload/drive/v3';

  let token    = null;
  let folderId = null;

  function isSignedIn() { return !!token; }

  // ── Auth ──────────────────────────────────────────────────────────────
  async function signIn() {
    if (!window.google) throw new Error('Google API not loaded');
    return new Promise((res, rej) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID, scope: SCOPES,
        callback: async r => {
          if (r.error) { rej(new Error(r.error)); return; }
          token = r.access_token;
          try { folderId = await ensureFolder(); res(); }
          catch(e) { rej(e); }
        }
      });
      tc.requestAccessToken({ prompt: 'select_account' });
    });
  }

  function signOut() {
    if (token && window.google) google.accounts.oauth2.revoke(token, () => {});
    token = null; folderId = null;
  }

  // ── Folder ────────────────────────────────────────────────────────────
  async function apiFetch(url, opts = {}) {
    const r = await fetch(url, {
      ...opts,
      headers: { 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) }
    });
    if (!r.ok) {
      const msg = await r.text().catch(() => r.status);
      throw new Error(`API ${r.status}: ${msg}`);
    }
    return r.json();
  }

  async function findOrCreate(name, parentId) {
    const q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
    const d = await apiFetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)`);
    if (d.files[0]) return d.files[0].id;
    const r = await apiFetch(`${API}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
    });
    return r.id;
  }

  async function ensureFolder() {
    let pid = 'root';
    for (const name of FOLDER) pid = await findOrCreate(name, pid);
    return pid;
  }

  // ── File helpers ──────────────────────────────────────────────────────
  async function findFile(name) {
    const q = `name='${name}' and '${folderId}' in parents and trashed=false`;
    const d = await apiFetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)`);
    return d.files[0]?.id || null;
  }

  async function uploadBytes(name, blob, mime) {
    const existId = await findFile(name);
    let resp;
    if (existId) {
      // Update: media upload
      resp = await fetch(`${UPLOAD}/files/${existId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': mime },
        body: blob
      });
    } else {
      // Create: multipart
      const form = new FormData();
      form.append('metadata', new Blob(
        [JSON.stringify({ name, parents: [folderId], mimeType: mime })],
        { type: 'application/json' }
      ));
      form.append('file', blob, name);
      resp = await fetch(`${UPLOAD}/files?uploadType=multipart`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form
      });
    }
    if (!resp.ok) {
      const msg = await resp.text().catch(() => resp.status);
      throw new Error(`Upload failed ${resp.status}: ${msg}`);
    }
  }

  async function downloadBytes(name) {
    const id = await findFile(name);
    if (!id) return null;
    const r = await fetch(`${API}/files/${id}?alt=media`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) return null;
    return r.arrayBuffer();
  }

  // ── Public API ────────────────────────────────────────────────────────
  // ボタン番号でWAVを保存・読込 (btn_00.wav 〜 btn_29.wav)
  function wavName(btnId) { return 'btn_' + String(btnId).padStart(2, '0') + '.wav'; }

  async function uploadWav(btnId, wavBlob) {
    await uploadBytes(wavName(btnId), wavBlob, 'audio/wav');
  }

  async function downloadWav(btnId) {
    return downloadBytes(wavName(btnId));
  }

  async function saveJson(obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    await uploadBytes('noise_settings.json', blob, 'application/json');
  }

  async function loadJson() {
    const ab = await downloadBytes('noise_settings.json');
    if (!ab) return null;
    return JSON.parse(new TextDecoder().decode(ab));
  }

  return { VERSION, isSignedIn, signIn, signOut, uploadWav, downloadWav, saveJson, loadJson };
})();
