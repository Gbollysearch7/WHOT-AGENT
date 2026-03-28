import { captureAppWindow, focusApp, clickInApp, clickAt, scrollDown, sleep, ensureTmpDir, WindowBounds } from './screen.js';
import { analyzeScreenshot } from './analyzer.js';
import { ScreenState, AnalysisResult } from './vision.js';
import { GameLogger } from './logger.js';
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
  private consecutiveWaiting: number = 0;
  private lastClickTime: number = 0;
  private logger: GameLogger;
  private inGame: boolean = false;
  private windowBounds: WindowBounds | null = null;
  private imageWidth: number = 1000;
  private imageHeight: number = 780;

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

      // Wait before next capture — faster polling during waiting/confirm states
      const isUrgent = this.previousState === 'waiting' || this.previousState === 'game_confirm' || this.previousState === 'join_confirm';
      await sleep(isUrgent ? 1000 : this.config.captureIntervalMs);
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

    // Step 1: Focus app and capture ONLY the app window
    try { focusApp(); } catch {}
    await sleep(200);

    this.log(`Capturing app window (frame ${this.frameCount})...`);
    let screenshotPath: string;
    try {
      const capture = captureAppWindow(screenshotFile);
      screenshotPath = capture.path;
      if (capture.bounds) {
        this.windowBounds = capture.bounds;
      }
      this.stats.lastScreenshot = screenshotPath;

      // Get actual image dimensions after resize
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

    // Step 1.5: FAST-PATH — Instant click for confirmation dialogs
    // Don't waste time on API calls for "YES, CONTINUE" buttons
    // These screens have known button positions — just click immediately
    const fastAction = await this.checkFastPath(screenshotPath);
    if (fastAction) {
      this.log(`FAST-PATH: ${fastAction.reason}`);
      await sleep(200);
      if (this.windowBounds) {
        clickInApp(fastAction.x, fastAction.y, this.imageWidth, this.imageHeight, this.windowBounds);
      } else {
        clickAt(fastAction.x, fastAction.y);
      }
      this.log(`Instant click at img(${fastAction.x}, ${fastAction.y})`);
      this.previousState = fastAction.state;
      this.stats.currentState = fastAction.state;
      this.stats.lastAction = fastAction.reason;
      this.emit('analysis', { screen: fastAction.state, action: fastAction.reason, reasoning: 'Fast-path instant click' });
      return;
    }

    // Step 2: Analyze with Claude Vision (only for complex screens)
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
      const cards = Array.isArray(analysis.gameState.myCards) ? analysis.gameState.myCards.join(', ') : String(analysis.gameState.myCards || '');
      this.log(`Cards: [${cards}] | Top: ${analysis.gameState.topCard} | My turn: ${analysis.gameState.isMyTurn}`);
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

    // Step 5: Handle scroll if needed
    if (analysis.scrollNeeded) {
      this.log('Scrolling down in lobby...');
      scrollDown(600, 400, 5);
      await sleep(500);
      return; // Re-capture after scroll
    }

    // Step 6: If model gave cardToPlay but no clickTarget, calculate click position
    if (analysis.screen === 'game_playing' && analysis.cardToPlay !== null && analysis.cardToPlay !== undefined && !analysis.clickTarget) {
      if (analysis.cardToPlay === -1) {
        // Draw from market — market pile is center-right of the game table
        // In the app-only image: roughly 60% across, 55% down
        analysis.clickTarget = { x: Math.round(this.imageWidth * 0.60), y: Math.round(this.imageHeight * 0.55) };
        this.log(`Calculated click: DRAW from market at img(${analysis.clickTarget.x}, ${analysis.clickTarget.y})`);
      } else if (analysis.cardToPlay >= 0 && analysis.gameState?.myCards) {
        // Calculate card position from index
        // Now we capture only the app window (1000px wide)
        // Cards are at the bottom ~88% of window height
        // Cards spread across roughly 60-80% of the width, centered
        const totalCards = Array.isArray(analysis.gameState.myCards) ? analysis.gameState.myCards.length : 5;
        const cardWidth = Math.min(80, Math.round((this.imageWidth * 0.7) / totalCards));
        const handWidth = totalCards * cardWidth;
        const startX = (this.imageWidth - handWidth) / 2 + cardWidth / 2;
        const cardX = startX + analysis.cardToPlay * cardWidth;
        const cardY = Math.round(this.imageHeight * 0.88);
        analysis.clickTarget = { x: Math.round(cardX), y: cardY };
        this.log(`Calculated click: card index ${analysis.cardToPlay} at image(${analysis.clickTarget.x}, ${cardY})`);
      }
    }

    // Step 7: Execute action (click)
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

    const imgX = analysis.clickTarget.x;
    const imgY = analysis.clickTarget.y;

    // Small delay before clicking for reliability
    await sleep(this.config.clickDelayMs);

    try {
      if (this.windowBounds) {
        // Click relative to the app window — accurate!
        this.log(`Click: img(${imgX},${imgY}) in ${this.imageWidth}x${this.imageHeight} window`);
        clickInApp(imgX, imgY, this.imageWidth, this.imageHeight, this.windowBounds);
      } else {
        // Fallback: assume full screen
        this.log(`Click: img(${imgX},${imgY}) — no window bounds, using fallback`);
        const scale = 1512 / this.imageWidth;
        clickAt(Math.round(imgX * scale), Math.round(imgY * scale));
      }
      this.log('Click executed');
    } catch (e: any) {
      this.log(`Click failed: ${e.message}`);
    }
  }

  private async checkFastPath(screenshotPath: string): Promise<{
    x: number; y: number; reason: string; state: ScreenState;
  } | null> {
    const IMAGE_WIDTH = 1200;
    const SCREEN_LOGICAL_WIDTH = 1512;
    const scale = SCREEN_LOGICAL_WIDTH / IMAGE_WIDTH;

    try {
      // Use Python to sample a pixel at the "YES, CONTINUE" button location
      // The dark red button has a distinctive color (~rgb(120,25,28) or similar dark red)
      // Check two positions: join_confirm button and game_confirm button

      // Sample pixel at center of where "YES, CONTINUE" button would be
      // In the 1200px image, the button is at approximately (600, 444) for game_confirm
      // and (600, 460) for join_confirm
      // Now we capture ONLY the app window (1000px wide)
      // The "YES, CONTINUE" dark red button is roughly at y=65-70% of the window height
      const imgW = this.imageWidth;
      const imgH = this.imageHeight;
      const centerX = Math.round(imgW / 2);
      const checkPoints = [
        { imgX: centerX, imgY: Math.round(imgH * 0.66), state: 'game_confirm' as ScreenState, label: 'Confirm YES' },
        { imgX: centerX, imgY: Math.round(imgH * 0.68), state: 'game_confirm' as ScreenState, label: 'Confirm YES (alt)' },
        { imgX: centerX, imgY: Math.round(imgH * 0.70), state: 'join_confirm' as ScreenState, label: 'Join confirm YES' },
        { imgX: centerX, imgY: Math.round(imgH * 0.72), state: 'join_confirm' as ScreenState, label: 'Join confirm YES (alt)' },
      ];

      for (const point of checkPoints) {
        // Use sips to extract pixel color at position
        const result = execSync(
          `python3 -c "
from PIL import Image
img = Image.open('${screenshotPath}')
px = img.getpixel((${point.imgX}, ${point.imgY}))
print(f'{px[0]},{px[1]},{px[2]}')
" 2>/dev/null`,
          { encoding: 'utf-8' }
        ).trim();

        if (result) {
          const [r, g, b] = result.split(',').map(Number);
          // Dark red button: R > 100, G < 50, B < 50
          if (r > 90 && g < 50 && b < 50) {
            const btnX = Math.round(point.imgX * scale);
            const btnY = Math.round(point.imgY * scale);
            return {
              x: btnX,
              y: btnY,
              reason: `INSTANT: ${point.label} — dark red button detected, clicking immediately`,
              state: point.state,
            };
          }
        }
      }
    } catch {
      // PIL not available or error — fall through to normal analysis
    }

    // Fallback: if previous state was waiting, the next change is almost certainly game_confirm
    // Use state-based fast path
    if (this.previousState === 'waiting' && this.consecutiveWaiting >= 3) {
      // We've been waiting for a while, now something changed — probably the confirm dialog
      const btnX = Math.round(600 * scale);
      const btnY = Math.round(444 * scale);
      this.consecutiveWaiting = 0;
      return {
        x: btnX,
        y: btnY,
        reason: 'INSTANT: Was waiting, screen changed — clicking YES CONTINUE',
        state: 'game_confirm',
      };
    }

    // Track consecutive waiting states
    if (this.previousState === 'waiting') {
      this.consecutiveWaiting++;
    } else {
      this.consecutiveWaiting = 0;
    }

    return null;
  }

  private log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const logMsg = `[${timestamp}] ${message}`;
    console.log(logMsg);
    this.emit('log', logMsg);
  }
}
