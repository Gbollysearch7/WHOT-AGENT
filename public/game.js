// ═══════════════════════════════════
// WHOT AGENT — Client Game Logic
// ═══════════════════════════════════

const SUIT_SYMBOLS = {
  circle: '●', triangle: '▲', cross: '✚',
  square: '■', star: '★', whot: 'W',
};

const SUIT_COLORS = {
  circle: '#ef4444', triangle: '#22c55e', cross: '#3b82f6',
  square: '#f59e0b', star: '#a855f7', whot: '#6366f1',
};

const SPECIAL_NAMES = {
  1: 'Hold On', 2: 'Pick Two', 8: 'Suspension',
  14: 'General Market', 20: 'WHOT',
};

// ── State ──
let ws = null;
let gameState = null;
let myPlayerId = null;
let selectedAI = 1;
let selectedDifficulty = 'hard';

// ── DOM Elements ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const lobbyScreen = $('#lobby');
const gameScreen = $('#game');
const playerNameInput = $('#playerName');
const startBtn = $('#startBtn');
const playerHand = $('#playerHand');
const discardPile = $('#discardPile');
const drawPile = $('#drawPile');
const opponents = $('#opponents');
const turnInfo = $('#turnInfo');
const statusText = $('#statusText');
const drawCount = $('#drawCount');
const handCount = $('#handCount');
const playerNameDisplay = $('#playerNameDisplay');
const pickTwoBanner = $('#pickTwoBanner');
const penaltyAmount = $('#penaltyAmount');
const suitModal = $('#suitModal');
const gameOverModal = $('#gameOverModal');
const requiredSuitEl = $('#requiredSuit');
const announceBtn = $('#announceBtn');
const logToggle = $('#logToggle');
const logEntries = $('#logEntries');
const gameLog = $('.game-log');

// ── Toast System ──
let toastContainer = document.createElement('div');
toastContainer.className = 'toast-container';
document.body.appendChild(toastContainer);

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Lobby Setup ──
$$('.btn-option[data-ai]').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.btn-option[data-ai]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedAI = parseInt(btn.dataset.ai);
  });
});

$$('.btn-option[data-diff]').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.btn-option[data-diff]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedDifficulty = btn.dataset.diff;
  });
});

startBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim() || 'Player';
  connectAndCreateGame(name);
});

