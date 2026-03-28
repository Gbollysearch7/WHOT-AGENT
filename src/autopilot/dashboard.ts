import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFileSync, existsSync } from 'fs';
import { WhotBot, BotConfig } from './bot.js';

export function createDashboard(bot: WhotBot, port: number = 3000) {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  const clients = new Set<WebSocket>();

  // Broadcast to all dashboard clients
  function broadcast(data: any): void {
    const msg = JSON.stringify(data);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  // Forward bot events to dashboard
  bot.on('log', (message: string) => {
    broadcast({ type: 'log', message });
  });

  bot.on('analysis', (analysis: any) => {
    broadcast({ type: 'analysis', analysis, stats: bot.getStats() });
  });

  bot.on('game_over', (stats: any) => {
    broadcast({ type: 'game_over', stats });
  });

  bot.on('error', (error: any) => {
    broadcast({ type: 'error', message: error.message });
  });

  // Serve screenshot images
  app.get('/screenshot', (req, res) => {
    const stats = bot.getStats();
    if (stats.lastScreenshot && existsSync(stats.lastScreenshot)) {
      res.sendFile(stats.lastScreenshot);
    } else {
      res.status(404).send('No screenshot yet');
    }
  });

  app.get('/stats', (req, res) => {
    res.json(bot.getStats());
  });

  // Serve dashboard HTML
  app.get('/', (req, res) => {
    res.send(getDashboardHTML());
  });

  // WebSocket connections
  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    // Send current state
    ws.send(JSON.stringify({ type: 'init', stats: bot.getStats(), config: bot.getConfig() }));

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        switch (msg.type) {
          case 'start':
            bot.start();
            break;
          case 'stop':
            bot.stop();
            break;
          case 'set_stake':
            bot.setStake(msg.stake);
            break;
        }
      } catch {}
    });

    ws.on('close', () => clients.delete(ws));
  });

  server.listen(port, () => {
    console.log(`\n  Dashboard: http://localhost:${port}\n`);
  });

  return server;
}

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WHOT AUTOPILOT — Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0e17; --surface: #141b2d; --elevated: #1e2940;
      --text: #e8eaf0; --dim: #8892a8; --accent: #6366f1;
      --green: #22c55e; --red: #ef4444; --yellow: #f59e0b;
      --font: 'SF Pro Display', -apple-system, system-ui, sans-serif;
      --mono: 'SF Mono', 'Menlo', monospace;
    }
    body { font-family: var(--font); background: var(--bg); color: var(--text); min-height: 100vh; }

    .header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1rem 1.5rem; background: var(--surface); border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .header h1 { font-size: 1.1rem; font-weight: 700; }
    .header h1 span { color: var(--accent); }
    .status-badge {
      padding: 0.3rem 0.7rem; border-radius: 20px; font-size: 0.75rem; font-weight: 600;
    }
    .status-badge.running { background: rgba(34,197,94,0.15); color: var(--green); }
    .status-badge.stopped { background: rgba(239,68,68,0.15); color: var(--red); }

    .main { display: grid; grid-template-columns: 1fr 360px; gap: 1px; background: rgba(255,255,255,0.05); min-height: calc(100vh - 56px); }

    .left-panel { background: var(--bg); padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; }
    .right-panel { background: var(--bg); display: flex; flex-direction: column; }

    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; }
    .stat-card {
      background: var(--surface); border-radius: 10px; padding: 1rem;
      border: 1px solid rgba(255,255,255,0.04);
    }
    .stat-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim); margin-bottom: 0.3rem; }
    .stat-value { font-size: 1.5rem; font-weight: 700; font-family: var(--mono); }
    .stat-value.green { color: var(--green); }
    .stat-value.red { color: var(--red); }
    .stat-value.yellow { color: var(--yellow); }

    .screenshot-section { flex: 1; display: flex; flex-direction: column; gap: 0.75rem; }
    .screenshot-section h3 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim); }
    .screenshot-frame {
      flex: 1; background: var(--surface); border-radius: 10px; overflow: hidden;
      display: flex; align-items: center; justify-content: center; min-height: 300px;
      border: 1px solid rgba(255,255,255,0.04);
    }
    .screenshot-frame img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .screenshot-frame .placeholder { color: var(--dim); font-size: 0.85rem; }

    .current-state {
      background: var(--surface); border-radius: 10px; padding: 1rem;
      border: 1px solid rgba(255,255,255,0.04);
    }
    .state-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim); margin-bottom: 0.4rem; }
    .state-value { font-size: 0.9rem; font-weight: 600; color: var(--accent); }
    .action-text { font-size: 0.85rem; color: var(--text); margin-top: 0.5rem; }
    .reasoning-text { font-size: 0.78rem; color: var(--dim); margin-top: 0.3rem; font-style: italic; }

    .controls {
      padding: 1rem; background: var(--surface); border-bottom: 1px solid rgba(255,255,255,0.05);
      display: flex; gap: 0.5rem; align-items: center;
    }
    .btn {
      padding: 0.5rem 1rem; border: none; border-radius: 8px; font-family: var(--font);
      font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s;
    }
    .btn-start { background: var(--green); color: white; }
    .btn-stop { background: var(--red); color: white; }
    .btn-start:hover { background: #16a34a; }
    .btn-stop:hover { background: #dc2626; }

    .stake-select {
      margin-left: auto; display: flex; align-items: center; gap: 0.5rem;
    }
    .stake-select label { font-size: 0.75rem; color: var(--dim); }
    .stake-select select {
      padding: 0.4rem 0.6rem; background: var(--elevated); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px; color: var(--text); font-family: var(--mono); font-size: 0.8rem;
    }

    .log-section { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .log-header {
      padding: 0.75rem 1rem; font-size: 0.75rem; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--dim); font-weight: 600;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .log-entries {
      flex: 1; overflow-y: auto; padding: 0.5rem 1rem; display: flex; flex-direction: column; gap: 2px;
    }
    .log-entry { font-size: 0.72rem; font-family: var(--mono); color: var(--dim); padding: 0.2rem 0; line-height: 1.5; }
    .log-entry.error { color: var(--red); }
    .log-entry.action { color: var(--green); }
    .log-entry.game { color: var(--yellow); }

    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>WHOT <span>AUTOPILOT</span></h1>
    <span id="statusBadge" class="status-badge stopped">STOPPED</span>
  </div>

  <div class="main">
    <div class="left-panel">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Games</div>
          <div class="stat-value" id="statGames">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Wins</div>
          <div class="stat-value green" id="statWins">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Losses</div>
          <div class="stat-value red" id="statLosses">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Earnings</div>
          <div class="stat-value yellow" id="statEarnings">0</div>
        </div>
      </div>

      <div class="current-state">
        <div class="state-label">Current State</div>
        <div class="state-value" id="currentState">—</div>
        <div class="action-text" id="currentAction">Waiting to start...</div>
        <div class="reasoning-text" id="currentReasoning"></div>
      </div>

      <div class="screenshot-section">
        <h3>Live View</h3>
        <div class="screenshot-frame">
          <img id="screenshotImg" style="display:none" />
          <span class="placeholder" id="screenshotPlaceholder">No screenshot yet — click START</span>
        </div>
      </div>
    </div>

    <div class="right-panel">
      <div class="controls">
        <button class="btn btn-start" id="btnStart" onclick="sendCmd('start')">START</button>
        <button class="btn btn-stop" id="btnStop" onclick="sendCmd('stop')">STOP</button>
        <div class="stake-select">
          <label>Stake:</label>
          <select id="stakeSelect" onchange="sendCmd('set_stake', {stake: parseInt(this.value)})">
            <option value="1000">1,000</option>
            <option value="2000">2,000</option>
            <option value="5000">5,000</option>
            <option value="10000">10,000</option>
            <option value="25000">25,000</option>
          </select>
        </div>
      </div>
      <div class="log-section">
        <div class="log-header">Activity Log</div>
        <div class="log-entries" id="logEntries"></div>
      </div>
    </div>
  </div>

  <script>
    const ws = new WebSocket('ws://' + location.host);
    const logEntries = document.getElementById('logEntries');
    let screenshotTimer = null;

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case 'init':
          updateStats(msg.stats);
          break;
        case 'log':
          addLog(msg.message);
          break;
        case 'analysis':
          updateStats(msg.stats);
          updateAnalysis(msg.analysis);
          refreshScreenshot();
          break;
        case 'game_over':
          updateStats(msg.stats);
          addLog('=== GAME OVER ===', 'game');
          break;
        case 'error':
          addLog('ERROR: ' + msg.message, 'error');
          break;
      }
    };

    function sendCmd(type, data = {}) {
      ws.send(JSON.stringify({ type, ...data }));
    }

    function updateStats(stats) {
      if (!stats) return;
      document.getElementById('statGames').textContent = stats.gamesPlayed;
      document.getElementById('statWins').textContent = stats.wins;
      document.getElementById('statLosses').textContent = stats.losses;
      document.getElementById('statEarnings').textContent = stats.totalEarnings.toLocaleString();
      document.getElementById('currentState').textContent = stats.currentState || '—';
      document.getElementById('currentAction').textContent = stats.lastAction || '';
      document.getElementById('currentReasoning').textContent = stats.lastReasoning || '';

      const badge = document.getElementById('statusBadge');
      if (stats.isRunning) {
        badge.textContent = 'RUNNING';
        badge.className = 'status-badge running';
      } else {
        badge.textContent = 'STOPPED';
        badge.className = 'status-badge stopped';
      }
    }

    function updateAnalysis(analysis) {
      if (!analysis) return;
      document.getElementById('currentState').textContent = analysis.screen;
      document.getElementById('currentAction').textContent = analysis.action;
      document.getElementById('currentReasoning').textContent = analysis.reasoning || '';
    }

    function refreshScreenshot() {
      const img = document.getElementById('screenshotImg');
      const placeholder = document.getElementById('screenshotPlaceholder');
      img.src = '/screenshot?' + Date.now();
      img.style.display = 'block';
      placeholder.style.display = 'none';
    }

    function addLog(message, type = '') {
      const el = document.createElement('div');
      el.className = 'log-entry ' + type;
      el.textContent = message;
      logEntries.appendChild(el);
      logEntries.scrollTop = logEntries.scrollHeight;
      // Keep last 200 entries
      while (logEntries.children.length > 200) logEntries.removeChild(logEntries.firstChild);
    }
  </script>
</body>
</html>`;
}
