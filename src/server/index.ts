import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { WhotGame } from '../engine/game.js';
import { WhotAI } from '../ai/agent.js';
import { Suit } from '../engine/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files
app.use(express.static(join(__dirname, '../../public')));

// Game rooms
const games = new Map<string, WhotGame>();
const aiAgents = new Map<string, WhotAI>();
const clients = new Map<WebSocket, { gameId: string; playerId: string }>();

function generateId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function broadcastToGame(gameId: string, message: any, excludeWs?: WebSocket): void {
  for (const [ws, info] of clients.entries()) {
    if (info.gameId === gameId && ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      const playerState = games.get(gameId)?.getPlayerState(info.playerId);
      ws.send(JSON.stringify({ ...message, state: playerState }));
    }
  }
}

function sendToClient(ws: WebSocket, message: any): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

async function processAITurns(gameId: string): Promise<void> {
  const game = games.get(gameId);
  if (!game || game.state.phase === 'game_over') return;

  const currentPlayer = game.getCurrentPlayer();
  if (!currentPlayer.isAI) return;

  const ai = aiAgents.get(gameId);
  if (!ai) return;

  // Small delay so humans can see what's happening
  await new Promise(resolve => setTimeout(resolve, 800));

  try {
    await ai.makeMove(game, currentPlayer.id);
  } catch (err) {
    console.error('AI move error:', err);
    return;
  }

  // Broadcast updated state to all human players
  broadcastToGame(gameId, { type: 'state_update' });

  // Check if game is over
  if ((game.state.phase as string) === 'game_over') {
    broadcastToGame(gameId, {
      type: 'game_over',
      winner: game.state.winner,
      method: game.state.drawPile.length === 0 ? 'market_exhausted' : 'check_up',
    });
    return;
  }

  // If next player is also AI, continue
  if (game.getCurrentPlayer().isAI) {
    await processAITurns(gameId);
  }
}

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected');

  ws.on('message', async (data: Buffer) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      sendToClient(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    try {
      switch (msg.type) {
        case 'create_game': {
          const gameId = generateId();
          const game = new WhotGame(gameId);
          const playerId = `player_${generateId()}`;
          const playerName = msg.name || 'Player 1';

          game.addPlayer(playerId, playerName, false);
          games.set(gameId, game);

          const ai = new WhotAI(msg.difficulty || 'hard');
          aiAgents.set(gameId, ai);

          clients.set(ws, { gameId, playerId });

          // Add AI opponents
          const aiCount = Math.min(msg.aiPlayers || 1, 3);
          const aiNames = ['Agent Alpha', 'Agent Beta', 'Agent Gamma'];
          for (let i = 0; i < aiCount; i++) {
            game.addPlayer(`ai_${i}`, aiNames[i], true);
          }

          sendToClient(ws, {
            type: 'game_created',
            gameId,
            playerId,
            state: game.getPlayerState(playerId),
          });
          break;
        }

        case 'start_game': {
          const info = clients.get(ws);
          if (!info) break;
          const game = games.get(info.gameId);
          if (!game) break;

          game.startGame();

          // Set up game event forwarding
          game.on('log', (entry) => {
            broadcastToGame(info.gameId, { type: 'log', entry });
          });

          broadcastToGame(info.gameId, { type: 'game_started' });

          // If first player is AI, process their turn
          if (game.getCurrentPlayer().isAI) {
            await processAITurns(info.gameId);
          }
          break;
        }

        case 'play_card': {
          const info = clients.get(ws);
          if (!info) break;
          const game = games.get(info.gameId);
          if (!game) break;

          const declaredSuit = msg.suit as Suit | undefined;
          game.playCard(info.playerId, msg.cardId, declaredSuit);

          broadcastToGame(info.gameId, { type: 'state_update' });

          if (game.state.phase === 'game_over') {
            broadcastToGame(info.gameId, {
              type: 'game_over',
              winner: game.state.winner,
            });
          } else if (game.state.phase === 'whot_suit_selection') {
            sendToClient(ws, {
              type: 'need_suit_selection',
              state: game.getPlayerState(info.playerId),
            });
          } else {
            await processAITurns(info.gameId);
          }
          break;
        }

        case 'draw_card': {
          const info = clients.get(ws);
          if (!info) break;
          const game = games.get(info.gameId);
          if (!game) break;

          game.drawCard(info.playerId);
          broadcastToGame(info.gameId, { type: 'state_update' });

          if (game.state.phase === 'game_over') {
            broadcastToGame(info.gameId, {
              type: 'game_over',
              winner: game.state.winner,
            });
          } else {
            await processAITurns(info.gameId);
          }
          break;
        }

        case 'declare_suit': {
          const info = clients.get(ws);
          if (!info) break;
          const game = games.get(info.gameId);
          if (!game) break;

          game.declareWhotSuit(info.playerId, msg.suit);
          broadcastToGame(info.gameId, { type: 'state_update' });
          await processAITurns(info.gameId);
          break;
        }

        case 'announce': {
          const info = clients.get(ws);
          if (!info) break;
          const game = games.get(info.gameId);
          if (!game) break;

          game.announce(info.playerId, msg.announcement);
          broadcastToGame(info.gameId, { type: 'state_update' });
          break;
        }
      }
    } catch (err: any) {
      sendToClient(ws, { type: 'error', message: err.message });
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (info) {
      console.log(`Player disconnected from game ${info.gameId}`);
      clients.delete(ws);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`WHOT AGENT server running on http://localhost:${PORT}`);
});