// ── WebSocket Connection ──
function connectAndCreateGame(playerName) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'create_game',
      name: playerName,
      aiPlayers: selectedAI,
      difficulty: selectedDifficulty,
    }));
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    showToast('Disconnected from server', 'danger');
  };

  ws.onerror = () => {
    showToast('Connection error', 'danger');
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ── Message Handler ──
function handleMessage(msg) {
  switch (msg.type) {
    case 'game_created':
      myPlayerId = msg.playerId;
      gameState = msg.state;
      lobbyScreen.classList.remove('active');
      gameScreen.classList.add('active');
      // Auto-start the game
      send({ type: 'start_game' });
      break;

    case 'game_started':
      if (msg.state) gameState = msg.state;
      showToast('Game started!', 'success');
      renderGame();
      break;

    case 'state_update':
      if (msg.state) gameState = msg.state;
      renderGame();
      break;

    case 'need_suit_selection':
      if (msg.state) gameState = msg.state;
      renderGame();
      suitModal.classList.remove('hidden');
      break;

    case 'game_over':
      if (msg.state) gameState = msg.state;
      renderGame();
      showGameOver(msg);
      break;

    case 'log':
      addLogEntry(msg.entry);
      break;

    case 'error':
      showToast(msg.message, 'danger');
      break;
  }
}

// ── Card Rendering ──
function createCardElement(card, options = {}) {
  const el = document.createElement('div');
  el.className = `game-card suit-${card.suit}`;
  if (options.playable) el.classList.add('playable');
  if (options.notPlayable) el.classList.add('not-playable');
  if (options.dealt) el.classList.add('dealt');

  const symbol = SUIT_SYMBOLS[card.suit] || 'W';
  const number = card.number;
  const specialName = SPECIAL_NAMES[number] || '';

  el.innerHTML = `
    <span class="card-corner card-corner-tl">${symbol} ${number}</span>
    <span class="card-suit-symbol">${symbol}</span>
    <span class="card-number">${number}</span>
    ${specialName ? `<span style="font-size:0.55rem;color:rgba(255,255,255,0.5);margin-top:2px;font-weight:500">${specialName}</span>` : ''}
    <span class="card-corner card-corner-br">${symbol} ${number}</span>
  `;

  if (options.onClick) {
    el.addEventListener('click', () => options.onClick(card));
  }

  return el;
}

// ── Game Rendering ──
function renderGame() {
  if (!gameState) return;

  const isMyTurn = gameState.currentPlayerId === myPlayerId;

  // Turn info
  turnInfo.textContent = `Turn ${gameState.turnNumber}`;
  drawCount.textContent = gameState.drawPileCount;

  // Status
  if (gameState.phase === 'game_over') {
    statusText.textContent = 'Game Over';
    statusText.className = 'status-text';
  } else if (isMyTurn) {
    if (gameState.phase === 'pick_two_pending') {
      statusText.textContent = `Your turn — Play a 2 or draw ${gameState.pickTwoPenalty}!`;
      statusText.className = 'status-text';
      statusText.style.color = 'var(--danger)';
      statusText.style.background = 'rgba(239,68,68,0.1)';
    } else {
      statusText.textContent = 'Your turn';
      statusText.className = 'status-text';
      statusText.style.color = '';
      statusText.style.background = '';
    }
  } else {
    const currentPlayer = gameState.players.find(p => p.id === gameState.currentPlayerId);
    statusText.textContent = `${currentPlayer?.name || 'AI'} is thinking...`;
    statusText.className = 'status-text waiting';
  }

  // Pick two banner
  if (gameState.phase === 'pick_two_pending' && gameState.pickTwoPenalty > 0) {
    pickTwoBanner.classList.remove('hidden');
    penaltyAmount.textContent = gameState.pickTwoPenalty;
  } else {
    pickTwoBanner.classList.add('hidden');
  }

  // Required suit indicator
  if (gameState.requiredSuit) {
    requiredSuitEl.classList.remove('hidden');
    const sym = SUIT_SYMBOLS[gameState.requiredSuit];
    const col = SUIT_COLORS[gameState.requiredSuit];
    requiredSuitEl.innerHTML = `Must play: <span style="color:${col}">${sym} ${gameState.requiredSuit}</span>`;
  } else {
    requiredSuitEl.classList.add('hidden');
  }

  // Render discard pile
  renderDiscardPile();

  // Render opponents
  renderOpponents();

  // Render player hand
  renderPlayerHand();

  // Draw pile interaction
  drawPile.onclick = isMyTurn ? () => handleDrawCard() : null;
  drawPile.style.cursor = isMyTurn ? 'pointer' : 'default';
  drawPile.style.opacity = isMyTurn ? '1' : '0.6';

  // Announce button
  renderAnnounceButton();
}

function renderDiscardPile() {
  discardPile.innerHTML = '';
  if (gameState.topCard) {
    const cardEl = createCardElement(gameState.topCard);
    discardPile.appendChild(cardEl);
  }
}

function renderOpponents() {
  opponents.innerHTML = '';
  for (const player of gameState.players) {
    if (player.id === myPlayerId) continue;

    const isActive = player.id === gameState.currentPlayerId;
    const el = document.createElement('div');
    el.className = `opponent ${isActive ? 'active' : ''}`;

    const miniCards = Array(Math.min(player.cardCount, 8))
      .fill('')
      .map(() => '<div class="mini-card"></div>')
      .join('');

    el.innerHTML = `
      <div class="opponent-avatar">${player.isAI ? '🤖' : '👤'}</div>
      <div class="opponent-info">
        <span class="opponent-name">${player.name}</span>
        <span class="opponent-cards">${player.cardCount} cards</span>
      </div>
      <div class="opponent-hand-visual">${miniCards}</div>
    `;

    opponents.appendChild(el);
  }
}

function renderPlayerHand() {
  playerHand.innerHTML = '';
  if (!gameState.myHand) return;

  const isMyTurn = gameState.currentPlayerId === myPlayerId;
  const playableIds = new Set(
    (gameState.playableCards || []).map(c => c.id)
  );

  playerNameDisplay.textContent = gameState.players.find(p => p.id === myPlayerId)?.name || 'You';
  handCount.textContent = `${gameState.myHand.length} cards`;

  gameState.myHand.forEach((card, i) => {
    const isPlayable = isMyTurn && playableIds.has(card.id);
    const cardEl = createCardElement(card, {
      playable: isPlayable,
      notPlayable: isMyTurn && !isPlayable,
      dealt: true,
      onClick: isPlayable ? () => handlePlayCard(card) : null,
    });

    // Stagger deal animation
    cardEl.style.animationDelay = `${i * 0.05}s`;
    playerHand.appendChild(cardEl);
  });
}

function renderAnnounceButton() {
  if (!gameState.myHand) return;
  const hand = gameState.myHand;
  const me = gameState.players.find(p => p.id === myPlayerId);
  if (!me) return;

  if (hand.length === 2 || hand.length === 1) {
    announceBtn.classList.remove('hidden');
    announceBtn.textContent = hand.length === 2 ? '📢 Semi Last Card!' : '📢 Last Card!';
    announceBtn.onclick = () => {
      send({ type: 'announce', announcement: hand.length === 2 ? 'semi_last' : 'last' });
      showToast(hand.length === 2 ? 'Semi last card!' : 'Last card!', 'warning');
      announceBtn.classList.add('hidden');
    };
  } else {
    announceBtn.classList.add('hidden');
  }
}

// ── Game Actions ──
function handlePlayCard(card) {
  if (card.suit === 'whot') {
    // Need to select a suit
    suitModal.classList.remove('hidden');
    // Store the card to play after suit selection
    suitModal._pendingCardId = card.id;
    return;
  }

  send({ type: 'play_card', cardId: card.id });

  // Optimistic animation
  const cardEls = playerHand.querySelectorAll('.game-card');
  cardEls.forEach(el => {
    if (el.querySelector('.card-corner-tl')?.textContent.includes(card.number)) {
      el.classList.add('playing');
    }
  });
}

function handleDrawCard() {
  send({ type: 'draw_card' });
  showToast('Drawing from market...', 'info');
}

// ── Suit Selection ──
$$('.suit-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const suit = btn.dataset.suit;
    suitModal.classList.add('hidden');

    if (suitModal._pendingCardId) {
      send({ type: 'play_card', cardId: suitModal._pendingCardId, suit });
      suitModal._pendingCardId = null;
    } else {
      send({ type: 'declare_suit', suit });
    }
  });
});

