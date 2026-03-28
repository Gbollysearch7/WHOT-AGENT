import { readFileSync } from 'fs';

// Screen states the bot can detect
export type ScreenState =
  | 'login'
  | 'home'
  | 'multiplayer_menu'
  | 'lobby'
  | 'join_confirm'
  | 'waiting'
  | 'game_confirm'
  | 'starting'
  | 'game_playing'
  | 'suit_selection'
  | 'game_over'
  | 'unknown';

export type Suit = 'circle' | 'triangle' | 'cross' | 'square' | 'star' | 'whot';

export interface CardInfo {
  suit: Suit;
  number: number;
  position: { x: number; y: number };
}

export interface GameStateVision {
  screen: ScreenState;
  myCards: CardInfo[];
  topCard: CardInfo | null;
  isMyTurn: boolean;
  opponentCardCount: number;
  marketCardCount: number;
  balance: number;
  buttons: ButtonInfo[];
}

export interface ButtonInfo {
  label: string;
  position: { x: number; y: number };
}

// Since we're analyzing screenshots with Claude's vision, we'll send
// the screenshot to Claude API for analysis. But for the local bot,
// we use a simpler approach: known positions + pixel color sampling.

// Based on the screenshots provided, here are the key screen layouts:

// ═══════════════════════════════════════════════════
// SCREEN DETECTION via known UI elements
// ═══════════════════════════════════════════════════

// The approach: We capture a screenshot, then use image analysis
// to determine what screen we're on and extract game state.
// Since we can't run a full ML model locally in real-time,
// we'll use Claude API for vision analysis of each frame.

export interface AnalysisResult {
  screen: ScreenState;
  action: string;
  clickTarget?: { x: number; y: number };
  cardToPlay?: number; // index of card in hand to play
  suitToCall?: Suit;
  reasoning: string;
  gameState?: {
    myCards: string[];
    topCard: string;
    isMyTurn: boolean;
    opponentCards: number;
    marketCards: number;
  };
}

export function buildAnalysisPrompt(context: {
  targetStake: number;
  previousState?: ScreenState;
}): string {
  return `You are an AI autopilot for the Whoto Whoto card game app. Analyze this screenshot and respond with ONLY valid JSON (no markdown, no backticks).

CONTEXT:
- Target stake room: ${context.targetStake} coins
- Previous screen state: ${context.previousState || 'unknown'}

SCREEN DETECTION - Identify which screen this is:
- "home": Main menu with "Online Multiplayer", "Play vs Friends", "Play with AI" buttons
- "multiplayer_menu": Sub-menu with 3 play mode banners
- "lobby": Room list showing stake rooms (Millionaire's Club 25000, Big Cake 10000, New Takers 5000, 2K Wahala 2000, Face to Face 1000)
- "join_confirm": Dialog "Join Lobby? Are you sure you want to join this room for" with NO/YES,CONTINUE buttons
- "waiting": Whoto Whoto logo, "Waiting for other players..." with timer and Leave Lobby button
- "game_confirm": Dialog "Continue? Are you sure you want to proceed with the game?" with NO/YES,CONTINUE buttons
- "starting": "Starting Game" text with timer at 00:00
- "game_playing": Game board with oval green table, cards in hand at bottom, discard pile center
- "suit_selection": Popup asking to choose a suit (circle/triangle/cross/square/star)
- "game_over": Game results screen
- "login": Login/signup screen
- "unknown": Cannot determine

GAME ANALYSIS (only if screen is "game_playing"):
1. Read ALL cards in your hand (bottom of screen). Each card has a SHAPE (circle=●, triangle=▲, cross=✚, square=■, star=★) and a NUMBER.
2. Read the TOP CARD on the discard pile (center of the green table).
3. Check if it's your turn (green bar at top saying "Your Turn").
4. Count opponent's cards (shown next to their avatar).
5. Read market/draw pile count (shown below the face-down pile).

CARD MATCHING RULES:
- You can play a card if it matches the TOP CARD's SUIT or NUMBER
- WHOT (20) can be played on anything — you then choose a suit
- Special cards: 1=Hold On(skip), 2=Pick Two(chain), 8=Suspension(play again), 14=General Market(all draw 1, play again)

STRATEGY (when it's your turn):
- If opponent has ≤2 cards: play Pick Two(2) or Hold On(1) to block them
- Suspension(8) and General Market(14) give you extra turns — very valuable
- Save WHOT(20) for when you're stuck or close to winning
- Play cards of suits you have many of (maintain suit dominance)
- Get rid of high-value cards early (star cards count DOUBLE in scoring)
- When down to 2 cards, the app auto-announces "semi last card"
- When down to 1 card, the app auto-announces "last card"

WHAT TO DO on each screen:
- home: Click "PLAY" under Online Multiplayer
- multiplayer_menu: Click first "PLAY" button (top banner)
- lobby: Find the room matching target stake ${context.targetStake}, click its "JOIN ROOM" button
- join_confirm: Click "YES, CONTINUE"
- waiting: Do nothing, wait
- game_confirm: Click "YES, CONTINUE"
- starting: Do nothing, wait
- game_playing + my turn: Pick the best card to play. If no valid card, click the market/draw pile.
- game_playing + not my turn: Do nothing, wait
- suit_selection: Pick the suit you have most cards of
- game_over: Click to return to lobby

RESPONSE FORMAT (strict JSON only):
{
  "screen": "<screen state>",
  "action": "<description of what to do>",
  "clickTarget": {"x": <pixel_x>, "y": <pixel_y>},
  "cardToPlay": <index 0-based from left of card to play, or -1 for draw, or null if not game>,
  "suitToCall": "<suit or null>",
  "reasoning": "<brief explanation>",
  "gameState": {
    "myCards": ["triangle 1", "circle 10", ...],
    "topCard": "circle 11",
    "isMyTurn": true/false,
    "opponentCards": 4,
    "marketCards": 38
  }
}`;
}
