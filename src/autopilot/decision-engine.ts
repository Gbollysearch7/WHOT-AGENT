import { Suit, SUITS, DECK_DISTRIBUTION } from '../engine/types.js';
import { ParsedCard, cardKey, cardDisplay } from './card-normalizer.js';
import { TrackedGameState } from './state-tracker.js';

export interface ScoredCard {
  card: ParsedCard;
  index: number;
  score: number;
  reasons: string[];
  isValid: boolean;
}

export interface Decision {
  action: 'play' | 'draw';
  cardIndex: number;        // -1 for draw
  card: ParsedCard | null;
  score: number;
  reasoning: string;
  allScores: ScoredCard[];  // for debugging
  suitToCall?: Suit;        // if playing WHOT
}

// Check if a card can legally be played on the top card
function canPlay(card: ParsedCard, topCard: ParsedCard, requiredSuit?: Suit | null): boolean {
  // WHOT can always be played
  if (card.suit === 'whot') return true;

  // If a suit was required (after WHOT was played), must match that suit
  if (requiredSuit) {
    return card.suit === requiredSuit || card.number === topCard.number;
  }

  // Match suit OR number
  if (card.suit === topCard.suit) return true;
  if (card.number !== null && topCard.number !== null && card.number === topCard.number) return true;

  return false;
}

// Get the score value of a card (for market exhaustion scoring)
function cardScoreValue(card: ParsedCard): number {
  if (card.suit === 'whot') return 20;
  if (card.suit === 'star') return (card.number || 0) * 2;
  return card.number || 0;
}

// Find the best suit to call when playing WHOT
function chooseBestSuit(hand: ParsedCard[]): Suit {
  const counts: Record<string, number> = {};
  for (const s of SUITS) counts[s] = 0;
  for (const card of hand) {
    if (card.suit !== 'whot') {
      counts[card.suit]++;
    }
  }
  let best: Suit = 'circle';
  let max = 0;
  for (const [suit, count] of Object.entries(counts)) {
    if (count > max) {
      max = count;
      best = suit as Suit;
    }
  }
  return best;
}

// 1-turn lookahead: if I play this card, can I play again from my remaining hand?
function hasFollowUp(card: ParsedCard, hand: ParsedCard[], cardIndex: number): boolean {
  const remaining = hand.filter((_, i) => i !== cardIndex);
  // The card I play becomes the new top card
  for (const nextCard of remaining) {
    if (canPlay(nextCard, card)) return true;
  }
  return false;
}

// Count how many follow-up plays exist
function countFollowUps(card: ParsedCard, hand: ParsedCard[], cardIndex: number): number {
  const remaining = hand.filter((_, i) => i !== cardIndex);
  let count = 0;
  for (const nextCard of remaining) {
    if (canPlay(nextCard, card)) count++;
  }
  return count;
}

