import { captureFullScreen, focusApp, clickAt, sleep, ensureTmpDir } from './screen.js';
import { analyzeScreenshot } from './analyzer.js';
import { ScreenState, AnalysisResult } from './vision.js';
import { GameLogger } from './logger.js';
import { EventEmitter } from 'events';

export interface BotConfig {
  targetStake: number;
  autoReplay: boolean;
  captureIntervalMs: number;
  clickDelayMs: number;
}

export interface BotStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  totalEarnings: number;
  currentState: ScreenState;
  lastAction: string;
  lastReasoning: string;
  isRunning: boolean;
  lastScreenshot: string;
  turnsTaken: number;
}

const DEFAULT_CONFIG: BotConfig = {
  targetStake: 1000,
  autoReplay: true,
  captureIntervalMs: 3000,
  clickDelayMs: 500,
};

export class WhotBot extends EventEmitter {
  private config: BotConfig;
  private stats: BotStats;
  private running: boolean = false;
  private previousState: ScreenState = 'unknown';
  private frameCount: number = 0;
  private consecutiveUnknowns: number = 0;
  private lastClickTime: number = 0;
  private logger: GameLogger;
  private inGame: boolean = false;

  constructor(config: Partial<BotConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = new GameLogger();
    this.stats = {
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      totalEarnings: 0,
      currentState: 'unknown',
      lastAction: 'Initializing...',
      lastReasoning: '',
      isRunning: false,
      lastScreenshot: '',
      turnsTaken: 0,
    };
  }

  getStats(): BotStats {
    return { ...this.stats };
  }

  getConfig(): BotConfig {
    return { ...this.config };
  }

  setStake(stake: number): void {
    this.config.targetStake = stake;
    this.log(`Target stake set to ${stake}`);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stats.isRunning = true;
    this.log('Bot started');
    this.emit('started');

    ensureTmpDir();

    // Focus the app
    try {
      focusApp();
      await sleep(1000);
    } catch (e) {
      this.log('Could not focus app — make sure Whoto Whoto is open');
    }

    // Main loop
    while (this.running) {
      try {
        await this.tick();
      } catch (error: any) {
        this.log(`Error in tick: ${error.message}`);
        this.emit('error', error);
      }

      // Wait before next capture
      await sleep(this.config.captureIntervalMs);
    }
  }

  stop(): void {
    this.running = false;
    this.stats.isRunning = false;
    this.log('Bot stopped');
    this.emit('stopped');
  }

  private async tick(): Promise<void> {
    this.frameCount++;
    const screenshotFile = `frame_${this.frameCount % 10}.png`;

    // Step 1: Capture screen
    this.log(`Capturing screen (frame ${this.frameCount})...`);
    let screenshotPath: string;
    try {
      screenshotPath = captureFullScreen(screenshotFile);
      this.stats.lastScreenshot = screenshotPath;
    } catch (e: any) {
      this.log(`Screenshot failed: ${e.message}`);
      return;
    }

    // Step 2: Analyze with Claude Vision
    this.log('Analyzing screenshot...');
    let analysis: AnalysisResult;
    try {
      const strategyBrief = this.logger.getStrategyBrief();
      analysis = await analyzeScreenshot(screenshotPath, {
        targetStake: this.config.targetStake,
        previousState: this.previousState,
        strategyBrief: strategyBrief !== 'Not enough games played yet to generate strategy insights.' ? strategyBrief : undefined,
      });
    } catch (e: any) {
      this.log(`Analysis failed: ${e.message}`);
      return;
    }

    // Step 3: Update state
    this.stats.currentState = analysis.screen;
    this.stats.lastAction = analysis.action;
    this.stats.lastReasoning = analysis.reasoning;
    this.previousState = analysis.screen;

    this.log(`Screen: ${analysis.screen} | Action: ${analysis.action}`);
    if (analysis.reasoning) {
      this.log(`Reasoning: ${analysis.reasoning}`);
    }

    if (analysis.gameState) {
      this.log(`Cards: [${analysis.gameState.myCards?.join(', ')}] | Top: ${analysis.gameState.topCard} | My turn: ${analysis.gameState.isMyTurn}`);
    }

    this.emit('analysis', analysis);

    // Step 4: Handle unknown state
    if (analysis.screen === 'unknown') {
      this.consecutiveUnknowns++;
      if (this.consecutiveUnknowns > 5) {
        this.log('Too many unknown states — trying to refocus app');
        try { focusApp(); } catch {}
        this.consecutiveUnknowns = 0;
      }
      return;
    }
    this.consecutiveUnknowns = 0;

    // Step 5: Execute action (click)
    if (analysis.clickTarget) {
      // Rate limit clicks — don't click faster than every 2 seconds
      const now = Date.now();
      if (now - this.lastClickTime < 2000) {
        this.log('Click rate limited — skipping');
        return;
      }

      await this.executeClick(analysis);
      this.lastClickTime = Date.now();
    }

    // Step 6: Track game state transitions + logging
    // Detect game start
    if (analysis.screen === 'game_playing' && !this.inGame) {
      this.inGame = true;
      this.logger.startGame(this.config.targetStake);
      this.log('=== NEW GAME STARTED — Logging enabled ===');
    }

    // Log each turn
    if (analysis.screen === 'game_playing' && analysis.gameState?.isMyTurn && analysis.clickTarget) {
      this.stats.turnsTaken++;
      this.logger.logTurn(analysis);
    }

    // Detect game end
    if (analysis.screen === 'game_over' && this.inGame) {
      this.inGame = false;
      this.stats.gamesPlayed++;

      const isWin = analysis.reasoning.toLowerCase().includes('win') || analysis.reasoning.toLowerCase().includes('won');
      if (isWin) {
        this.stats.wins++;
        this.stats.totalEarnings += this.config.targetStake;
        this.log(`GAME WON! Total: ${this.stats.wins}W/${this.stats.losses}L | Earnings: ${this.stats.totalEarnings}`);
      } else {
        this.stats.losses++;
        this.stats.totalEarnings -= this.config.targetStake;
        this.log(`GAME LOST. Total: ${this.stats.wins}W/${this.stats.losses}L | Earnings: ${this.stats.totalEarnings}`);
      }

      this.logger.endGame(isWin ? 'win' : 'loss', analysis.gameState?.opponentCards || 0);
      const brief = this.logger.getStrategyBrief();
      this.log(`Strategy update: ${brief.split('\n')[0]}`);
      this.emit('game_over', this.stats);
    }
  }

  private async executeClick(analysis: AnalysisResult): Promise<void> {
    if (!analysis.clickTarget) return;

    const { x, y } = analysis.clickTarget;
    this.log(`Clicking at (${x}, ${y})`);

    // Small delay before clicking for reliability
    await sleep(this.config.clickDelayMs);

    try {
      clickAt(x, y);
      this.log('Click executed');
    } catch (e: any) {
      this.log(`Click failed: ${e.message}`);
    }
  }

  private log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const logMsg = `[${timestamp}] ${message}`;
    console.log(logMsg);
    this.emit('log', logMsg);
  }
}
