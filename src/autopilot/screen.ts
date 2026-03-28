import { execSync } from 'child_process';
import { existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';

const SCREENSHOT_DIR = join(process.cwd(), 'tmp');
const BUNDLE_ID = 'com.rahmayowa.whott';
const MAX_IMAGE_BYTES = 4_500_000;

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function ensureTmpDir(): void {
  if (!existsSync(SCREENSHOT_DIR)) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

export function getWindowBounds(): WindowBounds | null {
  try {
    const x = parseInt(execSync(`osascript -e 'tell application "System Events" to tell process "WhotoWhoto" to return item 1 of (get position of window 1)'`, { encoding: 'utf-8' }).trim());
    const y = parseInt(execSync(`osascript -e 'tell application "System Events" to tell process "WhotoWhoto" to return item 2 of (get position of window 1)'`, { encoding: 'utf-8' }).trim());
    const w = parseInt(execSync(`osascript -e 'tell application "System Events" to tell process "WhotoWhoto" to return item 1 of (get size of window 1)'`, { encoding: 'utf-8' }).trim());
    const h = parseInt(execSync(`osascript -e 'tell application "System Events" to tell process "WhotoWhoto" to return item 2 of (get size of window 1)'`, { encoding: 'utf-8' }).trim());
    return { x, y, width: w, height: h };
  } catch {
    return null;
  }
}

// Capture ONLY the app window — not the full screen
export function captureAppWindow(filename: string = 'screen.png'): { path: string; bounds: WindowBounds | null } {
  ensureTmpDir();
  const filepath = join(SCREENSHOT_DIR, filename);
  const bounds = getWindowBounds();

  if (bounds) {
    // Capture a specific region of the screen (the app window)
    // screencapture -R x,y,w,h captures a rectangle
    // Coordinates are in points, screencapture uses points on retina
    try {
      execSync(`screencapture -x -R${bounds.x},${bounds.y},${bounds.width},${bounds.height} "${filepath}"`, { encoding: 'utf-8' });
      compressImage(filepath);
      return { path: filepath, bounds };
    } catch {}
  }

  // Fallback: full screen
  execSync(`screencapture -x "${filepath}"`, { encoding: 'utf-8' });
  compressImage(filepath);
  return { path: filepath, bounds: null };
}

function compressImage(filepath: string): void {
  try {
    // Resize to max 1000px wide — keeps under API limit and still readable
    execSync(`sips --resampleWidth 1000 "${filepath}" 2>/dev/null`, { encoding: 'utf-8' });
    const stats = statSync(filepath);
    if (stats.size > MAX_IMAGE_BYTES) {
      const jpgPath = filepath.replace('.png', '.jpg');
      execSync(`sips -s format jpeg -s formatOptions 70 "${filepath}" --out "${jpgPath}" 2>/dev/null`, { encoding: 'utf-8' });
      execSync(`mv "${jpgPath}" "${filepath}"`, { encoding: 'utf-8' });
    }
  } catch {}
}

export function focusApp(): void {
  try {
    execSync(`osascript -e 'tell application "WhotoWhoto" to activate'`, { encoding: 'utf-8' });
  } catch {
    try { execSync(`open -a "Whoto Whoto"`, { encoding: 'utf-8' }); } catch {}
  }
}

// Click at position relative to the APP WINDOW (not the screen)
// imageX, imageY = coordinates in the 1000px-wide captured image
// bounds = the app window's position on screen
export function clickInApp(imageX: number, imageY: number, imageWidth: number, imageHeight: number, bounds: WindowBounds): void {
  // Scale from image coordinates to window coordinates (points)
  const scaleX = bounds.width / imageWidth;
  const scaleY = bounds.height / imageHeight;

  // Convert to absolute screen position
  const screenX = bounds.x + Math.round(imageX * scaleX);
  const screenY = bounds.y + Math.round(imageY * scaleY);

  console.log(`  Click mapping: img(${imageX},${imageY}) → window(${Math.round(imageX * scaleX)},${Math.round(imageY * scaleY)}) → screen(${screenX},${screenY})`);

  execSync(`osascript -e 'tell application "System Events" to click at {${screenX}, ${screenY}}'`);
}

export function clickAt(x: number, y: number): void {
  execSync(`osascript -e 'tell application "System Events" to click at {${Math.round(x)}, ${Math.round(y)}}'`);
}

export function scrollDown(x: number, y: number, amount: number = 5): void {
  for (let i = 0; i < amount; i++) {
    try {
      execSync(`osascript -e 'tell application "System Events" to key code 125'`);
    } catch {}
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
