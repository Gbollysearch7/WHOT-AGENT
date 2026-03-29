import { Suit, SUITS, DECK_DISTRIBUTION } from '../engine/types.js';

export interface ParsedCard {
  suit: Suit | 'whot';
  number: number | null; // null for WHOT
}

// Valid numbers per suit
const VALID_NUMBERS: Record<string, Set<number>> = {};
for (const [suit, nums] of Object.entries(DECK_DISTRIBUTION)) {
  VALID_NUMBERS[suit] = new Set(nums);
}
// All valid numbers across any suit
const ALL_VALID_NUMBERS = new Set([1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14]);

// Suit aliases — what Claude might call them
const SUIT_MAP: Record<string, Suit | 'whot'> = {
  'circle': 'circle', 'circles': 'circle', 'dot': 'circle', 'dots': 'circle',
  'red dot': 'circle', 'red circle': 'circle', '●': 'circle', 'o': 'circle',
  'triangle': 'triangle', 'triangles': 'triangle', '▲': 'triangle', '△': 'triangle',
  'cross': 'cross', 'crosses': 'cross', 'plus': 'cross', '+': 'cross',
  '✚': 'cross', '✛': 'cross', '✕': 'cross', 'x': 'cross',
  'square': 'square', 'squares': 'square', '■': 'square', '□': 'square',
  'star': 'star', 'stars': 'star', '★': 'star', '☆': 'star',
  'whot': 'whot', 'w': 'whot', 'wild': 'whot', 'joker': 'whot',
};

// Number aliases — what Claude might say instead of numbers
const NUMBER_MAP: Record<string, number> = {
  'ace': 1, 'a': 1, 'one': 1,
  'two': 2, 'pick two': 2, 'pick 2': 2,
  'three': 3,
  'four': 4,
  'five': 5,
  'seven': 7,
  'eight': 8, 'suspension': 8,
  'ten': 10,
  'eleven': 11,
  'twelve': 12,
  'thirteen': 13,
  'fourteen': 14, 'general market': 14,
};

export function parseCard(raw: string): ParsedCard | null {
  if (!raw || typeof raw !== 'string') return null;

  const cleaned = raw.toLowerCase().trim();

  // Check for WHOT first
  if (cleaned === 'whot' || cleaned === 'w' || cleaned === 'wild' || cleaned.includes('whot')) {
    return { suit: 'whot', number: null };
  }

  // Try to extract suit
  let detectedSuit: Suit | null = null;
  let remaining = cleaned;

  for (const [alias, suit] of Object.entries(SUIT_MAP)) {
    if (suit === 'whot') continue;
    if (cleaned.includes(alias)) {
      detectedSuit = suit as Suit;
      remaining = cleaned.replace(alias, '').trim();
      break;
    }
  }

  // Try to extract number
  let detectedNumber: number | null = null;

  // First try direct number extraction
  const numMatch = remaining.match(/\d+/);
  if (numMatch) {
    const num = parseInt(numMatch[0]);
    if (ALL_VALID_NUMBERS.has(num)) {
      detectedNumber = num;
    }
  }

  // Try number aliases if no number found
  if (detectedNumber === null) {
    for (const [alias, num] of Object.entries(NUMBER_MAP)) {
      if (remaining.includes(alias) || cleaned.includes(alias)) {
        detectedNumber = num;
        break;
      }
    }
  }

  // "+" often means 1 (Hold On) — Claude reads the cross/plus symbol as "+"
  if (detectedNumber === null && (remaining === '+' || remaining === 'plus')) {
    detectedNumber = 1;
  }

  if (!detectedSuit && !detectedNumber) return null;

  // If we have a suit but no number, try harder
  if (detectedSuit && detectedNumber === null) {
    // Check if the whole string has a number anywhere
    const allNums = cleaned.match(/\d+/g);
    if (allNums) {
      for (const n of allNums) {
        const num = parseInt(n);
        if (VALID_NUMBERS[detectedSuit]?.has(num)) {
          detectedNumber = num;
          break;
        }
      }
    }
  }

  // Validate: does this card exist in the deck?
  if (detectedSuit && detectedNumber !== null) {
    if (!VALID_NUMBERS[detectedSuit]?.has(detectedNumber)) {
      // Try closest valid number
      const validNums = Array.from(VALID_NUMBERS[detectedSuit] || []);
      const closest = validNums.reduce((prev, curr) =>
        Math.abs(curr - detectedNumber!) < Math.abs(prev - detectedNumber!) ? curr : prev
      );
      if (Math.abs(closest - detectedNumber) <= 1) {
        detectedNumber = closest; // Auto-correct off-by-one (e.g., 6→5 or 6→7)
      }
    }
  }

  return {
    suit: detectedSuit || 'circle', // fallback
    number: detectedNumber,
  };
}

export function parseCardList(rawCards: string[]): ParsedCard[] {
  const parsed: ParsedCard[] = [];
  for (const raw of rawCards) {
    const card = parseCard(raw);
    if (card) {
      parsed.push(card);
    }
  }
  return parsed;
}

export function cardKey(card: ParsedCard): string {
  if (card.suit === 'whot') return 'whot';
  return `${card.suit}_${card.number}`;
}

export function cardDisplay(card: ParsedCard): string {
  if (card.suit === 'whot') return 'WHOT';
  const symbols: Record<string, string> = {
    circle: '●', triangle: '▲', cross: '✚', square: '■', star: '★',
  };
  return `${symbols[card.suit] || card.suit} ${card.number}`;
}
