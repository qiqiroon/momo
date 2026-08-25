/**
 * 棋譜 1 局を人が読める文字にする（S08 のメタ帯と一覧の行・付録D-8 §3／§7）。
 *
 * **組み立てる材料はファイル先頭の素性 (meta) だけ**（親 §9.2.2）。
 * ファイル名からは読み戻さない＝名前はユーザーが自由に変えられるので正本ではない。
 */

import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import type { KifuFile } from '../types';

export type SortKey = 'date' | 'opponent' | 'rule' | 'result';

export function kifuLabels(locale: LocaleCode) {
  const t = (key: string) => _t(key, locale);

  /** ルールの名前。未知のルールは「カスタム」に寄せる（名札で分岐させない）。 */
  const ruleName = (f: KifuFile): string => {
    if (f.meta.gameType === 'shogi') return t('s02.ruleHongi.name');
    if (f.meta.gameType === 'hasami') return t('s02.ruleHasami.name');
    // 読み込みのカスタムルール (チェス等・§5.0) は、棋譜が持っている参照の名前を出す
    // (§9.2.6)。参照を持たない古い棋譜は汎用の「カスタム」に落ちる。
    return f.meta.customRule?.name || t('s02.ruleCustom.name');
  };

  /** 変則条件のバッジ。無いものは欄ごと出さない。 */
  const modifiers = (f: KifuFile): string[] => {
    const out: string[] = [];
    if (f.meta.quantum) out.push(t('s02.quantum'));
    if (f.meta.torus === 'cylinder') out.push(t('s02.torusCyl'));
    if (f.meta.torus === 'full') out.push(t('s02.torusFull'));
    return out;
  };

  /** 対局者 1 人分。名乗っていなければ先手／後手で呼ぶ（空欄にしない）。 */
  const playerName = (f: KifuFile, side: 'player1' | 'player2'): string => {
    const p = f.meta.players[side];
    if (p.kind === 'ai') return p.level ? `AI (${p.level})` : 'AI';
    if (p.name) return p.name;
    return t(side === 'player1' ? 's07.senteLbl' : 's07.goteLbl');
  };

  /**
   * 盤の上下に出す対局者の行（v1.43・2026-08-17 ユーザー報告）。
   *
   * **名前だけでは、どちらが先手か分からない**（ネット対戦では下が自分とも限らない）。
   * **印と「先手／後手」の語を名前の前に置く**＝`▲先手：太郎`。
   * 名乗っていない人は `playerName` が先手／後手を返すので、そのときは語を重ねない。
   */
  const playerLabel = (f: KifuFile, side: 'player1' | 'player2'): string => {
    const mark = side === 'player1' ? '▲' : '△';
    const sideWord = t(side === 'player1' ? 's07.senteLbl' : 's07.goteLbl');
    const name = playerName(f, side);
    return name === sideWord ? `${mark}${sideWord}` : `${mark}${sideWord}：${name}`;
  };

  const players = (f: KifuFile): string =>
    `☗${playerName(f, 'player1')} ─ ☖${playerName(f, 'player2')}`;

  /** 日付。素性の時刻は端末の時刻帯のまま書いてあるので、頭から切り出すだけでよい。 */
  const date = (f: KifuFile): string => f.meta.savedAt.slice(0, 16).replace('T', ' ');

  /** 結果＝手数と勝敗。終局理由は S07 の言い回しをそのまま借りる。 */
  const result = (f: KifuFile): string => {
    const count = `${f.meta.moveCount}${t('s08.moveCount')}`;
    const { status, winner } = f.meta.result;
    if (status === 'nogame') return `${count}・${t('result.verdict.nogame')}`;
    if (winner === 'player1') return `${count}・${t('result.verdict.senteWin')}`;
    if (winner === 'player2') return `${count}・${t('result.verdict.goteWin')}`;
    if (status === 'playing') return count;
    return `${count}・${t('result.verdict.draw')}`;
  };

  /** 誰と指したか。並べ替えの見出しにも使う。 */
  const opponentKind = (f: KifuFile): string =>
    t(
      f.meta.opponent === 'com'
        ? 's08.oppCom'
        : f.meta.opponent === 'net'
          ? 's08.oppNet'
          : // ★v1.60: 観戦した対局（親 §6.8.6）。**指していないので別の言葉で出す**。
            f.meta.opponent === 'watch'
            ? 's08.oppWatch'
            : 's08.oppF2f',
    );

  /** 並べ替え。日付だけは**新しい順**（他は文字の順）。 */
  const comparator = (key: SortKey) => (a: KifuFile, b: KifuFile): number => {
    if (key === 'date') return b.meta.savedAt.localeCompare(a.meta.savedAt);
    if (key === 'rule') return ruleName(a).localeCompare(ruleName(b));
    if (key === 'result') return result(a).localeCompare(result(b));
    return players(a).localeCompare(players(b));
  };

  return {
    ruleName,
    modifiers,
    playerName,
    playerLabel,
    players,
    date,
    result,
    opponentKind,
    comparator,
  };
}
