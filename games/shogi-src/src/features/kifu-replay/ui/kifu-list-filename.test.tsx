/**
 * ★画面機能 v0.61 §3 S08: 棋譜の一覧にファイル名を添える (2026-10-16 利用者の指示)。
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KifuListModal } from './KifuListModal';
import { parseKifu, readKifuFile, rememberKifuFileName } from '../io';
import { listFolderKifu } from '../index';
import type { KifuFile } from '../types';
import type { FsDirHandle } from '../folder';

const KIFU: KifuFile = {
  format: 'momo-shogi-kifu',
  version: 1,
  meta: {
    savedAt: '2026-10-16T10:00:00+09:00',
    opponent: 'com',
    gameType: 'shogi',
    quantum: false,
    torus: 'none',
    handicap: null,
    players: { player1: { name: 'A', kind: 'human' }, player2: { name: 'B', kind: 'human' } },
    viewerSide: null,
    result: { status: 'playing', winner: null },
    moveCount: 0,
    timeControl: { mode: 'no_limit', mainSeconds: 0 },
  },
  moves: [],
  moveTexts: [],
};
const TEXT = JSON.stringify(KIFU);
/** 検査の土台 (jsdom) の Blob は text() を持たないので、持つものを作る。 */
const fakeFile = (name: string, text: string) => ({ name, text: async () => text }) as unknown as File;

const modal = (files: KifuFile[], folderName: string | null) =>
  render(
    <KifuListModal
      locale="ja"
      remembered={null}
      rememberedState="empty"
      loaded={folderName ? [] : files}
      folderName={folderName}
      folderFiles={folderName ? files : []}
      folderBusy={false}
      onChangeFolder={() => {}}
      onPick={() => {}}
      onRequestLoad={() => {}}
      onSave={() => {}}
      saving={false}
      onClose={() => {}}
    />,
  );

describe('棋譜の一覧のファイル名 (★画面機能 v0.61)', () => {
  it('フォルダから読んだ棋譜は、行にファイル名が出る', async () => {
    const dir = {
      name: 'kifu',
      async *values() {
        yield { kind: 'file', name: '10_四間飛車_居飛車穴熊_29.json', getFile: async () => fakeFile('', TEXT) };
        yield { kind: 'file', name: 'メモ.txt', getFile: async () => fakeFile('', 'x') };
      },
    } as unknown as FsDirHandle;
    const files = await listFolderKifu(dir);
    expect(files).toHaveLength(1);
    modal(files, 'kifu');
    expect(screen.getByText('10_四間飛車_居飛車穴熊_29.json')).toBeTruthy();
  });

  it('ファイルを選んで読み込んだ棋譜も、行にファイル名が出る', async () => {
    const file = await readKifuFile(fakeFile('選んだ棋譜.json', TEXT));
    modal([file], null);
    expect(screen.getByText('選んだ棋譜.json')).toBeTruthy();
  });

  it('名前の分からない棋譜 (ブラウザが覚えている 1 局など) は名前の段を出さない', () => {
    const { container } = modal([parseKifu(TEXT)], null);
    expect(container.querySelector('.kcard .r3')).toBeNull();
  });

  it('名前を添えても棋譜の中身は変わらない (見せるだけ)', () => {
    const f = parseKifu(TEXT);
    rememberKifuFileName(f, 'x.json');
    expect(JSON.stringify(f)).toBe(TEXT);
  });
});
