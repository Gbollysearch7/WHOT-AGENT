import {
  Card, Player, GameState, GameAction, GameLogEntry,
  Suit, GamePhase, SPECIAL_NUMBERS, Direction,
} from './types.js';
import { createDeck, shuffleDeck, getCardScore, cardToString } from './deck.js';

export class WhotGame {
  state: GameState;
  private eventListeners: Map<string, Array<(data: any) => void>> = new Map();

  constructor(gameId: string) {
    this.state = {
      id: gameId,
      players: [],
      drawPile: [],
      discardPile: [],
      currentPlayerIndex: 0,
      direction: 'clockwise',
      phase: 'waiting',
      pickTwoPenalty: 0,
      requiredSuit: null,
      winner: null,
      lastAction: null,
      turnNumber: 0,
      log: [],
    };
  }

  on(event: string, listener: (data: any) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  private emit(event: string, data: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        listener(data);
      }
    }
  }

  addPlayer(id: string, name: string, isAI: boolean = false): Player {
    if (this.state.phase !== 'waiting') {
      throw new Error('Cannot add players after game has started');
    }
    if (this.state.players.length >= 4) {
      throw new Error('Maximum 4 players allowed');
    }

    const player: Player = {
      id,
      name,
      hand: [],
      isAI,
      announcedSemiLast: false,
      announcedLast: false,
      score: 0,
    };

    this.state.players.push(player);
    this.emit('player_joined', { player });
    return player;
  }

  startGame(): void {
    if (this.state.players.length < 2) {
      throw new Error('Need at least 2 players to start');
    }
    if (this.state.phase !== 'waiting') {
      throw new Error('Game already started');
    }

    // Create and shuffle deck
    this.state.drawPile = shuffleDeck(createDeck());

    // Deal 5 cards to each player
    for (const player of this.state.players) {
      for (let i = 0; i < 5; i++) {
        const card = this.state.drawPile.pop()!;
        player.hand.push(card);
      }
    }

    // Turn up the first card for the discard pile
    // Make sure the first card is not a special card
    let startCard = this.state.drawPile.pop()!;
    while (this.isSpecialCard(startCard)) {
      this.state.drawPile.unshift(startCard);
      startCard = this.state.drawPile.pop()!;
    }
    this.state.discardPile.push(startCard);

    this.state.phase = 'playing';
    this.state.turnNumber = 1;

    this.addLog(`Game started! First card: ${cardToString(startCard)}`, {
      type: 'play_card',
      playerId: 'system',
      card: startCard,
      timestamp: Date.now(),
    });

    this.emit('game_started', { state: this.getPublicState() });
    this.emit('turn_start', {
      playerId: this.getCurrentPlayer().id,
      turnNumber: this.state.turnNumber,
    });
  }

  private isSpecialCard(card: Card): boolean {
    return ([1, 2, 8, 14, 20] as number[]).includes(card.number);
  }

  getCurrentPlayer(): Player {
    return this.state.players[this.state.currentPlayerIndex];
  }

  getTopCard(): Card {
    return this.state.discardPile[this.state.discardPile.length - 1];
  }

  canPlayCard(card: Card, player: Player): boolean {
    const topCard = this.getTopCard();

    // During pick two pending, only a 2 can be played to chain
    if (this.state.phase === 'pick_two_pending') {
      return card.number === SPECIAL_NUMBERS.PICK_TWO;
    }

    // Whot can be played on anything
    if (card.suit === 'whot') return true;

    // If a Whot was played and a suit was declared, must match that suit
    if (this.state.requiredSuit) {
      return card.suit === this.state.requiredSuit || card.number === topCard.number;
    }

    // Match suit or number
    return card.suit === topCard.suit || card.number === topCard.number;
  }

  getPlayableCards(player: Player): Card[] {
    return player.hand.filter(card => this.canPlayCard(card, player));
  }

  playCard(playerId: string, cardId: string, declaredSuit?: Suit): GameAction | null {
    if (this.state.phase === 'game_over') return null;

    const player = this.state.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    if (this.getCurrentPlayer().id !== playerId) throw new Error('Not your turn');

    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) throw new Error('Card not in hand');

    const card = player.hand[cardIndex];
    if (!this.canPlayCard(card, player)) throw new Error('Cannot play this card');

    // Remove card from hand
    player.hand.splice(cardIndex, 1);

    // Add to discard pile
    this.state.discardPile.push(card);

    // Clear required suit
    this.state.requiredSuit = null;

    const action: GameAction = {
      type: 'play_card',
      playerId,
      card,
      timestamp: Date.now(),
    };

    this.addLog(`${player.name} played ${cardToString(card)}`, action);

    // Check announcement penalties BEFORE checking win
    this.checkAnnouncementPenalties(player);

    // Check for win
    if (player.hand.length === 0) {
      this.state.phase = 'game_over';
      this.state.winner = playerId;
      this.addLog(`${player.name} calls CHECK UP! and wins!`, {
        type: 'check_up',
        playerId,
        timestamp: Date.now(),
      });
      this.emit('game_over', { winner: player, method: 'check_up' });
      return action;
    }

    // Apply special card effects
    this.applySpecialEffect(card, player, declaredSuit);

    this.emit('card_played', { player, card, state: this.getPublicState() });
    return action;
  }

  private applySpecialEffect(card: Card, player: Player, declaredSuit?: Suit): void {
    switch (card.number) {
      case SPECIAL_NUMBERS.HOLD_ON:
        // Skip next player
        this.addLog(`Hold On! Next player is skipped.`, {
          type: 'play_card', playerId: player.id, card, timestamp: Date.now(),
        });
        this.advancePlayer(); // skip one
        this.advancePlayer(); // move to the one after
        this.state.turnNumber++;
        this.emit('turn_start', {
          playerId: this.getCurrentPlayer().id,
          turnNumber: this.state.turnNumber,
        });
        break;

      case SPECIAL_NUMBERS.PICK_TWO:
        this.state.pickTwoPenalty += 2;
        this.state.phase = 'pick_two_pending';
        this.advancePlayer();
        this.state.turnNumber++;
        this.addLog(`Pick Two! Penalty is now ${this.state.pickTwoPenalty} cards.`, {
          type: 'play_card', playerId: player.id, card, timestamp: Date.now(),
        });
        this.emit('turn_start', {
          playerId: this.getCurrentPlayer().id,
          turnNumber: this.state.turnNumber,
          pickTwoPending: true,
          penalty: this.state.pickTwoPenalty,
        });
        break;

      case SPECIAL_NUMBERS.SUSPENSION:
        // Suspend next player, current player plays again
        this.addLog(`Suspension! Next player is suspended. ${player.name} plays again.`, {
          type: 'play_card', playerId: player.id, card, timestamp: Date.now(),
        });
        // Don't advance — same player plays again
        this.state.turnNumber++;
        this.emit('turn_start', {
          playerId: this.getCurrentPlayer().id,
          turnNumber: this.state.turnNumber,
        });
        break;

      case SPECIAL_NUMBERS.GENERAL_MARKET:
        // Everyone else draws 1 card
        for (const p of this.state.players) {
          if (p.id !== player.id) {
            this.drawCards(p, 1);
            this.addLog(`${p.name} draws 1 card (General Market)`, {
              type: 'draw_card', playerId: p.id, timestamp: Date.now(),
            });
          }
        }
        // Current player plays again
        this.addLog(`General Market! ${player.name} plays again.`, {
          type: 'play_card', playerId: player.id, card, timestamp: Date.now(),
        });
        this.state.turnNumber++;
        this.emit('turn_start', {
          playerId: this.getCurrentPlayer().id,
          turnNumber: this.state.turnNumber,
        });
        break;

      case SPECIAL_NUMBERS.WHOT:
        if (declaredSuit) {
          this.state.requiredSuit = declaredSuit;
          this.addLog(`WHOT! ${player.name} declares ${declaredSuit}.`, {
            type: 'call_whot_suit', playerId: player.id, suit: declaredSuit, timestamp: Date.now(),
          });
          this.advancePlayer();
          this.state.turnNumber++;
          this.emit('turn_start', {
            playerId: this.getCurrentPlayer().id,
            turnNumber: this.state.turnNumber,
          });
        } else {
          // Need suit selection
          this.state.phase = 'whot_suit_selection';
          this.emit('need_suit_selection', { playerId: player.id });
        }
        break;

      default:
        // Normal card — just advance
        this.advancePlayer();
        this.state.turnNumber++;
        this.emit('turn_start', {
          playerId: this.getCurrentPlayer().id,
          turnNumber: this.state.turnNumber,
        });
        break;
    }
  }

  declareWhotSuit(playerId: string, suit: Suit): void {
    if (this.state.phase !== 'whot_suit_selection') {
      throw new Error('Not in suit selection phase');
    }
    if (this.getCurrentPlayer().id !== playerId) {
      throw new Error('Not your turn to declare suit');
    }

    this.state.requiredSuit = suit;
    this.state.phase = 'playing';

    this.addLog(`${this.getCurrentPlayer().name} declares ${suit}!`, {
      type: 'call_whot_suit',
      playerId,
      suit,
      timestamp: Date.now(),
    });

    this.advancePlayer();
    this.state.turnNumber++;
    this.emit('turn_start', {
      playerId: this.getCurrentPlayer().id,
      turnNumber: this.state.turnNumber,
    });
  }

  drawCard(playerId: string): GameAction | null {
    if (this.state.phase === 'game_over') return null;

    const player = this.state.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    if (this.getCurrentPlayer().id !== playerId) throw new Error('Not your turn');

    // If pick two is pending, draw the penalty amount
    if (this.state.phase === 'pick_two_pending') {
      const penalty = this.state.pickTwoPenalty;
      this.drawCards(player, penalty);
      this.state.pickTwoPenalty = 0;
      this.state.phase = 'playing';

      const action: GameAction = {
        type: 'draw_card',
        playerId,
        timestamp: Date.now(),
      };

      this.addLog(`${player.name} picks up ${penalty} cards!`, action);
      this.advancePlayer();
      this.state.turnNumber++;
      this.emit('card_drawn', { player, count: penalty, state: this.getPublicState() });
      this.emit('turn_start', {
        playerId: this.getCurrentPlayer().id,
        turnNumber: this.state.turnNumber,
      });
      return action;
    }

    // Normal draw — draw 1 card
    if (this.state.drawPile.length === 0) {
      this.triggerMarketExhausted();
      return null;
    }

    this.drawCards(player, 1);

    const action: GameAction = {
      type: 'draw_card',
      playerId,
      timestamp: Date.now(),
    };

    this.addLog(`${player.name} draws a card from the market.`, action);
    this.advancePlayer();
    this.state.turnNumber++;
    this.emit('card_drawn', { player, count: 1, state: this.getPublicState() });
    this.emit('turn_start', {
      playerId: this.getCurrentPlayer().id,
      turnNumber: this.state.turnNumber,
    });
    return action;
  }

  private drawCards(player: Player, count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.state.drawPile.length === 0) {
        this.triggerMarketExhausted();
        return;
      }
      const card = this.state.drawPile.pop()!;
      player.hand.push(card);
    }
    // Reset announcements when hand grows
    if (player.hand.length > 2) {
      player.announcedSemiLast = false;
      player.announcedLast = false;
    }
  }

  announce(playerId: string, type: 'semi_last' | 'last'): void {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');

    if (type === 'semi_last' && player.hand.length === 2) {
      player.announcedSemiLast = true;
      this.addLog(`${player.name}: "Semi last card!"`, {
        type: 'announce_semi_last',
        playerId,
        timestamp: Date.now(),
      });
      this.emit('announcement', { player, type: 'semi_last' });
    } else if (type === 'last' && player.hand.length === 1) {
      player.announcedLast = true;
      this.addLog(`${player.name}: "Last card!"`, {
        type: 'announce_last',
        playerId,
        timestamp: Date.now(),
      });
      this.emit('announcement', { player, type: 'last' });
    }
  }

  private checkAnnouncementPenalties(player: Player): void {
    // After playing a card, check if they should have announced
    if (player.hand.length === 2 && !player.announcedSemiLast) {
      // Penalty: draw 2 cards
      this.drawCards(player, 2);
      this.addLog(`${player.name} forgot to say "Semi last card!" — draws 2 penalty cards.`, {
        type: 'draw_card',
        playerId: player.id,
        timestamp: Date.now(),
      });
      this.emit('penalty', { player, reason: 'missed_semi_last' });
    }
    if (player.hand.length === 1 && !player.announcedLast) {
      this.drawCards(player, 2);
      this.addLog(`${player.name} forgot to say "Last card!" — draws 2 penalty cards.`, {
        type: 'draw_card',
        playerId: player.id,
        timestamp: Date.now(),
      });
      this.emit('penalty', { player, reason: 'missed_last' });
    }
  }

  private triggerMarketExhausted(): void {
    this.state.phase = 'game_over';

    // Calculate scores
    let lowestScore = Infinity;
    let winner: Player | null = null;

    for (const player of this.state.players) {
      player.score = player.hand.reduce((sum, card) => sum + getCardScore(card), 0);
      if (player.score < lowestScore) {
        lowestScore = player.score;
        winner = player;
      }
    }

    if (winner) {
      this.state.winner = winner.id;
      this.addLog(`Market exhausted! ${winner.name} wins with lowest score (${winner.score})!`, {
        type: 'check_up',
        playerId: winner.id,
        timestamp: Date.now(),
      });
    }

    this.emit('game_over', {
      winner,
      method: 'market_exhausted',
      scores: this.state.players.map(p => ({ name: p.name, score: p.score })),
    });
  }

  private advancePlayer(): void {
    const count = this.state.players.length;
    if (this.state.direction === 'clockwise') {
      this.state.currentPlayerIndex = (this.state.currentPlayerIndex + 1) % count;
    } else {
      this.state.currentPlayerIndex = (this.state.currentPlayerIndex - 1 + count) % count;
    }
  }

  private addLog(message: string, action: GameAction): void {
    const entry: GameLogEntry = {
      message,
      action,
      timestamp: Date.now(),
    };
    this.state.log.push(entry);
    this.state.lastAction = action;
    this.emit('log', entry);
  }

  getPublicState(forPlayerId?: string): any {
    return {
      id: this.state.id,
      players: this.state.players.map(p => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length,
        hand: p.id === forPlayerId ? p.hand : undefined,
        isAI: p.isAI,
        score: p.score,
      })),
      topCard: this.getTopCard(),
      drawPileCount: this.state.drawPile.length,
      currentPlayerIndex: this.state.currentPlayerIndex,
      currentPlayerId: this.getCurrentPlayer().id,
      direction: this.state.direction,
      phase: this.state.phase,
      pickTwoPenalty: this.state.pickTwoPenalty,
      requiredSuit: this.state.requiredSuit,
      winner: this.state.winner,
      turnNumber: this.state.turnNumber,
      lastAction: this.state.lastAction,
      log: this.state.log.slice(-20),
    };
  }

  getPlayerState(playerId: string): any {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');

    return {
      ...this.getPublicState(playerId),
      myHand: player.hand,
      playableCards: this.getPlayableCards(player),
    };
  }
}
