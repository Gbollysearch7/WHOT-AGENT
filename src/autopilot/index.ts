import { WhotBot } from './bot.js';
import { createDashboard } from './dashboard.js';

const args = process.argv.slice(2);
const stake = parseInt(args.find(a => a.startsWith('--stake='))?.split('=')[1] || '1000');
const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] || '3000');
const autoStart = args.includes('--auto');

console.log(`
╔══════════════════════════════════════╗
║       WHOT AUTOPILOT AGENT          ║
║                                      ║
║   Target Stake: ${String(stake).padEnd(20)}║
║   Dashboard: http://localhost:${String(port).padEnd(7)}║
╚══════════════════════════════════════╝
`);

// Check for API key
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY environment variable is required.');
  console.error('Set it with: export ANTHROPIC_API_KEY=your-key-here');
  process.exit(1);
}

// Create bot
const bot = new WhotBot({
  targetStake: stake,
  autoReplay: true,
  captureIntervalMs: 3000, // 3 seconds between captures
  clickDelayMs: 500,
});

// Create dashboard
createDashboard(bot, port);

// Auto-start if flag is set
if (autoStart) {
  console.log('Auto-starting bot...');
  bot.start();
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  bot.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  bot.stop();
  process.exit(0);
});
