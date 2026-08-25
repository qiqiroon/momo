import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { chess } from '../../../core/engine';
import type { Mgf } from '../../../core/engine/mgf/types';
import type { CustomRuleRef } from '../replay';
import { CustomRulePrompt } from './CustomRulePrompt';

/**
 * カスタムルールの定義を取り戻すパネル (S08/S11 共用・仕様 §9.2.6 ②③)。
 *
 * ここで固定したいのは 3 点。
 *   - **読めただけでは進めない**＝棋譜の参照と突き合わせ、食い違えば 3 択を出す
 *   - **3 択の行き先が 3 つとも違う**（進める／選び直す／中止）
 *   - **定義として読めないものはパネルを壊さない**（言葉で伝えて選び直させる）
 */

/**
 * 選ばせるファイルの代わり。**検査環境の jsdom は Blob.text() を持たない**ので、
 * コードベース慣例の疑似ファイルを使う（kifu.test.ts と同じ形）。
 */
const fakeFile = (text: string) => ({ text: async () => text }) as unknown as File;

/** チェスの定義を土台に、名前・版だけ差し替えた定義ファイルを作る。 */
function mgfFile(over: { game_name?: string; version?: string } = {}): File {
  const json = JSON.parse(JSON.stringify(chess)) as Mgf;
  if (over.game_name !== undefined) json.metadata.game_name = over.game_name;
  if (over.version !== undefined) json.metadata.version = over.version;
  return fakeFile(JSON.stringify(json));
}

/** 棋譜が持つ参照。既定はチェスの定義とぴったり合う。 */
function refOf(over: Partial<CustomRuleRef> = {}): CustomRuleRef {
  return {
    id: chess.metadata.game_id,
    name: chess.metadata.game_name,
    version: chess.metadata.version,
    ...over,
  };
}

/** 隠してあるファイル選択に、選んだファイルを渡す。 */
async function choose(file: File): Promise<void> {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

describe('ルール定義パネル — 一致確認と 3 択 (段2b・§9.2.6 ③)', () => {
  let onChoose: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onChoose = vi.fn();
    onCancel = vi.fn();
  });

  function show(kifuRef: CustomRuleRef = refOf()) {
    render(
      <CustomRulePrompt locale="ja" kifuRef={kifuRef} onChoose={onChoose} onCancel={onCancel} />,
    );
  }

  it('一致する定義を選んだら、3 択を出さずにそのまま進む', async () => {
    show();
    await choose(mgfFile());
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0][0].metadata.game_id).toBe(chess.metadata.game_id);
    expect(screen.queryByText('そのまま進める')).toBeNull();
  });

  it('★名前が違う定義を選んだら、進まずに 3 択を出す', async () => {
    show(refOf({ name: 'ぐるぐる大砲将棋' }));
    await choose(mgfFile());
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.getByText('そのまま進める')).toBeTruthy();
    expect(screen.getByText('別のファイルを選ぶ')).toBeTruthy();
    expect(screen.getByText('中止する')).toBeTruthy();
  });

  it('★版だけが違う定義も「不一致」に数える (§9.2.6 明文)', async () => {
    show(refOf({ version: '0.0.1' }));
    await choose(mgfFile());
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.getByText('そのまま進める')).toBeTruthy();
  });

  it('食い違いの画面は、棋譜側と選んだ定義側の**両方**の名前と版を見せる', async () => {
    show(refOf({ name: 'ぐるぐる大砲将棋', version: '0.0.1' }));
    await choose(mgfFile());
    expect(screen.getByText('棋譜の記録')).toBeTruthy();
    expect(screen.getByText('選んだ定義')).toBeTruthy();
    expect(screen.getByText('ぐるぐる大砲将棋')).toBeTruthy();
    expect(screen.getByText('0.0.1')).toBeTruthy();
    expect(screen.getByText(chess.metadata.game_name)).toBeTruthy();
  });

  it('★「そのまま進める」＝選んだ定義で進む (食い違ったままでも)', async () => {
    show(refOf({ version: '0.0.1' }));
    await choose(mgfFile());
    fireEvent.click(screen.getByText('そのまま進める'));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0][0].metadata.version).toBe(chess.metadata.version);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('★「中止する」＝どちらも進めない (棋譜は開かない)', async () => {
    show(refOf({ version: '0.0.1' }));
    await choose(mgfFile());
    fireEvent.click(screen.getByText('中止する'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('★「別のファイルを選ぶ」＝ファイル選択を開き直し、3 択は引っ込む', async () => {
    const clicked = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    show(refOf({ version: '0.0.1' }));
    await choose(mgfFile());
    fireEvent.click(screen.getByText('別のファイルを選ぶ'));
    // **その場で開く**＝押した勢いのまま開かないと携帯で開けない（新しいクリックで開く）。
    expect(clicked).toHaveBeenCalled();
    expect(screen.queryByText('そのまま進める')).toBeNull();
    expect(onChoose).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    clicked.mockRestore();
  });

  it('選び直して一致する定義を渡せば、そこで進む', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    show();
    await choose(mgfFile({ version: '9.9.9' }));
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('別のファイルを選ぶ'));
    await choose(mgfFile());
    expect(onChoose).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('定義として読めないファイルは、3 択にせず言葉で伝える', async () => {
    show();
    await choose(fakeFile('{ こわれた'));
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.queryByText('そのまま進める')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('版を記録していない棋譜でも、欄を空にしない', () => {
    show({ id: 'x', name: 'ぐるぐる大砲将棋' });
    expect(screen.getByText('（記録なし）')).toBeTruthy();
  });
});
