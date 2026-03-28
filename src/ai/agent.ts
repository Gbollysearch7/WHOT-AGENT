import {
  Card, Player, Suit, SUITS, SPECIAL_NUMBERS,
  SUIT_SYMBOLS, GameState,
} from '../engine/types.js';
import { WhotGame } from '../engine/game.js';
import { getCardScore, cardToString } from '../engine/deck.js';

type Difficulty = 'easy' | 'medium' | 'hard';

interface ScoredCard {
  card: Card;
  score: number;
  reason: string;
}

export class WhotAI {
  private difficulty: Difficulty;

  constructor(difficulty: Difficulty = 'hard') {
    this.difficulty = difficulty;
  }

  async makeMove(game: WhotGame, playerId: string): Promise<void> {
    const player = game.state.players.find(p => p.id === playerId);
    if (!player) return;
    if (game.getCurrentPlayer().id !== playerId) return;

    // Handle suit selection for Whot card
    if (game.state.phase === 'whot_suit_selection') {
      const bestSuit = this.chooseBestSuit(player);
      game.declareWhotSuit(playerId, bestSuit);
      return;
    }

    // Handle announcements
    if (player.hand.length === 3) {
      // About to play down to 2 — pre-announce
    }

    const playable = game.getPlayableCards(player);

    // If no playable cards, draw
    if (playable.length === 0) {
      game.drawCard(playerId);
      return;
    }

    // During pick_two_pending, must chain a 2 or accept penalty
    if (game.state.phase === 'pick_two_pending') {
      const twos = playable.filter(c => c.number === SPECIAL_NUMBERS.PICK_TWO);
      if (twos.length > 0) {
        game.playCard(playerId, twos[0].id);
        return;
      }
      // No 2 to chain — must draw
      game.drawCard(playerId);
      return;
    }

    // Make announcements before playing
    if (player.hand.length === 2) {
      game.announce(playerId, 'semi_last');
    }
    if (player.hand.length === 1) {
      game.announce(playerId, 'last');
    }

    // Choose best card based on difficulty
    let chosenCard: Card;
    if (this.difficulty === 'easy') {
      chosenCard = this.chooseCardEasy(playable);
    } else if (this.difficulty === 'medium') {
      chosenCard = this.chooseCardMedium(playable, player, game);
    } else {
      chosenCard = this.chooseCardHard(playable, player, game);
    }

    // Pre-announce if this play will reduce hand
    if (player.hand.length === 3) {
      game.announce(playerId, 'semi_last');
    }
    if (player.hand.length === 2) {
      game.announce(playerId, 'last');
    }

    // If playing a Whot card, choose the suit
    const declaredSuit = chosenCard.suit === 'whot' ? this.chooseBestSuit(player) : undefined;
    game.playCard(playerId, chosenCard.id, declaredSuit);
  }

  private chooseCardEasy(playable: Card[]): Card {
    // Random selection
    return playable[Math.floor(Math.random() * playable.length)];
  }

  private chooseCardMedium(playable: Card[], player: Player, game: WhotGame): Card {
    // Prefer special cards, then high-value cards
    const scored = playable.map(card => ({
      card,
      score: this.scoreCardBasic(card),
      reason: '',
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].card;
  }

  private chooseCardHard(playable: Card[], player: Player, game: WhotGame): Card {
    const scored = this.scoreAllCards(playable, player, game);
    scored.sort((a, b) => b.score - a.score);
    return scored[0].card;
  }

  private scoreAllCards(playable: Card[], player: Player, game: WhotGame): ScoredCard[] {
    const nextPlayer = this.getNextPlayer(game);
    const nextPlayerCardCount = nextPlayer?.hand.length ?? 5;

    return playable.map(card => {
      let score = 0;
      let reason = '';

      // Base: prefer getting rid of high-value cards
      score += getCardScore(card) * 0.5;
      reason += `value:${getCardScore(card)} `;

      // STRATEGIC SPECIALS
      if (card.number === SPECIAL_NUMBERS.PICK_TWO) {
        // Great if next player has few cards (close to winning)
        if (nextPlayerCardCount <= 2) {
          score += 30;
          reason += 'pick2-block ';
        } else {
          score += 15;
          reason += 'pick2 ';
        }
      }

      if (card.number === SPECIAL_NUMBERS.HOLD_ON) {
        if (nextPlayerCardCount <= 2) {
          score += 25;
          reason += 'hold-block ';
        } else {
          score += 10;
          reason += 'hold ';
        }
      }

      if (card.number === SPECIAL_NUMBERS.SUSPENSION) {
        // Extra turn is always valuable
        score += 20;
        reason += 'suspend ';
        // Even more valuable when we have few cards
        if (player.hand.length <= 3) {
          score += 15;
          reason += 'suspend-rush ';
        }
      }

      if (card.number === SPECIAL_NUMBERS.GENERAL_MARKET) {
        // More players = more valuable
        score += 10 * (game.state.players.length - 1);
        reason += 'general-market ';
        // Extra turn bonus
        score += 10;
      }

      if (card.suit === 'whot') {
        // Save Whot cards for when we need them
        if (player.hand.length <= 2) {
          score += 35; // Use as finisher
          reason += 'whot-finisher ';
        } else if (playable.length === 1) {
          score += 20; // Only option
          reason += 'whot-only ';
        } else {
          score -= 5; // Save it
          reason += 'whot-save ';
        }
      }

      // Suit dominance: prefer playing suits we have many of
      if (card.suit !== 'whot') {
        const suitCount = player.hand.filter(c => c.suit === card.suit).length;
        score += suitCount * 3;
        reason += `suit-dom:${suitCount} `;
      }

      // If we're close to winning, prefer non-special cards to avoid complications
      if (player.hand.length <= 2 && !this.isSpecial(card)) {
        score += 10;
        reason += 'simple-finish ';
      }

      return { card, score, reason };
    });
  }

  private scoreCardBasic(card: Card): number {
    let score = getCardScore(card);
    if (card.number === SPECIAL_NUMBERS.PICK_TWO) score += 15;
    if (card.number === SPECIAL_NUMBERS.SUSPENSION) score += 12;
    if (card.number === SPECIAL_NUMBERS.GENERAL_MARKET) score += 10;
    if (card.number === SPECIAL_NUMBERS.HOLD_ON) score += 8;
    if (card.suit === 'whot') score -= 5;
    return score;
  }

  private isSpecial(card: Card): boolean {
    return [1, 2, 8, 14, 20].includes(card.number);
  }

  chooseBestSuit(player: Player): Suit {
    // Count cards by suit in hand (excluding whot)
    const suitCounts: Record<string, number> = {};
    for (const suit of SUITS) {
      suitCounts[suit] = player.hand.filter(c => c.suit === suit).length;
    }

    // Pick suit with most cards
    let bestSuit: Suit = 'circle';
    let maxCount = 0;
    for (const [suit, count] of Object.entries(suitCounts)) {
      if (count > maxCount) {
        maxCount = count;
        bestSuit = suit as Suit;
      }
    }

    // If no cards of any suit, pick random
    if (maxCount === 0) {
      return SUITS[Math.floor(Math.random() * SUITS.length)];
    }

    return bestSuit;
  }

  private getNextPlayer(game: WhotGame): Player | null {
    const count = game.state.players.length;
    const nextIndex = game.state.direction === 'clockwise'
      ? (game.state.currentPlayerIndex + 1) % count
      : (game.state.currentPlayerIndex - 1 + count) % count;
    return game.state.players[nextIndex] || null;
  }
}
