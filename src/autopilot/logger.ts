import { writeFileSync, readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ScreenState } from './vision.js';
import { Decision } from './decision-engine.js';
import { cardDisplay, ParsedCard } from './card-normalizer.js';

const LOGS_DIR = join(process.cwd(), 'logs');
const GAME_LOG_FILE = join(LOGS_DIR, 'games.jsonl');
const TURNS_LOG_FILE = join(LOGS_DIR, 'turns.jsonl');
const STRATEGY_FILE = join(LOGS_DIR, 'strategy_insights.json');
const STATS_FILE = join(LOGS_DIR, 'lifetime_stats.json');

export interface TurnLog {
  timestamp: string;
  gameId: string;
  turnNumber: number;
  screen: string;
  myCards: string[];
  topCard: string;
  cardPlayed: string | null;
  action: string;
  reasoning: string;
  opponentCards: number;
  marketCards: number;
  wasSuccessful: boolean;
}

export interface GameLog {
  gameId: string;
  startTime: string;
  endTime: string;
  stake: number;
  result: 'win' | 'loss' | 'unknown';
  totalTurns: number;
  turnsPlayed: number;
  cardsDrawn: number;
  specialCardsPlayed: string[];
  opponentFinalCards: number;
  keyMoments: string[];
}

export interface LifetimeStats {
  totalGames: number;
  wins: number;
  losses: number;
  winRate: number;
  totalEarnings: number;
  totalTurns: number;
  avgTurnsPerGame: number;
  bestStreak: number;
  currentStreak: number;
  stakeBreakdown: Record<string, { games: number; wins: number; losses: number; earnings: number }>;
  cardPlayFrequency: Record<string, number>;
  specialCardEffectiveness: Record<string, { played: number; ledToWin: number }>;
  suitCallFrequency: Record<string, number>;
  commonMistakes: string[];
  learnedPatterns: string[];
  lastUpdated: string;
}

export interface StrategyInsight {
  pattern: string;
  confidence: number;
  evidence: string;
  gamesObserved: number;
  lastSeen: string;
}

export class GameLogger {
  private currentGame: Partial<GameLog> | null = null;
  private currentTurns: TurnLog[] = [];
  private turnCounter: number = 0;
  private cardsDrawnCount: number = 0;
  private specialsPlayed: string[] = [];
  private keyMoments: string[] = [];

  constructor() {
    if (!existsSync(LOGS_DIR)) {
      mkdirSync(LOGS_DIR, { recursive: true });
    }
  }

