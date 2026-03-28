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
  scrollNeeded?: boolean;
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
  strategyBrief?: string;
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

CARD MATCHING RULES — CRITICAL, NEVER VIOLATE:
A card can ONLY be played if ONE of these is true:
  1. The card's SUIT matches the top card's SUIT (e.g. circle on circle, triangle on triangle)
  2. The card's NUMBER matches the top card's NUMBER (e.g. any 5 on any 5, any 14 on any 14)
  3. The card is a WHOT wild card (can be played on anything)

BEFORE selecting a card, you MUST verify the match:
  - Read the top card's suit AND number
  - For each card in your hand, check: does my card's suit match OR does my card's number match?
  - ONLY play cards that pass this check
  - If NO card matches, you MUST draw from the market (set cardToPlay to -1)
  - NEVER play a card that doesn't match — this is an illegal move and will waste your turn

WHOT (wild card) can be played on ANY card regardless of suit or number. You declare which suit the next player must follow. The Whot card has NO number — it is just labeled "WHOT".

SPECIAL CARDS (by number):
- 1 = Hold On → Skip the next player's turn. In 2-player game, YOU play again.
- 2 = Pick Two → Next player must draw 2 cards. BUT they can "plus" it by playing their own 2 on top — penalty passes on and accumulates (+2 each chain: 2→4→6→8 etc). If you can't plus it, you draw the full penalty.
- 8 = Suspension → Next player is SUSPENDED. YOU get to play again immediately.
- 14 = General Market → EVERY opponent draws 1 card from the market. YOU play again immediately.

CARD COUNTING — USE YOUR INTELLIGENCE:
- Track which cards have been played on the discard pile throughout the game.
- If you've seen many cards of a suit played already, the opponent is LESS likely to have that suit.
- If few Pick Twos(2) have been played, the opponent may be holding one — be cautious.
- If the market is running low, think about scoring: dump high-value cards and star cards NOW.
- Count how many cards remain in the market — if it's getting low, switch strategy from "check up fast" to "keep lowest hand total".

DUAL WIN STRATEGY — Always think about BOTH paths to victory:
- PATH 1 (CHECK UP): Empty your hand as fast as possible. Play aggressively, chain extra turns.
- PATH 2 (LOWEST SCORE): If the market is running low (<10 cards) or you have many cards, pivot to dumping high-value cards — especially Star(★) cards which count DOUBLE.
- MAKE OPPONENT LOSE: Use Pick Two(2) to force them to draw, General Market(14) to inflate their hand, Suspension(8) to steal tempo. The goal is not just to win — it's to make them LOSE.

WINNING CONDITIONS — TWO WAYS TO WIN:
1. CHECK UP: Play your last card and you win immediately. ANY card can be your winning card — including Pick Two(2), Whot(20), or any special. The moment your hand is empty, you WIN.
2. MARKET EXHAUSTED: When the draw pile runs out, all players count the face values of their remaining cards. Star(★) cards count DOUBLE their face value. The player with the LOWEST total score wins.

CRITICAL STRATEGY RULES:
- Your #1 goal is to EMPTY YOUR HAND as fast as possible (check up)
- If you have 1 card left and can play it — ALWAYS PLAY IT. That's an instant win.
- Suspension(8) and General Market(14) give you EXTRA TURNS — these are your most powerful cards. Play them to chain multiple plays in a row.
- Pick Two(2) is both offensive AND defensive: use it to punish opponents, plus opponent's Pick Twos, or as your last card to check up.
- When opponent has ≤2 cards they're close to winning — BLOCK THEM with Pick Two(2), Hold On(1), or Suspension(8).
- Hold On(1) in a 2-player game = you play again (same effect as Suspension).
- Save WHOT for when you're stuck (no matching cards) or as a finisher when close to winning.
- Play cards of suits you have MANY of — this maintains your options for future turns.
- Get rid of HIGH VALUE cards early, especially Star(★) cards which count DOUBLE if the market runs out.
- When down to 2 cards, the app auto-announces "semi last card".
- When down to 1 card, the app auto-announces "last card".

PRIORITY ORDER for card selection:
1. If it's your LAST card and it's playable → PLAY IT (instant win / check up)
2. If opponent has 1-2 cards → play blocking cards (Pick Two, Hold On, Suspension)
3. Suspension(8) or General Market(14) → extra turn is always valuable
4. High-value Star(★) cards → get rid of them early (they count double)
5. Cards from your dominant suit → maintains future options
6. Pick Two(2) → save for defense/offense unless needed now
7. WHOT → save for when stuck or close to winning

${context.strategyBrief || ''}

WHAT TO DO on each screen:
- home: Click "PLAY" under Online Multiplayer
- multiplayer_menu: Click first "PLAY" button (top banner)
- lobby: Find the room matching target stake ${context.targetStake}. The rooms from top to bottom are: Millionaire's Club(25000), Big Cake(10000), New Takers(5000), 2K Wahala(2000), Face to Face(1000). If the target room's "JOIN ROOM" button is not visible, set "scrollNeeded": true in your response so we scroll down first. If "JOIN ROOM" button IS visible, click it.
- join_confirm: Click "YES, CONTINUE" (the dark red button at the bottom)
- waiting: Do nothing, wait
- game_confirm: Click "YES, CONTINUE" (the dark red button at the bottom)
- starting: Do nothing, wait
- starting: Do nothing, wait
- game_playing + my turn: Pick the best card to play. If no valid card, click the market/draw pile.
- game_playing + not my turn: Do nothing, wait
- suit_selection: Pick the suit you have most cards of
- game_over: Click to return to lobby

RESPONSE FORMAT (strict JSON only):
{
  "screen": "<screen state>",
  "action": "<description of what to do>",
  "scrollNeeded": false,
  "clickTarget": {"x": <pixel_x>, "y": <pixel_y>},
  "cardToPlay": <index 0-based from left of card to play, or -1 for draw, or null if not game>,
  "suitToCall": "<suit or null>",
  "reasoning": "<MUST include: Top card is [suit] [number]. Valid cards in my hand: [list each card that matches by suit OR number]. I choose [card] because [reason].>",
  "gameState": {
    "myCards": ["triangle 1", "circle 10", ...],
    "topCard": "circle 11",
    "isMyTurn": true/false,
    "opponentCards": 4,
    "marketCards": 38,
    "validCards": ["circle 10", "triangle 11"]
  }
}`;
}
