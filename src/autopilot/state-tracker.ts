import { Suit, SUITS, DECK_DISTRIBUTION } from '../engine/types.js';
import { ParsedCard, cardKey, cardDisplay } from './card-normalizer.js';

export interface TrackedGameState {
  myHand: ParsedCard[];
  topCard: ParsedCard | null;
  discardHistory: ParsedCard[];
  opponentCardCount: number;
  marketCount: number;
  isMyTurn: boolean;
  turnNumber: number;

  // Derived
  accountedFor: Map<string, number>;  // cardKey → count of known locations
  unseenCards: Map<string, number>;   // cardKey → how many are unaccounted for
  totalUnseen: number;

  // Special card tracking
  twosInHand: number;
  twosPlayed: number;
  twosUnseen: number;
  onesInHand: number;
  onesPlayed: number;
  onesUnseen: number;
  eightsInHand: number;
  eightsPlayed: number;
  eightsUnseen: number;
  fourteensInHand: number;
  fourteensPlayed: number;
  fourteensUnseen: number;
  whotsInHand: number;
  whotsPlayed: number;
  whotsUnseen: number;

  // Suit tracking
  suitCounts: Record<string, number>; // how many of each suit in my hand
  suitPlayed: Record<string, number>; // how many of each suit on discard

  // Probabilities
  probOpponentHasTwo: number;
  probOpponentHasWhot: number;
}

// Build the complete deck as a map of cardKey → count
function buildFullDeck(): Map<string, number> {
  const deck = new Map<string, number>();
  for (const [suit, numbers] of Object.entries(DECK_DISTRIBUTION)) {
    for (const num of numbers) {
      const key = `${suit}_${num}`;
      deck.set(key, (deck.get(key) || 0) + 1);
    }
  }
  // 5 WHOT cards
  deck.set('whot', 5);
  return deck;
}

const FULL_DECK = buildFullDeck();
const TOTAL_CARDS = 54;

// Count how many of a specific number exist across all suits
function countNumberInDeck(num: number): number {
  let count = 0;
  for (const [suit, numbers] of Object.entries(DECK_DISTRIBUTION)) {
    if (numbers.includes(num)) count++;
  }
  return count;
}

const TOTAL_TWOS = countNumberInDeck(2);       // 5 (one per suit)
const TOTAL_ONES = countNumberInDeck(1);       // 5
const TOTAL_EIGHTS = countNumberInDeck(8);     // 3 (circle, triangle, star only)
const TOTAL_FOURTEENS = countNumberInDeck(14); // 4 (circle, triangle, cross, square)
const TOTAL_WHOTS = 5;

export class StateTracker {
  private myHand: ParsedCard[] = [];
  private topCard: ParsedCard | null = null;
  private discardHistory: ParsedCard[] = [];
  private opponentCardCount: number = 5;
  private marketCount: number = 44; // 54 - 5 (my cards) - 5 (opponent) = 44
  private isMyTurn: boolean = false;
  private turnNumber: number = 0;
  private previousHandSize: number = 5;

  reset(): void {
    this.myHand = [];
    this.topCard = null;
    this.discardHistory = [];
    this.opponentCardCount = 5;
    this.marketCount = 44;
    this.isMyTurn = false;
    this.turnNumber = 0;
    this.previousHandSize = 5;
  }

  update(vision: {
    myCards: ParsedCard[];
    topCard: ParsedCard | null;
    opponentCards: number;
    marketCards: number;
    isMyTurn: boolean;
  }): void {
    // Detect new top card (something was played)
    if (vision.topCard && this.topCard) {
      const newKey = cardKey(vision.topCard);
      const oldKey = cardKey(this.topCard);
      if (newKey !== oldKey) {
        // A new card was played onto the discard pile
        this.discardHistory.push(vision.topCard);
      }
    } else if (vision.topCard && !this.topCard) {
      // First card — the starting card
      this.discardHistory.push(vision.topCard);
    }

    // Detect if WE played a card (our hand got smaller)
    if (vision.myCards.length < this.previousHandSize && this.previousHandSize > 0) {
      // We played — the card we lost should be the new top card
      // (already tracked above via discard history)
    }

    this.myHand = vision.myCards;
    this.topCard = vision.topCard;
    this.opponentCardCount = vision.opponentCards;
    this.marketCount = vision.marketCards;
    this.isMyTurn = vision.isMyTurn;
    this.previousHandSize = vision.myCards.length;
    this.turnNumber++;
  }

