// drive.js - MOMO Noise Google Drive Integration
'use strict';

const Drive = (() => {
  const CLIENT_ID   = '1053350886212-q87r5msugnqbb3saoq1fh3uj3t648hcg.apps.googleusercontent.com';
  const SCOPES      = 'https://www.googleapis.com/auth/drive.file';
  const FOLDER_PATH = ['momo-works', 'noise'];  // Drive folder hierarchy
  const API_BASE    = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

  let accessToken  = null;
  let folderId     = null;
  let tokenClient  = null;

  // ── Auth ───────────────────────────────────────────────────────────────
  function isSignedIn() { return !!accessToken; }

  async function signIn() {
    return new Promise((resolve, reject) => {
      if (!window.google) { reject(new Error('Google API not loaded')); return; }
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (resp) => {
          if (resp.error) { reject(new Error(resp.error)); return; }
          accessToken = resp.access_token;
          try {
            folderId = await ensureFolderPath(FOLDER_PATH);
            resolve();
          } catch(e) { reject(e); }
        }
      });
      tokenClient.requestAccessToken({ prompt: 'select_account' });
    });
  }

  async function signInSilent() {
    return new Promise((resolve) => {
      if (!window.google) { resolve(false); return; }
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (resp) => {
          if (resp.error) { resolve(false); return; }
          accessToken = resp.access_token;
          try {
            folderId = await ensureFolderPath(FOLDER_PATH);
            resolve(true);
          } catch(e) { resolve(false); }
        }
      });
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  function signOut() {
    if (accessToken && window.google) {
      google.accounts.oauth2.revoke(accessToken, () => {});
    }
    accessToken = null;
    folderId    = null;
  }

  // ── Folder helpers ─────────────────────────────────────────────────────
  async function apiFetch(url, options = {}) {
    const resp = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        ...(options.headers || {})
      }
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Drive API error ${resp.status}: ${err.error?.message || resp.statusText}`);
    }
    return resp.json();
  }

  async function findFolder(name, parentId) {
    const q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
    const data = await apiFetch(`${API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
    return data.files[0]?.id || null;
  }

  async function createFolder(name, parentId) {
    const data = await apiFetch(`${API_BASE}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      })
    });
    return data.id;
  }

  async function ensureFolderPath(parts) {
    let parentId = 'root';
    for (const name of parts) {
      let id = await findFolder(name, parentId);
      if (!id) id = await createFolder(name, parentId);
      parentId = id;
    }
    return parentId;
  }

  // ── File operations ────────────────────────────────────────────────────
  async function listFiles() {
    if (!folderId) return [];
    const q = `'${folderId}' in parents and trashed=false`;
    const data = await apiFetch(`${API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,size,modifiedTime)&orderBy=name`);
    return data.files;
  }

  async function uploadWav(name, wavBlob) {
    if (!folderId) throw new Error('Not connected');

    // Check if file exists (update vs create)
    const q = `name='${name}' and '${folderId}' in parents and trashed=false`;
    const existing = await apiFetch(`${API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id)`);
    const existingId = existing.files[0]?.id;

    const metadata = existingId
      ? {}
      : { name, parents: [folderId], mimeType: 'audio/wav' };

    const form = new FormData();
    if (!existingId) {
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    }
    form.append('file', wavBlob, name);

    const url = existingId
      ? `${UPLOAD_BASE}/files/${existingId}?uploadType=multipart`
      : `${UPLOAD_BASE}/files?uploadType=multipart`;
    const method = existingId ? 'PATCH' : 'POST';

    const resp = await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: form
    });
    if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
    return resp.json();
  }

  async function saveJson(name, obj) {
    if (!folderId) throw new Error('Not connected');
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });

    const q = `name='${name}' and '${folderId}' in parents and trashed=false`;
    const existing = await apiFetch(`${API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id)`);
    const existingId = existing.files[0]?.id;

    const form = new FormData();
    if (!existingId) {
      form.append('metadata', new Blob([JSON.stringify({ name, parents: [folderId], mimeType: 'application/json' })], { type: 'application/json' }));
    }
    form.append('file', blob, name);

    const url = existingId
      ? `${UPLOAD_BASE}/files/${existingId}?uploadType=multipart`
      : `${UPLOAD_BASE}/files?uploadType=multipart`;
    const method = existingId ? 'PATCH' : 'POST';

    const resp = await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: form
    });
    if (!resp.ok) throw new Error(`Save failed: ${resp.status}`);
  }

  async function loadJson(name) {
    if (!folderId) throw new Error('Not connected');
    const q = `name='${name}' and '${folderId}' in parents and trashed=false`;
    const data = await apiFetch(`${API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id)`);
    const fileId = data.files[0]?.id;
    if (!fileId) return null;
    const resp = await fetch(`${API_BASE}/files/${fileId}?alt=media`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!resp.ok) return null;
    return resp.json();
  }

  return { isSignedIn, signIn, signInSilent, signOut, listFiles, uploadWav, saveJson, loadJson };
})();
