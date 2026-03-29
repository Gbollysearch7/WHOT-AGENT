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

export interface VisionResult {
  screen: ScreenState;
  gameState?: {
    myCards: string[];    // e.g. ["triangle 1", "circle 10", "whot"]
    topCard: string;      // e.g. "circle 11"
    isMyTurn: boolean;
    opponentCards: number;
    marketCards: number;
    requiredSuit?: string; // if WHOT was played, what suit is required
  };
  suitOptions?: string[]; // if suit_selection screen
  scrollNeeded?: boolean;
}

// READ-ONLY prompt — Claude only reads the screen, does NOT decide strategy
export function buildReadOnlyPrompt(targetStake: number): string {
  return `You are a screen reader for a card game app called Whoto Whoto. Read the screenshot and return ONLY valid JSON. Do NOT suggest strategy or which card to play.

SCREEN TYPES — identify which one this is:
- "home": Main menu with "Online Multiplayer", "Play vs Friends", "Play with AI"
- "multiplayer_menu": Sub-menu with 3 play mode banners with PLAY buttons
- "lobby": Room list with stake rooms (Millionaire's Club 25000, Big Cake 10000, New Takers 5000, 2K Wahala 2000, Face to Face 1000). Each has a JOIN ROOM button.
- "join_confirm": Dialog asking "Join Lobby?" or "Are you sure" with NO and YES,CONTINUE buttons
- "waiting": "Waiting for other players..." with timer and Leave Lobby button
- "game_confirm": Dialog "Continue? Are you sure you want to proceed" with NO and YES,CONTINUE buttons
- "starting": "Starting Game" text with timer
- "game_playing": Game board — oval green table, cards at bottom, discard pile in center
- "suit_selection": Popup with 5 suit choices (circle, triangle, cross, square, star)
- "game_over": Results screen showing winner
- "unknown": Cannot determine

IF SCREEN IS "game_playing", read these carefully:
1. YOUR HAND: Read each card at the bottom of the screen from LEFT to RIGHT. Each card shows a SHAPE and a NUMBER.
   Shapes: circle(●/red dot), triangle(▲), cross(✚/+), square(■), star(★)
   Valid numbers: 1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14
   There are NO cards with numbers 6, 9, 15, or 16.
   WHOT cards show "WHOT" with no number.
   Format each card as "suit number" (e.g. "triangle 5", "circle 14", "whot")

2. TOP CARD: The face-up card on the discard pile in the center of the table. Read its shape and number.

3. IS IT YOUR TURN: Look for a green bar at the top that says "Your Turn". If visible and active = true.

4. OPPONENT CARDS: Read the number shown next to opponent avatar (e.g. "4 Card(s)")

5. MARKET CARDS: Read the number shown below the face-down pile (e.g. "38 Card(s)")

6. REQUIRED SUIT: If a suit icon is highlighted or required (after WHOT was played), note which suit.

IF SCREEN IS "lobby":
- Check if the ${targetStake} room's JOIN ROOM button is visible on screen
- If not visible (need to scroll), set scrollNeeded: true

RESPONSE — strict JSON only, no markdown:
{
  "screen": "<screen type>",
  "gameState": {
    "myCards": ["suit number", "suit number", ...],
    "topCard": "suit number",
    "isMyTurn": true/false,
    "opponentCards": 4,
    "marketCards": 38,
    "requiredSuit": null
  },
  "scrollNeeded": false
}

Only include gameState if screen is "game_playing". Only include scrollNeeded if screen is "lobby".`;
}
