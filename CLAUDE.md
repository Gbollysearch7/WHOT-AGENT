# WHOT AGENT

AI-powered Whot card game with WebSocket multiplayer.

## Stack
- TypeScript (ES2022 modules)
- Express + WebSocket (ws) server
- Vanilla JS frontend with CSS custom properties
- No framework — pure DOM manipulation

## Structure
```
src/
  engine/     # Game logic: types, deck, game state machine
  ai/         # AI agent with easy/medium/hard strategies
  server/     # Express + WebSocket game server
public/       # Static frontend: HTML, CSS, client JS
```

## Commands
- `npm run dev` — Start dev server with hot reload (tsx)
- `npm run build` — Compile TypeScript to dist/
- `npm start` — Run compiled server
- Server runs on http://localhost:3000

## Game Rules
See PLAN.md for the complete, authoritative Whot rule spec.

## Key Design Decisions
- Game engine is a pure state machine (WhotGame class) with event emitter
- AI agent scores all playable cards and picks the highest-scored move
- WebSocket handles real-time play; AI turns have 800ms delay for UX
- Cards dealt from official 54-card Naija Whot deck distribution
