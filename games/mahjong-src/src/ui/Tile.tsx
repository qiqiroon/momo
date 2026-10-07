import type { Rules } from '../engine/rules';
import { HIDDEN } from '../engine/events';
import { codeOf, type TileId } from '../engine/tiles';
import { tileUrl } from './tileImage';

interface Props {
  id: TileId;
  rules: Rules | null;
  className?: string;
}

/** 牌 1 枚。絵は <img> で読む（SVG を直接埋め込むと色が混ざる） */
export function Tile({ id, rules, className = '' }: Props) {
  const hidden = id === HIDDEN;
  return (
    <span className={`tile${hidden ? ' tile-back' : ''}${className ? ` ${className}` : ''}`} data-tile={hidden ? undefined : codeOf(id)}>
      <img src={tileUrl(id, rules)} alt={hidden ? '' : codeOf(id)} draggable={false} />
    </span>
  );
}