// ── Game Over ──
function showGameOver(msg) {
  gameOverModal.classList.remove('hidden');
  const gameOverTitle = $('#gameOverTitle');
  const gameOverMessage = $('#gameOverMessage');
  const gameOverIcon = $('#gameOverIcon');
  const gameOverScores = $('#gameOverScores');

  const winnerPlayer = gameState?.players?.find(p => p.id === msg.winner);
  const isWinner = msg.winner === myPlayerId;

  gameOverIcon.textContent = isWinner ? '🏆' : '😔';
  gameOverTitle.textContent = isWinner ? 'You Win!' : 'Game Over';
  gameOverMessage.textContent = isWinner
    ? 'Check up! You played all your cards!'
    : `${winnerPlayer?.name || 'AI'} wins!`;

  // Show scores if available
  gameOverScores.innerHTML = '';
  if (gameState?.players) {
    gameState.players
      .map(p => ({ name: p.name, cards: p.cardCount, id: p.id, score: p.score || 0 }))
      .sort((a, b) => a.cards - b.cards)
      .forEach(p => {
        const row = document.createElement('div');
        row.className = `score-row ${p.id === msg.winner ? 'winner' : ''}`;
        row.innerHTML = `
          <span>${p.name} ${p.id === msg.winner ? '👑' : ''}</span>
          <span>${p.cards} cards left</span>
        `;
        gameOverScores.appendChild(row);
      });
  }
}

$('#playAgainBtn').addEventListener('click', () => {
  gameOverModal.classList.add('hidden');
  gameScreen.classList.remove('active');
  lobbyScreen.classList.add('active');
  gameState = null;
  myPlayerId = null;
  if (ws) ws.close();
});

// ── Game Log ──
logToggle.addEventListener('click', () => {
  gameLog.classList.toggle('open');
});

function addLogEntry(entry) {
  if (!entry?.message) return;
  const el = document.createElement('div');
  el.className = 'log-entry';
  el.textContent = entry.message;
  logEntries.appendChild(el);
  logEntries.scrollTop = logEntries.scrollHeight;
}

// ── Keyboard shortcut ──
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && lobbyScreen.classList.contains('active')) {
    startBtn.click();
  }
  if (e.key === 'd' && gameScreen.classList.contains('active')) {
    if (gameState?.currentPlayerId === myPlayerId) {
      handleDrawCard();
    }
  }
});
