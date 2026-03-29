import { WindowBounds } from './screen.js';

export interface ClickPosition {
  imageX: number;
  imageY: number;
  screenX: number;
  screenY: number;
}

// Calculate where a card is in the image based on its index in the hand
export function getCardClickPosition(
  cardIndex: number,
  totalCards: number,
  imageWidth: number,
  imageHeight: number,
  bounds: WindowBounds
): ClickPosition {
  // Cards are displayed at the bottom of the app window
  // From the screenshots: cards are in a horizontal row at ~87% down
  // Cards span roughly 60-80% of the window width, centered
  // Each card is roughly equal width, spaced evenly

  const cardAreaWidth = imageWidth * 0.75; // cards take up ~75% of width
  const cardWidth = Math.min(80, cardAreaWidth / totalCards);
  const totalHandWidth = totalCards * cardWidth;
  const startX = (imageWidth - totalHandWidth) / 2 + cardWidth / 2;

  const imgX = Math.round(startX + cardIndex * cardWidth);
  const imgY = Math.round(imageHeight * 0.87);

  return toScreen(imgX, imgY, imageWidth, imageHeight, bounds);
}

// Calculate where the market/draw pile is
export function getMarketClickPosition(
  imageWidth: number,
  imageHeight: number,
  bounds: WindowBounds
): ClickPosition {
  // Market pile is to the right of center on the game table
  // From screenshots: roughly at 60% across, 52% down
  const imgX = Math.round(imageWidth * 0.60);
  const imgY = Math.round(imageHeight * 0.52);

  return toScreen(imgX, imgY, imageWidth, imageHeight, bounds);
}

// Button positions for lobby/menu screens
export function getButtonClickPosition(
  buttonType: 'play_multiplayer' | 'play_first_mode' | 'join_room_free' | 'join_room_1000' | 'join_room_2000' |
    'join_room_5000' | 'join_room_10000' | 'join_room_25000' | 'yes_continue' | 'scroll_target',
  imageWidth: number,
  imageHeight: number,
  bounds: WindowBounds
): ClickPosition {
  let imgX: number;
  let imgY: number;

  switch (buttonType) {
    case 'play_multiplayer':
      imgX = imageWidth * 0.50;
      imgY = imageHeight * 0.30;
      break;
    case 'play_first_mode':
      imgX = imageWidth * 0.50;
      imgY = imageHeight * 0.28;
      break;
    case 'join_room_25000':
      imgX = imageWidth * 0.50;
      imgY = imageHeight * 0.18;
      break;
    case 'join_room_10000':
      imgX = imageWidth * 0.50;
      imgY = imageHeight * 0.32;
      break;
    case 'join_room_5000':
      imgX = imageWidth * 0.50;
      imgY = imageHeight * 0.46;
      break;
    case 'join_room_2000':
      imgX = imageWidth * 0.50;
      imgY = imageHeight * 0.60;
      break;
    case 'join_room_1000':
      imgX = imageWidth * 0.50;
      imgY = imageHeight * 0.82;
      break;
    case 'join_room_free':
      // Fresher's Room is at the very bottom after scrolling
      imgX = imageWidth * 0.50;
      imgY = imageHeight * 0.955;
      break;
    case 'yes_continue':
      // Dark red "YES, CONTINUE" button — roughly 50% across, 62% down
      imgX = imageWidth * 0.50;
      imgY = imageHeight * 0.62;
      break;
    default:
      imgX = imageWidth * 0.50;
      imgY = imageHeight * 0.50;
  }

  return toScreen(Math.round(imgX), Math.round(imgY), imageWidth, imageHeight, bounds);
}

// Convert image coordinates to screen coordinates
function toScreen(
  imgX: number,
  imgY: number,
  imageWidth: number,
  imageHeight: number,
  bounds: WindowBounds
): ClickPosition {
  const scaleX = bounds.width / imageWidth;
  const scaleY = bounds.height / imageHeight;

  const screenX = bounds.x + Math.round(imgX * scaleX);
  const screenY = bounds.y + Math.round(imgY * scaleY);

  return { imageX: imgX, imageY: imgY, screenX, screenY };
}