  getState(): TrackedGameState {
    // Count cards we know about
    const accountedFor = new Map<string, number>();

    // My hand
    for (const card of this.myHand) {
      const key = cardKey(card);
      accountedFor.set(key, (accountedFor.get(key) || 0) + 1);
    }

    // Discard pile
    for (const card of this.discardHistory) {
      const key = cardKey(card);
      accountedFor.set(key, (accountedFor.get(key) || 0) + 1);
    }

    // Unseen = full deck - accounted for
    const unseenCards = new Map<string, number>();
    let totalUnseen = 0;
    for (const [key, total] of FULL_DECK.entries()) {
      const seen = accountedFor.get(key) || 0;
      const unseen = Math.max(0, total - seen);
      if (unseen > 0) {
        unseenCards.set(key, unseen);
        totalUnseen += unseen;
      }
    }

    // Special card counts
    const countSpecialInHand = (num: number): number =>
      this.myHand.filter(c => c.number === num).length;
    const countSpecialInDiscard = (num: number): number =>
      this.discardHistory.filter(c => c.number === num).length;
    const countWhotInHand = (): number =>
      this.myHand.filter(c => c.suit === 'whot').length;
    const countWhotInDiscard = (): number =>
      this.discardHistory.filter(c => c.suit === 'whot').length;

    const twosInHand = countSpecialInHand(2);
    const twosPlayed = countSpecialInDiscard(2);
    const twosUnseen = Math.max(0, TOTAL_TWOS - twosInHand - twosPlayed);

    const onesInHand = countSpecialInHand(1);
    const onesPlayed = countSpecialInDiscard(1);
    const onesUnseen = Math.max(0, TOTAL_ONES - onesInHand - onesPlayed);

    const eightsInHand = countSpecialInHand(8);
    const eightsPlayed = countSpecialInDiscard(8);
    const eightsUnseen = Math.max(0, TOTAL_EIGHTS - eightsInHand - eightsPlayed);

    const fourteensInHand = countSpecialInHand(14);
    const fourteensPlayed = countSpecialInDiscard(14);
    const fourteensUnseen = Math.max(0, TOTAL_FOURTEENS - fourteensInHand - fourteensPlayed);

    const whotsInHand = countWhotInHand();
    const whotsPlayed = countWhotInDiscard();
    const whotsUnseen = Math.max(0, TOTAL_WHOTS - whotsInHand - whotsPlayed);

    // Suit counts in hand
    const suitCounts: Record<string, number> = {};
    for (const s of SUITS) suitCounts[s] = 0;
    suitCounts['whot'] = 0;
    for (const card of this.myHand) {
      suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
    }

    // Suit counts on discard
    const suitPlayed: Record<string, number> = {};
    for (const s of SUITS) suitPlayed[s] = 0;
    suitPlayed['whot'] = 0;
    for (const card of this.discardHistory) {
      suitPlayed[card.suit] = (suitPlayed[card.suit] || 0) + 1;
    }

    // Probabilities
    const opponentUnseen = totalUnseen > 0 ? this.opponentCardCount / totalUnseen : 0;
    const probOpponentHasTwo = Math.min(1, twosUnseen * opponentUnseen);
    const probOpponentHasWhot = Math.min(1, whotsUnseen * opponentUnseen);

    return {
      myHand: this.myHand,
      topCard: this.topCard,
      discardHistory: this.discardHistory,
      opponentCardCount: this.opponentCardCount,
      marketCount: this.marketCount,
      isMyTurn: this.isMyTurn,
      turnNumber: this.turnNumber,
      accountedFor,
      unseenCards,
      totalUnseen,
      twosInHand, twosPlayed, twosUnseen,
      onesInHand, onesPlayed, onesUnseen,
      eightsInHand, eightsPlayed, eightsUnseen,
      fourteensInHand, fourteensPlayed, fourteensUnseen,
      whotsInHand, whotsPlayed, whotsUnseen,
      suitCounts,
      suitPlayed,
      probOpponentHasTwo,
      probOpponentHasWhot,
    };
  }

  getHandSummary(): string {
    const state = this.getState();
    const lines: string[] = [];
    lines.push(`Hand: ${this.myHand.map(c => cardDisplay(c)).join(', ')}`);
    lines.push(`Top: ${this.topCard ? cardDisplay(this.topCard) : '?'}`);
    lines.push(`Opponent: ${state.opponentCardCount} cards | Market: ${state.marketCount}`);
    lines.push(`2s: hand=${state.twosInHand} played=${state.twosPlayed} unseen=${state.twosUnseen}`);
    lines.push(`8s: hand=${state.eightsInHand} played=${state.eightsPlayed} unseen=${state.eightsUnseen}`);
    lines.push(`14s: hand=${state.fourteensInHand} played=${state.fourteensPlayed} unseen=${state.fourteensUnseen}`);
    lines.push(`WHOTs: hand=${state.whotsInHand} played=${state.whotsPlayed} unseen=${state.whotsUnseen}`);
    lines.push(`P(opp has 2)=${(state.probOpponentHasTwo * 100).toFixed(0)}% | P(opp has WHOT)=${(state.probOpponentHasWhot * 100).toFixed(0)}%`);
    return lines.join('\n');
  }
}
