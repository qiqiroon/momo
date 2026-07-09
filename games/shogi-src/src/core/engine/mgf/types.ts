export type Player = 'player1' | 'player2';

export interface MgfMetadata {
  game_name: string;
  game_id: string;
  author?: string;
  version?: string;
  description?: string;
  base_game?: string;
}

export interface MgfBoard {
  width: number;
  height: number;
  coordinate: 'shogi' | 'chess';
  promotion_zone?: {
    player1?: { min_rank: number; max_rank: number };
    player2?: { min_rank: number; max_rank: number };
  };
  sfen_support?: boolean;
}

export type MgfDirection =
  | 'all_8'
  | 'forward'
  | 'backward'
  | 'sideways'
  | 'diagonal'
  | 'forward_diagonal'
  | 'backward_diagonal'
  | 'knight'
  | 'knight_8';

export type MgfAbilityType = 'step' | 'slide' | 'jump';

export interface MgfAbility {
  type: MgfAbilityType;
  direction: MgfDirection;
  range: number;
  jump_over?: boolean;
  can_capture?: boolean;
  can_move_to_empty?: boolean;
}

export interface MgfMoveLogic {
  actions_per_turn?: number;
  can_stop_midway?: boolean;
  abilities: MgfAbility[];
  composite?: unknown[];
}

export interface MgfPieceDef {
  id: string;
  name: string;
  is_royal?: boolean;
  can_promote: boolean;
  promoted_id?: string;
  must_promote_at?: number;
  is_hand_piece?: boolean;
  score?: number;
  visibility?: { owner: boolean; opponent: boolean };
  immovable?: boolean;
  move_logic?: MgfMoveLogic;
}

export type MgfPlacementFormat = 'sfen' | 'matrix' | 'list';

export interface MgfPlacementListItem {
  piece: string;
  owner: Player;
  x: number;
  y: number;
}

export interface MgfInitialPlacement {
  format: MgfPlacementFormat;
  sfen?: string;
  matrix?: string[][];
  list?: MgfPlacementListItem[];
  placement_ref?: string;
}

export interface MgfConstraints {
  nifu?: boolean;
  uchifu_tsume?: boolean;
  suicide?: boolean;
  dead_zone?: 'auto' | boolean;
}

export interface MgfVictory {
  royal_capture?: boolean;
  enter_zone?: {
    enabled?: boolean;
    method?: 'points' | 'entered';
    points?: { player1?: number; player2?: number };
  };
}

export interface MgfRepetition {
  type?: 'sennichite' | 'perpetual_check';
  count?: number;
  action?: 'draw' | 'win_attacker' | 'no_repeat';
}

export interface Mgf {
  metadata: MgfMetadata;
  board: MgfBoard;
  compatible_modifiers?: {
    torus?: { cylinder?: boolean; full_torus?: boolean };
    quantum?: { enabled?: boolean; allowed_patterns?: string[] };
  };
  pieces: MgfPieceDef[];
  constraints?: MgfConstraints;
  capture_rules?: unknown;
  victory?: MgfVictory;
  repetition?: MgfRepetition;
  initial_placement: MgfInitialPlacement;
}
