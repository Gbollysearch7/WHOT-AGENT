import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { AnalysisResult, ScreenState, buildAnalysisPrompt } from './vision.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export async function analyzeScreenshot(
  screenshotPath: string,
  context: {
    targetStake: number;
    previousState?: ScreenState;
    strategyBrief?: string;
  }
): Promise<AnalysisResult> {
  const imageData = readFileSync(screenshotPath);
  const base64 = imageData.toString('base64');
  const mediaType = 'image/png';

  const prompt = buildAnalysisPrompt(context);

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  });

  // Extract text from response
  const textBlock = response.content.find(block => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  const rawText = textBlock.text.trim();

  // Parse JSON — handle potential markdown wrapping
  let jsonStr = rawText;
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
  }

  try {
    const result = JSON.parse(jsonStr) as AnalysisResult;
    return result;
  } catch (e) {
    console.error('Failed to parse Claude response:', rawText);
    return {
      screen: 'unknown',
      action: 'Could not parse response',
      reasoning: rawText,
    };
  }
}
