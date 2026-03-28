# WHOT AGENT — Complete Game Rules & Spec

## The Deck

- **54 cards total**
- **Five suits:** Circle, Triangle, Cross, Square, Star
- Each suit contains cards numbered **1 through 14** (70 cards across suits... but the official deck is 54, meaning not all numbers appear in every suit)
- **Five wild cards:** Whot 20

---

## Setup

1. Deal **5 cards** to each player
2. Turn the top card of the remaining draw pile face-up to start the **discard pile**
3. Play proceeds **clockwise**

---

## Core Play Rule

On your turn you **must** play a card that matches either:
- The **suit** of the top card on the discard pile, OR
- The **number** of the top card on the discard pile

If you cannot play, you **draw one card** from the market (draw pile) and your turn ends.

---

## Special Card Effects

| Number | Name             | Effect                                                                                                                                                  |
|--------|------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| **1**  | Hold On           | The next player is skipped. In a 4-player game, only the immediate next player skips. In a 2-player game, the same player plays again.                 |
| **2**  | Pick Two          | The next player picks 2 cards from the market — unless they hold a 2, in which case they play it and pass the penalty (cumulative) to the next player. |
| **8**  | Suspension        | The next player is suspended. The player who played the 8 plays again before the suspended player can resume.                                           |
| **14** | General Market    | Every opponent draws one card from the market. The player who played it plays again.                                                                    |
| **20** | Whot (Wild)       | Can be played on **any card**. The player declares which suit must be played next. Optionally reverses direction of play in some variants.              |

---

## Announcements

| Condition               | Required Call     | Penalty for Omission         |
|-------------------------|-------------------|------------------------------|
| Hand reduced to 2 cards | **"Semi last card"** | Draw 2 cards from the stock |
| Hand reduced to 1 card  | **"Last card"**      | Draw 2 cards from the stock |

---

## Winning Conditions

### Method 1 — Check Up
- Play your final card and call **"Check up!"**
- You win immediately
- Any card can be the winning card

### Method 2 — Market Exhausted
- If the draw pile runs out, all players count the face values of remaining cards in hand:
  - **Circle, Square, Cross, Triangle** cards count at **face value**
  - **Star** cards count at **double face value**
- The player with the **lowest total** wins

---

## Turn Decision Flowchart

```
START TURN
    │
    ▼
┌─────────────────────────┐
│ Check top of discard pile│
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────────┐
│ Do you have a matching card? │
│ (same suit OR same number)   │
└──────┬──────────────┬────────┘
       │ YES          │ NO
       ▼              ▼
┌─────────────┐  ┌──────────────────┐
│ Play a card  │  │ Draw 1 from market│
└──────┬──────┘  └───────┬──────────┘
       │                 │
       ▼                 ▼
┌──────────────────┐   TURN ENDS
│ Is it a special?  │
└──┬───────────┬───┘
   │ YES       │ NO
   ▼           ▼
┌────────────────────────┐
│ Apply special effect:   │
│                         │
│ 1 → Skip next player   │
│ 2 → Next picks 2       │
│     (or chains their 2) │
│ 8 → Suspend next,       │
│     you play again      │
│ 14 → All opponents      │
│      draw 1, you play   │
│      again              │
│ 20 → Declare suit,      │
│      next must follow   │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────────┐
│ Check hand size:             │
│  2 cards → say "semi last"  │
│  1 card  → say "last card"  │
│  0 cards → "CHECK UP!" WIN  │
└─────────────────────────────┘
```

---

## Edge Cases for the AI Engine

1. **Pick Two chaining:** When a 2 is played, the next player can deflect by playing their own 2. The penalty accumulates (+2 each chain) until a player cannot chain and must draw the full total.
2. **Whot 20 on anything:** The Whot card can be played regardless of the current top card. The player who plays it chooses the next required suit.
3. **Suspension vs Hold On:** Both skip the next player, but Suspension (8) grants the current player an extra turn. Hold On (1) simply skips.
4. **General Market (14) + extra turn:** After everyone else draws, the player who played the 14 takes another turn.
5. **Market depletion:** When the draw pile is empty mid-game, trigger the scoring method. Do not reshuffle the discard pile.
6. **Announcement penalties:** Must be enforced automatically — if a player reaches 2 or 1 cards without announcing, they draw 2 penalty cards before their next action.
7. **Winning card validation:** Any card (including specials) can be the final card played to win. Special effects still resolve before the win is confirmed.

---

## Architecture Notes

This spec serves as the **authoritative rule reference** for the WHOT AGENT AI engine. All game logic, validation, and AI decision-making should derive from these rules.
