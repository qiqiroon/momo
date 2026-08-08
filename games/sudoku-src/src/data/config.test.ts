import { describe, it, expect } from 'vitest';
import {
  DATA_BASE_PATH,
  SUPPORTED_SCHEMA_VERSION,
  STORAGE_VERSION,
  FETCH_RETRY_MAX,
  UNCACHED_CHUNK_PROBABILITY,
  RECENT_BUFFER_SIZE,
} from './config';

describe('データ層設定値（第1分冊 4.13）', () => {
  it('基底パスは BASE_URL の直下の data/ を指す', () => {
    // 絶対パス '/data/' を直書きするとサブパス配信で壊れる（C-09）
    expect(DATA_BASE_PATH.startsWith('/data/')).toBe(false);
    expect(DATA_BASE_PATH.endsWith('data/')).toBe(true);
  });

  it('対応スキーマ版は配信データと一致する', () => {
    expect(SUPPORTED_SCHEMA_VERSION).toBe('1.04');
  });

  it('ユーザーデータのスキーマ版は 1.02 である', () => {
    expect(STORAGE_VERSION).toBe('1.02');
  });

  it('仕様どおりの既定値を持つ', () => {
    expect(FETCH_RETRY_MAX).toBe(2);
    expect(UNCACHED_CHUNK_PROBABILITY).toBe(0.2);
    expect(RECENT_BUFFER_SIZE).toBe(200);
  });
});