export function makeDecision(state: TrackedGameState, requiredSuit?: Suit | null): Decision {
  const { myHand, topCard, opponentCardCount, marketCount } = state;

  if (!topCard || myHand.length === 0) {
    return {
      action: 'draw',
      cardIndex: -1,
      card: null,
      score: 0,
      reasoning: 'No cards or no top card visible',
      allScores: [],
    };
  }

  // Score every card
  const scored: ScoredCard[] = myHand.map((card, index) => {
    const valid = canPlay(card, topCard, requiredSuit);
    const reasons: string[] = [];
    let score = 0;

    if (!valid) {
      return { card, index, score: -99999, reasons: ['illegal move'], isValid: false };
    }

    // ═══════════════════════════════════════════
    // SCORING FACTORS
    // ═══════════════════════════════════════════

    // 1. INSTANT WIN — last card playable
    if (myHand.length === 1) {
      score += 10000;
      reasons.push('LAST CARD → CHECK UP!');
      return { card, index, score, reasons, isValid: true };
    }

    // 2. NEAR WIN — 2 cards left, play anything to get to 1
    if (myHand.length === 2) {
      score += 5000;
      reasons.push('2 cards left, play to reach last card');
    }

    // 3. OPPONENT BLOCKING — they're close to winning
    if (opponentCardCount <= 2) {
      if (card.number === 2) {
        score += 600;
        reasons.push(`BLOCK: Pick Two forces opponent to draw (they have ${opponentCardCount} cards)`);
      }
      if (card.number === 1) {
        score += 500;
        reasons.push(`BLOCK: Hold On skips opponent (they have ${opponentCardCount} cards)`);
      }
      if (card.number === 8) {
        score += 550;
        reasons.push(`BLOCK: Suspension steals turn from opponent (they have ${opponentCardCount} cards)`);
      }
    }

    // 4. PICK TWO STRATEGY
    if (card.number === 2) {
      if (state.twosInHand >= 3 && myHand.length <= 5) {
        // UNLEASH — we hold most of the 2s and we're getting close
        score += 800;
        reasons.push(`UNLEASH: Hold ${state.twosInHand} of 5 Pick Twos, chain attack!`);
      } else if (state.twosInHand >= 2 && myHand.length > 5) {
        // HOARD — save for later
        score -= 200;
        reasons.push(`HOARD: Saving Pick Two (${state.twosInHand} in hand, wait for chain)`);
      } else if (opponentCardCount <= 3) {
        // Use defensively when opponent is low
        score += 400;
        reasons.push(`DEFENSIVE: Pick Two to push opponent back`);
      } else {
        // Only one 2, mid-game — slight hold
        score -= 50;
        reasons.push('Holding single Pick Two for defense');
      }
    }

    // 5. EXTRA TURN CARDS — Suspension (8) and General Market (14)
    if (card.number === 8) {
      const followUps = countFollowUps(card, myHand, index);
      if (followUps > 0) {
        score += 300 + followUps * 50;
        reasons.push(`Suspension: extra turn + ${followUps} follow-up plays`);
      } else {
        score += 150;
        reasons.push('Suspension: extra turn (no immediate follow-up)');
      }
    }

    if (card.number === 14) {
      score += 250;
      reasons.push('General Market: opponent draws + extra turn');
      if (marketCount < 10) {
        score += 100;
        reasons.push('Market low — General Market hurts opponent more');
      }
    }

    // 6. HOLD ON (1) — in 2-player game = extra turn
    if (card.number === 1 && opponentCardCount > 2) {
      const followUps = countFollowUps(card, myHand, index);
      if (followUps > 0) {
        score += 200 + followUps * 40;
        reasons.push(`Hold On: skip opponent + ${followUps} follow-ups`);
      } else {
        score += 100;
        reasons.push('Hold On: skip opponent');
      }
    }

    // 7. STAR CARD DUMP — count double, get rid early
    if (card.suit === 'star') {
      const value = (card.number || 0) * 2;
      score += 100 + value * 3;
      reasons.push(`Star card dump: worth ${value} points if market runs out`);
      if (marketCount < 15) {
        score += 150;
        reasons.push('Market getting low — urgent star dump');
      }
    }

    // 8. WEAK SUIT PLAY — play from suits we have few of
    const suitCount = state.suitCounts[card.suit] || 0;
    if (suitCount <= 1) {
      score += 120;
      reasons.push(`Weak suit play: only ${suitCount} ${card.suit}(s) in hand`);
    } else if (suitCount <= 2) {
      score += 60;
      reasons.push(`Low suit play: ${suitCount} ${card.suit}(s) in hand`);
    }

    // 9. STRONG SUIT PRESERVE — don't play from dominant suit
    const maxSuitCount = Math.max(...Object.values(state.suitCounts).filter(v => typeof v === 'number'));
    if (suitCount === maxSuitCount && suitCount >= 3 && card.suit !== 'star') {
      score -= 80;
      reasons.push(`Preserve dominant suit: ${suitCount} ${card.suit}(s) — keep options open`);
    }

    // 10. WHOT CARD
    if (card.suit === 'whot') {
      if (myHand.length <= 3) {
        score += 400;
        reasons.push('WHOT finisher: close to winning, use it now');
      } else if (myHand.length <= 5) {
        score += 50;
        reasons.push('WHOT: mid-game, acceptable to play');
      } else {
        score -= 150;
        reasons.push('WHOT: save for emergency (early game)');
      }
    }

    // 11. HIGH VALUE DUMP — get rid of expensive cards early
    if (card.number && card.number >= 10 && card.suit !== 'star') {
      score += card.number * 3;
      reasons.push(`Dump high value: ${card.number} points`);
    }

    // 12. FOLLOW-UP BONUS — cards that lead to more plays
    if (card.number !== 8 && card.number !== 1) { // Already counted for specials
      const followUps = countFollowUps(card, myHand, index);
      if (followUps > 0) {
        score += followUps * 30;
        reasons.push(`Chain potential: ${followUps} follow-up plays possible`);
      }
    }

    // 13. LOW CARD KEEP — if market is running out, keep low cards
    if (marketCount < 10 && card.number && card.number <= 3 && card.suit !== 'star') {
      score -= 40;
      reasons.push('Keep low card: market running out, keep score low');
    }

    return { card, index, score, reasons, isValid: true };
  });

  // Filter to valid cards only
  const validCards = scored.filter(s => s.isValid);

  // If no valid cards, must draw
  if (validCards.length === 0) {
    return {
      action: 'draw',
      cardIndex: -1,
      card: null,
      score: -20,
      reasoning: `No valid cards. Top: ${cardDisplay(topCard)}. Hand: ${myHand.map(c => cardDisplay(c)).join(', ')}. Drawing from market.`,
      allScores: scored,
    };
  }

  // Sort by score descending
  validCards.sort((a, b) => b.score - a.score);
  const best = validCards[0];

  // Should we DRAW instead of playing a valuable special?
  // Only if: early game, 5+ cards, only valid card is a high-value special we want to save
  if (myHand.length >= 5 && validCards.length === 1 && best.score < -100) {
    return {
      action: 'draw',
      cardIndex: -1,
      card: null,
      score: -20,
      reasoning: `Only valid card is a saved special (${cardDisplay(best.card)}, score ${best.score}). Drawing to preserve it.`,
      allScores: scored,
    };
  }

  // Determine suit to call if playing WHOT
  let suitToCall: Suit | undefined;
  if (best.card.suit === 'whot') {
    const remainingHand = myHand.filter((_, i) => i !== best.index);
    suitToCall = chooseBestSuit(remainingHand);
  }

  const reasoning = [
    `Top: ${cardDisplay(topCard)}.`,
    `Valid: ${validCards.map(v => `${cardDisplay(v.card)}(${v.score})`).join(', ')}.`,
    `Play: ${cardDisplay(best.card)} [${best.reasons.join('; ')}].`,
    suitToCall ? `Call suit: ${suitToCall}.` : '',
  ].filter(Boolean).join(' ');

  return {
    action: 'play',
    cardIndex: best.index,
    card: best.card,
    score: best.score,
    reasoning,
    allScores: scored,
    suitToCall,
  };
}
