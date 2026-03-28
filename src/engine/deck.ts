import { Card, Suit, DECK_DISTRIBUTION, SUIT_SYMBOLS } from './types.js';

export function createDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;

  for (const [suit, numbers] of Object.entries(DECK_DISTRIBUTION)) {
    for (const num of numbers) {
      cards.push({
        id: `card_${id++}`,
        suit: suit as Suit,
        number: num,
        name: `${SUIT_SYMBOLS[suit as Suit]} ${num}`,
      });
    }
  }

  // Add 5 Whot wild cards
  for (let i = 0; i < 5; i++) {
    cards.push({
      id: `card_${id++}`,
      suit: 'whot',
      number: 20,
      name: 'WHOT 20',
    });
  }

  return cards;
}

export function shuffleDeck(cards: Card[]): Card[] {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function cardToString(card: Card): string {
  if (card.suit === 'whot') return 'WHOT 20';
  return `${SUIT_SYMBOLS[card.suit]} ${card.number}`;
}

export function getCardScore(card: Card): number {
  if (card.suit === 'star') return card.number * 2;
  if (card.suit === 'whot') return 20;
  return card.number;
}
