import { captureAppWindow, focusApp, clickAt, scrollDown, sleep, ensureTmpDir, WindowBounds } from './screen.js';
import { analyzePipeline, PipelineResult } from './analyzer.js';
import { ScreenState } from './vision.js';
import { StateTracker } from './state-tracker.js';
import { GameLogger } from './logger.js';
import { cardDisplay } from './card-normalizer.js';
import { EventEmitter } from 'events';
import { execSync } from 'child_process';

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
  targetStake: 0, // Fresher's Room (free)
  autoReplay: true,
  captureIntervalMs: 1500,
  clickDelayMs: 100,
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
  private stateTracker: StateTracker;
  private inGame: boolean = false;
  private lastPlayedSpecial: boolean = false;
  private hasScrolledLobby: boolean = false;
  private windowBounds: WindowBounds | null = null;
  private imageWidth: number = 1000;
  private imageHeight: number = 780;

  constructor(config: Partial<BotConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = new GameLogger();
    this.stateTracker = new StateTracker();
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

  getStats(): BotStats { return { ...this.stats }; }
  getConfig(): BotConfig { return { ...this.config }; }

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

    try { focusApp(); } catch {}
    await sleep(500);

    while (this.running) {
      try {
        await this.tick();
      } catch (error: any) {
        this.log(`Error: ${error.message}`);
        this.emit('error', error);
      }

      // Speed: fastest possible — play like a human who knows what they're doing
      const isUrgent = this.previousState === 'waiting' || this.previousState === 'game_confirm' || this.previousState === 'join_confirm';
      const justPlayedSpecial = this.lastPlayedSpecial;
      this.lastPlayedSpecial = false;
      await sleep(justPlayedSpecial ? 800 : isUrgent ? 700 : this.config.captureIntervalMs);
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

    // Focus app
    try { focusApp(); } catch {}
    await sleep(100);

    // Capture ONLY the app window
    this.log(`Frame ${this.frameCount}...`);
    let screenshotPath: string;
    try {
      const capture = captureAppWindow(screenshotFile);
      screenshotPath = capture.path;
      if (capture.bounds) this.windowBounds = capture.bounds;
      this.stats.lastScreenshot = screenshotPath;

      // Get actual image dimensions
      try {
        const dims = execSync(`sips -g pixelWidth -g pixelHeight "${screenshotPath}" 2>/dev/null`, { encoding: 'utf-8' });
        const wMatch = dims.match(/pixelWidth:\s*(\d+)/);
        const hMatch = dims.match(/pixelHeight:\s*(\d+)/);
        if (wMatch) this.imageWidth = parseInt(wMatch[1]);
        if (hMatch) this.imageHeight = parseInt(hMatch[1]);
      } catch {}
    } catch (e: any) {
      this.log(`Screenshot failed: ${e.message}`);
      return;
    }

    // Fast-path: instant click for YES CONTINUE buttons
    const fastClick = this.checkFastPath(screenshotPath);
    if (fastClick) {
      this.log(`FAST: ${fastClick.reason}`);
      await sleep(200);
      clickAt(fastClick.screenX, fastClick.screenY);
      this.log(`Instant click at screen(${fastClick.screenX}, ${fastClick.screenY})`);
      return;
    }

    // Run the full pipeline: Vision → Normalize → Track → Decide → Click
    let result: PipelineResult;
    try {
      result = await analyzePipeline(
        screenshotPath,
        this.config.targetStake,
        this.stateTracker,
        this.imageWidth,
        this.imageHeight,
        this.windowBounds,
      );
    } catch (e: any) {
      this.log(`Pipeline failed: ${e.message}`);
      return;
    }

    // Update stats
    this.stats.currentState = result.screen;
    this.previousState = result.screen;

    // Log what we see
    this.log(`Screen: ${result.screen}`);

    if (result.stateTrackerSummary) {
      this.log(`STATE:\n${result.stateTrackerSummary}`);
    }

    if (result.decision) {
      this.stats.lastAction = result.decision.action === 'play'
        ? `Play ${result.decision.card ? cardDisplay(result.decision.card) : '?'} (score: ${result.decision.score})`
        : 'Draw from market';
      this.stats.lastReasoning = result.decision.reasoning;
      this.log(`DECISION: ${this.stats.lastAction}`);
      this.log(`REASON: ${result.decision.reasoning}`);
    }

    this.emit('analysis', result);

    // Handle unknown
    if (result.screen === 'unknown') {
      this.consecutiveUnknowns++;
      if (this.consecutiveUnknowns > 5) {
        try { focusApp(); } catch {}
        this.consecutiveUnknowns = 0;
      }
      return;
    }
    this.consecutiveUnknowns = 0;

    // Handle scroll — Fresher's Room (stake=0) ALWAYS needs scroll since it's at the bottom
    if (result.vision.scrollNeeded || (result.screen === 'lobby' && this.config.targetStake === 0)) {
      if (!this.hasScrolledLobby) {
        this.log('Scrolling down to find Fresher\'s Room...');
        // Use actual screen coordinates for the swipe
        const cx = this.windowBounds ? this.windowBounds.x + this.windowBounds.width / 2 : 428;
        const cy = this.windowBounds ? this.windowBounds.y + this.windowBounds.height / 2 : 466;
        scrollDown(cx, cy, 400);
        await sleep(1000);
        this.hasScrolledLobby = true;
        return;
      }
      // Already scrolled — the click should work now, don't scroll again
    }

    // Reset lobby scroll flag when we leave lobby (so it scrolls again next time)
    if (result.screen !== 'lobby') {
      this.hasScrolledLobby = false;
    }

    // Detect game start
    if (result.screen === 'game_playing' && !this.inGame) {
      this.inGame = true;
      this.stateTracker.reset();
      this.logger.startGame(this.config.targetStake);
      this.log('=== NEW GAME — State tracker reset ===');
    }

    // Log turns
    if (result.decision && result.screen === 'game_playing' && result.vision.gameState) {
      this.stats.turnsTaken++;
      const gs = result.vision.gameState;
      const myCards = this.stateTracker.getState().myHand;
      const topCard = this.stateTracker.getState().topCard;
      this.logger.logTurn(result.decision, myCards, topCard, gs.opponentCards || 0, gs.marketCards || 0);
    }

    // Detect game end
    if (result.screen === 'game_over' && this.inGame) {
      this.inGame = false;
      this.stats.gamesPlayed++;
      // We'll assume loss unless we can detect win
      this.stats.losses++;
      this.stats.totalEarnings -= this.config.targetStake;
      this.log(`Game ended. Record: ${this.stats.wins}W/${this.stats.losses}L | Earnings: ${this.stats.totalEarnings}`);
      this.logger.endGame('loss');
      this.emit('game_over', this.stats);
    }

    // Track if we played a special card (1, 8, 14 = extra turn, play again immediately)
    if (result.decision?.card) {
      const num = result.decision.card.number;
      if (num === 1 || num === 8 || num === 14) {
        this.lastPlayedSpecial = true;
        this.log(`SPECIAL PLAYED (${num}) → will play again immediately!`);
      }
    }

    // Execute click
    if (result.click) {
      const now = Date.now();
      if (now - this.lastClickTime < 600) {
        this.log('Click rate limited');
        return;
      }

      await sleep(this.config.clickDelayMs);
      this.log(`Click: img(${result.click.imageX},${result.click.imageY}) → screen(${result.click.screenX},${result.click.screenY})`);

      try {
        clickAt(result.click.screenX, result.click.screenY);
        this.lastClickTime = Date.now();
        this.log('Click OK');
      } catch (e: any) {
        this.log(`Click failed: ${e.message}`);
      }
    }
  }

  private checkFastPath(screenshotPath: string): { screenX: number; screenY: number; reason: string } | null {
    if (!this.windowBounds) return null;

    try {
      // Sample pixel at known "YES, CONTINUE" button positions
      const checkY = [
        Math.round(this.imageHeight * 0.59),
        Math.round(this.imageHeight * 0.61),
        Math.round(this.imageHeight * 0.63),
        Math.round(this.imageHeight * 0.65),
      ];
      const checkX = Math.round(this.imageWidth / 2);

      for (const y of checkY) {
        const result = execSync(
          `python3 -c "from PIL import Image; img = Image.open('${screenshotPath}'); px = img.getpixel((${checkX}, ${y})); print(f'{px[0]},{px[1]},{px[2]}')" 2>/dev/null`,
          { encoding: 'utf-8' }
        ).trim();

        if (result) {
          const [r, g, b] = result.split(',').map(Number);
          // Dark red button: R > 90, G < 50, B < 50
          if (r > 90 && g < 50 && b < 50) {
            const scaleX = this.windowBounds.width / this.imageWidth;
            const scaleY = this.windowBounds.height / this.imageHeight;
            const screenX = this.windowBounds.x + Math.round(checkX * scaleX);
            const screenY = this.windowBounds.y + Math.round(y * scaleY);
            return { screenX, screenY, reason: `YES CONTINUE button detected (dark red at y=${y})` };
          }
        }
      }
    } catch {}

    return null;
  }

  private log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const logMsg = `[${timestamp}] ${message}`;
    console.log(logMsg);
    this.emit('log', logMsg);
  }
}
