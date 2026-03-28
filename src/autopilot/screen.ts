import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const SCREENSHOT_DIR = join(process.cwd(), 'tmp');
const BUNDLE_ID = 'com.rahmayowa.whott';

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

export function getWindowInfo(): WindowInfo | null {
  try {
    const script = `
      tell application "System Events"
        set p to first process whose bundle identifier is "${BUNDLE_ID}"
        tell p
          set w to window 1
          set wPos to position of w
          set wSize to size of w
          return (item 1 of wPos) & "," & (item 2 of wPos) & "," & (item 1 of wSize) & "," & (item 2 of wSize)
        end tell
      end tell`;
    const result = execSync(`osascript -e '${script}'`, { encoding: 'utf-8' }).trim();
    const [x, y, width, height] = result.split(',').map(Number);
    return { x, y, width, height };
  } catch {
    // iOS app on Mac may not expose windows via AppleScript
    // Fall back to capturing by window name
    return null;
  }
}

export function captureScreen(filename: string = 'screen.png'): string {
  ensureTmpDir();
  const filepath = join(SCREENSHOT_DIR, filename);

  try {
    // Try capturing the specific app window by name
    execSync(
      `screencapture -l $(osascript -e 'tell application "System Events" to tell process "WhotoWhoto" to set w to window 1' -e 'tell application "System Events" to tell process "WhotoWhoto" to return id of window 1' 2>/dev/null) "${filepath}" 2>/dev/null`,
      { encoding: 'utf-8' }
    );
  } catch {
    // Fallback: capture the whole screen
    execSync(`screencapture -x "${filepath}"`, { encoding: 'utf-8' });
  }

  return filepath;
}

export function captureFullScreen(filename: string = 'screen.png'): string {
  ensureTmpDir();
  const filepath = join(SCREENSHOT_DIR, filename);
  execSync(`screencapture -x "${filepath}"`, { encoding: 'utf-8' });
  return filepath;
}

export function focusApp(): void {
  try {
    execSync(`osascript -e 'tell application "WhotoWhoto" to activate'`, { encoding: 'utf-8' });
  } catch {
    // Try alternative approach
    execSync(`open -a "Whoto Whoto"`, { encoding: 'utf-8' });
  }
}

export function clickAt(x: number, y: number): void {
  execSync(`osascript -e 'tell application "System Events" to click at {${Math.round(x)}, ${Math.round(y)}}'`);
}

export function clickAtSmooth(x: number, y: number, delayMs: number = 100): void {
  // Move mouse first, then click — more reliable for some apps
  const script = `
    do shell script "printf '\\e[?1000h'"
    tell application "System Events"
      -- Small delay before clicking
      delay ${delayMs / 1000}
      click at {${Math.round(x)}, ${Math.round(y)}}
    end tell`;
  execSync(`osascript -e '${script}'`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
