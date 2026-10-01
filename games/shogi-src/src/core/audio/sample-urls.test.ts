/**
 * 効果音のファイルが**公開リポに実在する**か (★v1.95・威嚇音を足したときに新設)。
 *
 * 音は共通素材 (`assets/se/`) から名前で読むので、名前を書き違えても画面は動き、
 * **鳴らないだけ**で誰も気づかない。公開時の位置 (`games/shogi/`) から見た相対パスは、
 * このソースの置き場所 (`games/shogi-src/`) から見ても同じ階層になるので、そのまま確かめられる。
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_URLS } from './audio-engine';

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('効果音のファイル', () => {
  it('どの名前も、実在するファイルを指している', () => {
    for (const [name, url] of Object.entries(SAMPLE_URLS)) {
      expect(existsSync(resolve(srcRoot, url)), `${name}: ${url}`).toBe(true);
    }
  });

  it('威嚇音は MOMO Fireworks の大玉の破裂音 (ユーザー指定 2026-10-01)', () => {
    expect(SAMPLE_URLS.taunt).toMatch(/se-fireworks-burst-a\.mp3$/);
  });
});
