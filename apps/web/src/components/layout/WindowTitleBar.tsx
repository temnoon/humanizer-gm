/**
 * WindowTitleBar - ChatGPT-style macOS traffic light integration
 *
 * Design pattern (inspired by ChatGPT Mac app):
 * - NO separate title bar - traffic lights sit in the app's own topbar
 * - Top bar has padding-left to make room for traffic lights
 * - Content flows naturally without wasted vertical space
 *
 * Platform-aware: only applies styling in Electron on macOS
 */

import { isElectron, getPlatform } from '../../lib/platform';

/**
 * Check if we're on macOS in Electron (need traffic light accommodation)
 */
export function useIsMacElectron(): boolean {
  return isElectron && getPlatform() === 'electron-mac';
}

/**
 * Container for the entire app in Electron.
 * No separate title bar - just marks the container for CSS targeting.
 */
export function ElectronContainer({ children }: { children: React.ReactNode }) {
  const isMacElectron = useIsMacElectron();

  if (!isElectron) {
    return <>{children}</>;
  }

  return (
    <div
      className={`electron-container ${isMacElectron ? 'electron-container--mac' : ''}`}
      data-platform={getPlatform()}
    >
      {children}
    </div>
  );
}

// Legacy exports for compatibility
export function ElectronTitleBar() {
  // No longer renders anything - traffic lights integrate into topbar
  return null;
}

export const WindowTitleBar = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const WindowContainer = ElectronContainer;

export default ElectronTitleBar;
