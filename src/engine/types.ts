export type Suit = 'circle' | 'triangle' | 'cross' | 'square' | 'star';

export const SUITS: Suit[] = ['circle', 'triangle', 'cross', 'square', 'star'];

export const SUIT_SYMBOLS: Record<Suit | 'whot', string> = {
  circle: '●',
  triangle: '▲',
  cross: '✚',
  square: '■',
  star: '★',
  whot: 'W',
};

export const SUIT_COLORS: Record<Suit | 'whot', string> = {
  circle: '#e74c3c',
  triangle: '#2ecc71',
  cross: '#3498db',
  square: '#f39c12',
  star: '#9b59b6',
  whot: '#1a1a2e',
};

export interface Card {
  id: string;
  suit: Suit | 'whot';
  number: number;
  name: string;
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  isAI: boolean;
  announcedSemiLast: boolean;
  announcedLast: boolean;
  score: number;
}

export type GamePhase =
  | 'waiting'
  | 'playing'
  | 'pick_two_pending'
  | 'whot_suit_selection'
  | 'game_over';

export type Direction = 'clockwise' | 'counter_clockwise';

export interface GameState {
  id: string;
  players: Player[];
  drawPile: Card[];
  discardPile: Card[];
  currentPlayerIndex: number;
  direction: Direction;
  phase: GamePhase;
  pickTwoPenalty: number;
  requiredSuit: Suit | null;
  winner: string | null;
  lastAction: GameAction | null;
  turnNumber: number;
  log: GameLogEntry[];
}

export type GameActionType =
  | 'play_card'
  | 'draw_card'
  | 'call_whot_suit'
  | 'announce_semi_last'
  | 'announce_last'
  | 'check_up';

export interface GameAction {
  type: GameActionType;
  playerId: string;
  card?: Card;
  suit?: Suit;
  timestamp: number;
}

export interface GameLogEntry {
  message: string;
  action: GameAction;
  timestamp: number;
}

export interface GameEvent {
  type: string;
  data: any;
}

// Standard Whot deck: each suit has specific numbers, totaling 54 cards
// Circle: 1,2,3,4,5,7,8,10,11,12,13,14 (12 cards... but we need 54 total)
// The official Naija Whot deck distribution:
export const DECK_DISTRIBUTION: Record<Suit, number[]> = {
  circle:   [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
  triangle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
  cross:    [1, 2, 3, 5, 7, 10, 11, 13, 14],
  square:   [1, 2, 3, 5, 7, 10, 11, 13, 14],
  star:     [1, 2, 3, 4, 5, 7, 8],
};
// circle(12) + triangle(12) + cross(9) + square(9) + star(7) + whot(5) = 54

export const SPECIAL_NUMBERS = {
  HOLD_ON: 1,
  PICK_TWO: 2,
  SUSPENSION: 8,
  GENERAL_MARKET: 14,
  WHOT: 20,
} as const;
