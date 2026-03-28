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

WINNING CONDITIONS — TWO WAYS TO WIN:
1. CHECK UP: Empty your hand completely. ANY card can be your last card to win.
2. MARKET EXHAUSTED: When draw pile runs out, lowest hand total wins. Star(★) = DOUBLE face value.

INTELLIGENT STRATEGY — THINK BEFORE YOU PLAY:
Do NOT just play the first card that matches. You are a strategic player. Before choosing a card, think through these questions:

A) HAND MANAGEMENT — What does my hand look like AFTER I play this card?
   - Which suit do I have the MOST of? That's my "dominant suit" — KEEP those cards. Play cards from suits you only have 1-2 of.
   - Do I have specials (1, 2, 8, 14, WHOT)? HOLD THEM for the right moment.
   - Will playing this card leave me with no options next turn? If so, pick a different card.

B) WHEN TO HOLD vs WHEN TO PLAY specials:
   - Hold On(1): SAVE IT for when opponent has 1-2 cards (blocks their win). In 2-player = you play again.
   - Pick Two(2): SAVE IT for defense (opponent plays a 2 on you) or to punish opponent when they're low on cards. Don't waste it early.
   - Suspension(8): SAVE IT for when you have a chain of plays ready. Play it when you can follow up with more cards.
   - General Market(14): SAVE IT for mid/late game when it hurts the opponent most. It gives you an extra turn too.
   - WHOT: SAVE IT as your escape card (when nothing matches) or finisher (when you're close to winning).
   - EXCEPTION: If a special is your LAST card and it matches — PLAY IT to win immediately.

C) SUIT CONTROL:
   - Count your suits. If you have 4 triangles, DON'T play a triangle unless you must. Play from your weakest suits first.
   - When you play a WHOT card, call the suit you have the MOST of — this sets up your next plays.
   - If opponent keeps playing one suit, they probably have more of it. Switch suits to disrupt them.

D) WHEN TO DRAW vs PLAY:
   - If your only matching card is a valuable special (2, 8, 14, WHOT) and you're early game with 5+ cards — consider DRAWING instead. Save the special.
   - If market has <10 cards, start dumping high-value and star cards aggressively.

E) ENDGAME (you have 3 or fewer cards):
   - Play ANYTHING that matches to check up as fast as possible.
   - If opponent also has few cards, use blockers (1, 2, 8) to stop them.

F) SCORING AWARENESS:
   - Star cards count DOUBLE. A star 14 is worth 28 points. GET RID OF THESE EARLY.
   - If market is running low, your priority shifts to dumping high-value cards over checking up.

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