  startGame(stake: number): string {
    const gameId = `game_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.currentGame = {
      gameId,
      startTime: new Date().toISOString(),
      stake,
      totalTurns: 0,
      turnsPlayed: 0,
      cardsDrawn: 0,
      specialCardsPlayed: [],
      keyMoments: [],
    };
    this.currentTurns = [];
    this.turnCounter = 0;
    this.cardsDrawnCount = 0;
    this.specialsPlayed = [];
    this.keyMoments = [];
    return gameId;
  }

  logTurn(decision: Decision, myCards: ParsedCard[], topCard: ParsedCard | null, opponentCards: number, marketCards: number): void {
    if (!this.currentGame) return;
    this.turnCounter++;

    const cardPlayed = decision.card ? cardDisplay(decision.card) : null;

    // Track specials
    if (decision.card && decision.card.number) {
      const num = decision.card.number;
      if ([1, 2, 8, 14].includes(num)) {
        this.specialsPlayed.push(cardPlayed || `special_${num}`);
      }
    }
    if (decision.card?.suit === 'whot') {
      this.specialsPlayed.push('WHOT');
    }

    // Track draws
    if (decision.action === 'draw') {
      this.cardsDrawnCount++;
    }

    // Identify key moments
    if (myCards.length <= 2) {
      this.keyMoments.push(`Turn ${this.turnCounter}: Down to ${myCards.length} cards`);
    }
    if (opponentCards <= 2) {
      this.keyMoments.push(`Turn ${this.turnCounter}: Opponent down to ${opponentCards} cards`);
    }
    if (decision.card?.suit === 'whot') {
      this.keyMoments.push(`Turn ${this.turnCounter}: Played WHOT, called ${decision.suitToCall}`);
    }

    const turn: TurnLog = {
      timestamp: new Date().toISOString(),
      gameId: this.currentGame.gameId!,
      turnNumber: this.turnCounter,
      screen: 'game_playing',
      myCards: myCards.map(c => cardDisplay(c)),
      topCard: topCard ? cardDisplay(topCard) : '',
      cardPlayed,
      action: decision.action,
      reasoning: decision.reasoning,
      opponentCards,
      marketCards,
      wasSuccessful: true,
    };

    this.currentTurns.push(turn);

    // Append to turns log file
    appendFileSync(TURNS_LOG_FILE, JSON.stringify(turn) + '\n');
  }

  endGame(result: 'win' | 'loss' | 'unknown', opponentFinalCards: number = 0): void {
    if (!this.currentGame) return;

    const game: GameLog = {
      gameId: this.currentGame.gameId!,
      startTime: this.currentGame.startTime!,
      endTime: new Date().toISOString(),
      stake: this.currentGame.stake!,
      result,
      totalTurns: this.turnCounter,
      turnsPlayed: this.currentTurns.filter(t => t.cardPlayed !== null).length,
      cardsDrawn: this.cardsDrawnCount,
      specialCardsPlayed: this.specialsPlayed,
      opponentFinalCards,
      keyMoments: this.keyMoments,
    };

    // Append to games log
    appendFileSync(GAME_LOG_FILE, JSON.stringify(game) + '\n');

    // Update lifetime stats
    this.updateLifetimeStats(game);

    // Analyze for strategy insights
    this.analyzeForInsights(game);

    this.currentGame = null;
    this.currentTurns = [];
  }

  private updateLifetimeStats(game: GameLog): void {
    const stats = this.getLifetimeStats();

    stats.totalGames++;
    stats.totalTurns += game.totalTurns;
    stats.avgTurnsPerGame = Math.round(stats.totalTurns / stats.totalGames);

    if (game.result === 'win') {
      stats.wins++;
      stats.totalEarnings += game.stake;
      stats.currentStreak = Math.max(0, stats.currentStreak) + 1;
      stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
    } else if (game.result === 'loss') {
      stats.losses++;
      stats.totalEarnings -= game.stake;
      stats.currentStreak = Math.min(0, stats.currentStreak) - 1;
    }

    stats.winRate = stats.totalGames > 0 ? Math.round((stats.wins / stats.totalGames) * 100) : 0;

    // Stake breakdown
    const stakeKey = String(game.stake);
    if (!stats.stakeBreakdown[stakeKey]) {
      stats.stakeBreakdown[stakeKey] = { games: 0, wins: 0, losses: 0, earnings: 0 };
    }
    stats.stakeBreakdown[stakeKey].games++;
    if (game.result === 'win') {
      stats.stakeBreakdown[stakeKey].wins++;
      stats.stakeBreakdown[stakeKey].earnings += game.stake;
    } else if (game.result === 'loss') {
      stats.stakeBreakdown[stakeKey].losses++;
      stats.stakeBreakdown[stakeKey].earnings -= game.stake;
    }

    // Track special card usage
    for (const card of game.specialCardsPlayed) {
      const num = card.match(/\d+/)?.[0] || 'unknown';
      const key = { '1': 'hold_on', '2': 'pick_two', '8': 'suspension', '14': 'general_market', '20': 'whot' }[num] || num;
      if (!stats.specialCardEffectiveness[key]) {
        stats.specialCardEffectiveness[key] = { played: 0, ledToWin: 0 };
      }
      stats.specialCardEffectiveness[key].played++;
      if (game.result === 'win') {
        stats.specialCardEffectiveness[key].ledToWin++;
      }
    }

    stats.lastUpdated = new Date().toISOString();
    writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  }

  private analyzeForInsights(game: GameLog): void {
    const insights = this.getStrategyInsights();

    // Pattern: Did holding specials for late game lead to wins?
    const lateSpecials = this.currentTurns.filter(
      t => t.turnNumber > game.totalTurns * 0.6 &&
        t.cardPlayed && /\b(1|2|8|14)\b/.test(t.cardPlayed)
    );
    if (lateSpecials.length > 0) {
      this.addInsight(insights, {
        pattern: 'late_game_specials',
        confidence: game.result === 'win' ? 0.7 : 0.3,
        evidence: `Played ${lateSpecials.length} specials in last 40% of game → ${game.result}`,
        gamesObserved: 1,
        lastSeen: new Date().toISOString(),
      });
    }

    // Pattern: Did aggressive Pick Two chaining work?
    const pickTwos = game.specialCardsPlayed.filter(c => c.includes('2'));
    if (pickTwos.length >= 2) {
      this.addInsight(insights, {
        pattern: 'pick_two_aggression',
        confidence: game.result === 'win' ? 0.8 : 0.2,
        evidence: `Played ${pickTwos.length} Pick Twos in one game → ${game.result}`,
        gamesObserved: 1,
        lastSeen: new Date().toISOString(),
      });
    }

    // Pattern: How many cards drawn vs played?
    const drawRatio = game.cardsDrawn / Math.max(1, game.turnsPlayed);
    this.addInsight(insights, {
      pattern: drawRatio > 0.4 ? 'high_draw_rate' : 'low_draw_rate',
      confidence: game.result === 'win' ? 0.6 : 0.4,
      evidence: `Draw ratio ${drawRatio.toFixed(2)} (drew ${game.cardsDrawn}, played ${game.turnsPlayed}) → ${game.result}`,
      gamesObserved: 1,
      lastSeen: new Date().toISOString(),
    });

    // Pattern: WHOT card timing
    const whotPlays = this.currentTurns.filter(t => t.cardPlayed?.includes('20'));
    for (const wp of whotPlays) {
      const timing = wp.turnNumber / game.totalTurns;
      this.addInsight(insights, {
        pattern: timing < 0.3 ? 'early_whot' : timing < 0.7 ? 'mid_whot' : 'late_whot',
        confidence: game.result === 'win' ? 0.7 : 0.3,
        evidence: `Played WHOT at turn ${wp.turnNumber}/${game.totalTurns} (${(timing * 100).toFixed(0)}%) → ${game.result}`,
        gamesObserved: 1,
        lastSeen: new Date().toISOString(),
      });
    }

    // Pattern: Fast wins (few turns)
    if (game.totalTurns <= 8 && game.result === 'win') {
      this.addInsight(insights, {
        pattern: 'speed_win',
        confidence: 0.8,
        evidence: `Won in only ${game.totalTurns} turns — aggressive play worked`,
        gamesObserved: 1,
        lastSeen: new Date().toISOString(),
      });
    }

    writeFileSync(
      join(LOGS_DIR, 'strategy_insights.json'),
      JSON.stringify(insights, null, 2)
    );
  }

  private addInsight(insights: StrategyInsight[], newInsight: StrategyInsight): void {
    const existing = insights.find(i => i.pattern === newInsight.pattern);
    if (existing) {
      // Rolling average confidence
      existing.confidence = (existing.confidence * existing.gamesObserved + newInsight.confidence) /
        (existing.gamesObserved + 1);
      existing.gamesObserved++;
      existing.evidence = newInsight.evidence;
      existing.lastSeen = newInsight.lastSeen;
    } else {
      insights.push(newInsight);
    }
  }

  getLifetimeStats(): LifetimeStats {
    if (existsSync(STATS_FILE)) {
      try {
        return JSON.parse(readFileSync(STATS_FILE, 'utf-8'));
      } catch {}
    }
    return {
      totalGames: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalEarnings: 0,
      totalTurns: 0,
      avgTurnsPerGame: 0,
      bestStreak: 0,
      currentStreak: 0,
      stakeBreakdown: {},
      cardPlayFrequency: {},
      specialCardEffectiveness: {},
      suitCallFrequency: {},
      commonMistakes: [],
      learnedPatterns: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  getStrategyInsights(): StrategyInsight[] {
    const filepath = join(LOGS_DIR, 'strategy_insights.json');
    if (existsSync(filepath)) {
      try {
        return JSON.parse(readFileSync(filepath, 'utf-8'));
      } catch {}
    }
    return [];
  }

  // Generate a strategy brief for the AI based on learned patterns
  getStrategyBrief(): string {
    const stats = this.getLifetimeStats();
    const insights = this.getStrategyInsights();

    if (stats.totalGames < 3) {
      return 'Not enough games played yet to generate strategy insights.';
    }

    let brief = `LEARNED STRATEGY (from ${stats.totalGames} games, ${stats.winRate}% win rate):\n`;

    // High-confidence insights
    const goodInsights = insights
      .filter(i => i.gamesObserved >= 3 && i.confidence > 0.6)
      .sort((a, b) => b.confidence - a.confidence);

    const badInsights = insights
      .filter(i => i.gamesObserved >= 3 && i.confidence < 0.4)
      .sort((a, b) => a.confidence - b.confidence);

    if (goodInsights.length > 0) {
      brief += '\nWINNING PATTERNS:\n';
      for (const insight of goodInsights.slice(0, 5)) {
        brief += `- ${insight.pattern}: ${(insight.confidence * 100).toFixed(0)}% success rate (${insight.gamesObserved} games)\n`;
      }
    }

    if (badInsights.length > 0) {
      brief += '\nAVOID THESE:\n';
      for (const insight of badInsights.slice(0, 5)) {
        brief += `- ${insight.pattern}: Only ${(insight.confidence * 100).toFixed(0)}% success (${insight.gamesObserved} games)\n`;
      }
    }

    // Special card effectiveness
    const specials = Object.entries(stats.specialCardEffectiveness);
    if (specials.length > 0) {
      brief += '\nSPECIAL CARD WIN RATES:\n';
      for (const [card, data] of specials) {
        const rate = data.played > 0 ? Math.round((data.ledToWin / data.played) * 100) : 0;
        brief += `- ${card}: ${rate}% win rate when played (${data.played} times)\n`;
      }
    }

    // Stake performance
    const stakeEntries = Object.entries(stats.stakeBreakdown);
    if (stakeEntries.length > 0) {
      brief += '\nSTAKE PERFORMANCE:\n';
      for (const [stake, data] of stakeEntries) {
        const rate = data.games > 0 ? Math.round((data.wins / data.games) * 100) : 0;
        brief += `- ${stake} coins: ${rate}% win rate (${data.games} games, ${data.earnings > 0 ? '+' : ''}${data.earnings} earnings)\n`;
      }
    }

    return brief;
  }
}
