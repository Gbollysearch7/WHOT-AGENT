import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { ScreenState, VisionResult, buildReadOnlyPrompt } from './vision.js';
import { parseCardList, ParsedCard } from './card-normalizer.js';
import { StateTracker } from './state-tracker.js';
import { makeDecision, Decision } from './decision-engine.js';
import { getCardClickPosition, getMarketClickPosition, getButtonClickPosition, ClickPosition } from './click-calculator.js';
import { WindowBounds } from './screen.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export interface PipelineResult {
  // From vision
  screen: ScreenState;
  vision: VisionResult;

  // From decision engine (only when game_playing + my turn)
  decision?: Decision;

  // Click to execute
  click?: ClickPosition;

  // For logging
  stateTrackerSummary?: string;
}

// Step 1: Send screenshot to Claude — READ ONLY
async function readScreen(screenshotPath: string, targetStake: number): Promise<VisionResult> {
  const imageData = readFileSync(screenshotPath);
  const base64 = imageData.toString('base64');

  const prompt = buildReadOnlyPrompt(targetStake);

  const response = await getClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512, // Much smaller — just reading, not strategizing
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: base64 },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  const textBlock = response.content.find(block => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  let jsonStr = textBlock.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
  }

  try {
    return JSON.parse(jsonStr) as VisionResult;
  } catch {
    console.error('Failed to parse vision response:', jsonStr);
    return { screen: 'unknown' };
  }
}

// Full pipeline: Vision → Normalize → Track → Decide → Click
export async function analyzePipeline(
  screenshotPath: string,
  targetStake: number,
  stateTracker: StateTracker,
  imageWidth: number,
  imageHeight: number,
  bounds: WindowBounds | null,
): Promise<PipelineResult> {
  // Step 1: Read screen with Claude Vision
  const vision = await readScreen(screenshotPath, targetStake);
  const result: PipelineResult = { screen: vision.screen, vision };

  if (!bounds) {
    return result; // Can't calculate clicks without window bounds
  }

  // Step 2: Handle non-game screens (buttons to click)
  switch (vision.screen) {
    case 'home':
      result.click = getButtonClickPosition('play_multiplayer', imageWidth, imageHeight, bounds);
      return result;

    case 'multiplayer_menu':
      result.click = getButtonClickPosition('play_first_mode', imageWidth, imageHeight, bounds);
      return result;

    case 'lobby': {
      if (vision.scrollNeeded) {
        return result; // Bot will handle scrolling
      }
      const stakeKey = targetStake === 0 ? 'join_room_free' : `join_room_${targetStake}`;
      result.click = getButtonClickPosition(stakeKey as any, imageWidth, imageHeight, bounds);
      return result;
    }

    case 'join_confirm':
    case 'game_confirm':
      result.click = getButtonClickPosition('yes_continue', imageWidth, imageHeight, bounds);
      return result;

    case 'waiting':
    case 'starting':
      return result; // No action needed

    case 'game_over':
      // Click somewhere to return (center of screen)
      result.click = { imageX: imageWidth / 2, imageY: imageHeight / 2, screenX: bounds.x + bounds.width / 2, screenY: bounds.y + bounds.height / 2 };
      return result;
  }

  // Step 3: Game playing — the interesting part
  if (vision.screen === 'game_playing' && vision.gameState) {
    const gs = vision.gameState;

    // Normalize cards
    const myCards = parseCardList(Array.isArray(gs.myCards) ? gs.myCards : []);
    const topCard = gs.topCard ? parseCardList([gs.topCard])[0] || null : null;

    // Update state tracker
    stateTracker.update({
      myCards,
      topCard,
      opponentCards: gs.opponentCards || 0,
      marketCards: gs.marketCards || 0,
      isMyTurn: gs.isMyTurn || false,
    });

    result.stateTrackerSummary = stateTracker.getHandSummary();

    // If not my turn, don't decide
    if (!gs.isMyTurn) {
      return result;
    }

    // Step 4: Decision engine picks the best card
    const trackedState = stateTracker.getState();
    const requiredSuit = gs.requiredSuit as any || null;
    const decision = makeDecision(trackedState, requiredSuit);
    result.decision = decision;

    // Step 5: Calculate click position
    if (decision.action === 'play' && decision.cardIndex >= 0) {
      result.click = getCardClickPosition(
        decision.cardIndex,
        myCards.length,
        imageWidth,
        imageHeight,
        bounds
      );
    } else if (decision.action === 'draw') {
      result.click = getMarketClickPosition(imageWidth, imageHeight, bounds);
    }
  }

  return result;
}
