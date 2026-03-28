import { execSync } from 'child_process';
import { existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';

const SCREENSHOT_DIR = join(process.cwd(), 'tmp');
const BUNDLE_ID = 'com.rahmayowa.whott';
const MAX_IMAGE_BYTES = 4_500_000; // 4.5MB limit (Claude max is 5MB, leave buffer)

export interface WindowInfo {
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

export function getWindowId(): string | null {
  try {
    // Get window list via system_profiler/CGWindow
    const result = execSync(
      `osascript -e 'tell application "System Events" to tell process "WhotoWhoto" to return id of window 1'`,
      { encoding: 'utf-8' }
    ).trim();
    return result || null;
  } catch {
    return null;
  }
}

export function captureAppWindow(filename: string = 'screen.png'): string {
  ensureTmpDir();
  const filepath = join(SCREENSHOT_DIR, filename);

  // Try to get the window ID and capture just that window
  const windowId = getWindowId();
  if (windowId) {
    try {
      execSync(`screencapture -l ${windowId} -x "${filepath}"`, { encoding: 'utf-8' });
      // Check size and compress if needed
      compressIfNeeded(filepath);
      return filepath;
    } catch {}
  }

  // Fallback: capture full screen but compress it
  execSync(`screencapture -x "${filepath}"`, { encoding: 'utf-8' });
  compressIfNeeded(filepath);
  return filepath;
}

function compressIfNeeded(filepath: string): void {
  try {
    // Always resize to 1200px wide — keeps images under 2MB and still readable
    execSync(`sips --resampleWidth 1200 "${filepath}" 2>/dev/null`, { encoding: 'utf-8' });

    // Double check — if somehow still over limit, convert to JPEG
    const stats = statSync(filepath);
    if (stats.size > MAX_IMAGE_BYTES) {
      const jpgPath = filepath.replace('.png', '.jpg');
      execSync(`sips -s format jpeg -s formatOptions 70 "${filepath}" --out "${jpgPath}" 2>/dev/null`, { encoding: 'utf-8' });
      execSync(`mv "${jpgPath}" "${filepath}"`, { encoding: 'utf-8' });
    }
  } catch (e) {
    console.error('Compression failed:', e);
  }
}

export function captureFullScreen(filename: string = 'screen.png'): string {
  return captureAppWindow(filename);
}

export function focusApp(): void {
  try {
    execSync(`osascript -e 'tell application "WhotoWhoto" to activate'`, { encoding: 'utf-8' });
  } catch {
    try {
      execSync(`open -a "Whoto Whoto"`, { encoding: 'utf-8' });
    } catch {}
  }
}

export function clickAt(x: number, y: number): void {
  execSync(`osascript -e 'tell application "System Events" to click at {${Math.round(x)}, ${Math.round(y)}}'`);
}

export function scrollDown(x: number, y: number, amount: number = 5): void {
  // Use keyboard down arrow to scroll — most reliable across app types
  for (let i = 0; i < amount; i++) {
    try {
      execSync(`osascript -e 'tell application "System Events" to key code 125'`);
    } catch {}
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
