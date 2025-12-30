/**
 * LayoutContext - Manages the symmetric 3-panel layout state
 *
 * The Studio uses a symmetric layout:
 *   ┌─────────────────┬──────────────────────────┬─────────────────┐
 *   │  ARCHIVES       │  WORKSPACE               │  TOOLS          │
 *   │  (Left Panel)   │  (Center - Main Pane)    │  (Right Panel)  │
 *   └─────────────────┴──────────────────────────┴─────────────────┘
 *
 * On mobile, panels become bottom sheets with gesture controls.
 */

import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import type { SplitMode, HighlightLayer, AnalysisData } from '../../lib/analysis';

// ============================================
// Types
// ============================================

export type PanelId = 'archives' | 'tools';
export type PanelState = 'collapsed' | 'peek' | 'partial' | 'expanded' | 'full';
export type LayoutMode = 'desktop' | 'tablet' | 'mobile';

// Re-export analysis types for convenience
export type { SplitMode, HighlightLayer, AnalysisData } from '../../lib/analysis';

export interface PanelConfig {
  state: PanelState;
  width: number; // Desktop width in pixels
  minWidth: number;
  maxWidth: number;
}

export interface LayoutState {
  mode: LayoutMode;
  panels: {
    archives: PanelConfig;
    tools: PanelConfig;
  };
  /** Which panel is currently focused (for keyboard nav) */
  focusedPanel: PanelId | 'workspace';
  /** Whether split-screen mode is active */
  splitScreen: boolean;
  /** Split screen ratio (0-100, left panel gets this %) */
  splitRatio: number;
  /** Current split-screen viewing mode */
  splitMode: SplitMode;
  /** Active highlight layers */
  activeHighlights: HighlightLayer[];
  /** Analysis data for highlights */
  analysisData: AnalysisData;
}

export interface LayoutContextValue {
  state: LayoutState;
  /** Toggle a panel between collapsed and expanded */
  togglePanel: (panel: PanelId) => void;
  /** Set a panel to a specific state */
  setPanelState: (panel: PanelId, state: PanelState) => void;
  /** Set panel width (desktop only) */
  setPanelWidth: (panel: PanelId, width: number) => void;
  /** Set focus to a panel */
  setFocus: (target: PanelId | 'workspace') => void;
  /** Toggle split-screen mode */
  toggleSplitScreen: () => void;
  /** Set split-screen ratio */
  setSplitRatio: (ratio: number) => void;
  /** Collapse all panels */
  collapseAll: () => void;
  /** Check if panel is visible */
  isPanelVisible: (panel: PanelId) => boolean;
  /** Set split-screen viewing mode */
  setSplitMode: (mode: SplitMode) => void;
  /** Toggle a highlight layer on/off */
  toggleHighlight: (layer: HighlightLayer) => void;
  /** Set specific highlight layers */
  setActiveHighlights: (layers: HighlightLayer[]) => void;
  /** Set analysis data */
  setAnalysisData: (data: AnalysisData) => void;
  /** Clear analysis data */
  clearAnalysisData: () => void;
}

// ============================================
// Constants
// ============================================

const STORAGE_KEY = 'humanizer-layout';

const BREAKPOINTS = {
  mobile: 768,
  tablet: 1024,
};

const DEFAULT_PANEL_CONFIG: Record<PanelId, PanelConfig> = {
  archives: {
    state: 'collapsed',  // Start closed for clean welcome screen
    width: 320,
    minWidth: 240,
    maxWidth: 480,
  },
  tools: {
    state: 'collapsed',
    width: 300,
    minWidth: 200,
    maxWidth: 400,
  },
};

const DEFAULT_STATE: LayoutState = {
  mode: 'desktop',
  panels: DEFAULT_PANEL_CONFIG,
  focusedPanel: 'archives',
  splitScreen: false,
  splitRatio: 50,
  splitMode: 'view',
  activeHighlights: [],
  analysisData: {},
};

// ============================================
// Context
// ============================================

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function useLayout(): LayoutContextValue {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return context;
}

// ============================================
// Provider
// ============================================

interface LayoutProviderProps {
  children: ReactNode;
}

export function LayoutProvider({ children }: LayoutProviderProps) {
  // Initialize state from localStorage or defaults
  const [state, setState] = useState<LayoutState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // CLEANUP: Remove stale highlight data that breaks rendering
        if (parsed.analysisData && Object.keys(parsed.analysisData).length > 0) {
          const cleaned = { ...parsed, activeHighlights: [], analysisData: {} };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
        }
        // Never restore highlights - they break images/LaTeX
        return {
          ...DEFAULT_STATE,
          ...parsed,
          activeHighlights: [],
          analysisData: {},
        };
      }
    } catch {
      // Ignore parse errors
    }
    return DEFAULT_STATE;
  });

  // Detect layout mode from viewport
  useEffect(() => {
    const updateMode = () => {
      const width = window.innerWidth;
      let mode: LayoutMode;

      if (width < BREAKPOINTS.mobile) {
        mode = 'mobile';
      } else if (width < BREAKPOINTS.tablet) {
        mode = 'tablet';
      } else {
        mode = 'desktop';
      }

      setState((prev) => {
        if (prev.mode === mode) return prev;
        return { ...prev, mode };
      });
    };

    updateMode();
    window.addEventListener('resize', updateMode);
    return () => window.removeEventListener('resize', updateMode);
  }, []);

  // Persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage errors
    }
  }, [state]);

  // Toggle panel
  const togglePanel = useCallback((panel: PanelId) => {
    setState((prev) => {
      const currentState = prev.panels[panel].state;
      const newState: PanelState =
        currentState === 'collapsed' || currentState === 'peek'
          ? 'expanded'
          : 'collapsed';

      return {
        ...prev,
        panels: {
          ...prev.panels,
          [panel]: {
            ...prev.panels[panel],
            state: newState,
          },
        },
      };
    });
  }, []);

  // Set panel state
  const setPanelState = useCallback((panel: PanelId, panelState: PanelState) => {
    setState((prev) => ({
      ...prev,
      panels: {
        ...prev.panels,
        [panel]: {
          ...prev.panels[panel],
          state: panelState,
        },
      },
    }));
  }, []);

  // Set panel width
  const setPanelWidth = useCallback((panel: PanelId, width: number) => {
    setState((prev) => {
      const config = prev.panels[panel];
      const clampedWidth = Math.max(
        config.minWidth,
        Math.min(config.maxWidth, width)
      );

      return {
        ...prev,
        panels: {
          ...prev.panels,
          [panel]: {
            ...config,
            width: clampedWidth,
          },
        },
      };
    });
  }, []);

  // Set focus
  const setFocus = useCallback((target: PanelId | 'workspace') => {
    setState((prev) => ({
      ...prev,
      focusedPanel: target,
    }));
  }, []);

  // Toggle split screen
  const toggleSplitScreen = useCallback(() => {
    setState((prev) => ({
      ...prev,
      splitScreen: !prev.splitScreen,
    }));
  }, []);

  // Set split ratio
  const setSplitRatio = useCallback((ratio: number) => {
    setState((prev) => ({
      ...prev,
      splitRatio: Math.max(20, Math.min(80, ratio)),
    }));
  }, []);

  // Collapse all panels
  const collapseAll = useCallback(() => {
    setState((prev) => ({
      ...prev,
      panels: {
        archives: { ...prev.panels.archives, state: 'collapsed' },
        tools: { ...prev.panels.tools, state: 'collapsed' },
      },
    }));
  }, []);

  // Check if panel is visible
  const isPanelVisible = useCallback(
    (panel: PanelId): boolean => {
      const panelState = state.panels[panel].state;
      return panelState !== 'collapsed';
    },
    [state.panels]
  );

  // Set split mode
  const setSplitMode = useCallback((mode: SplitMode) => {
    setState((prev) => ({
      ...prev,
      splitMode: mode,
    }));
  }, []);

  // Toggle highlight layer
  const toggleHighlight = useCallback((layer: HighlightLayer) => {
    setState((prev) => {
      const isActive = prev.activeHighlights.includes(layer);
      return {
        ...prev,
        activeHighlights: isActive
          ? prev.activeHighlights.filter((l) => l !== layer)
          : [...prev.activeHighlights, layer],
      };
    });
  }, []);

  // Set active highlights
  const setActiveHighlights = useCallback((layers: HighlightLayer[]) => {
    setState((prev) => ({
      ...prev,
      activeHighlights: layers,
    }));
  }, []);

  // Set analysis data
  const setAnalysisData = useCallback((data: AnalysisData) => {
    setState((prev) => ({
      ...prev,
      analysisData: { ...prev.analysisData, ...data },
    }));
  }, []);

  // Clear analysis data
  const clearAnalysisData = useCallback(() => {
    setState((prev) => ({
      ...prev,
      analysisData: {},
      activeHighlights: [],
    }));
  }, []);

  const value: LayoutContextValue = {
    state,
    togglePanel,
    setPanelState,
    setPanelWidth,
    setFocus,
    toggleSplitScreen,
    setSplitRatio,
    collapseAll,
    isPanelVisible,
    setSplitMode,
    toggleHighlight,
    setActiveHighlights,
    setAnalysisData,
    clearAnalysisData,
  };

  return (
    <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
  );
}

// ============================================
// Hooks
// ============================================

/**
 * Get current layout mode
 */
export function useLayoutMode(): LayoutMode {
  const { state } = useLayout();
  return state.mode;
}

/**
 * Check if on mobile
 */
export function useIsMobile(): boolean {
  const mode = useLayoutMode();
  return mode === 'mobile';
}

/**
 * Get panel state for a specific panel
 */
export function usePanelState(panel: PanelId): PanelConfig {
  const { state } = useLayout();
  return state.panels[panel];
}

/**
 * Get split-screen state and controls
 */
export function useSplitScreen() {
  const { state, toggleSplitScreen, setSplitRatio } = useLayout();
  return {
    isActive: state.splitScreen,
    ratio: state.splitRatio,
    toggle: toggleSplitScreen,
    setRatio: setSplitRatio,
  };
}

/**
 * Get split mode state and controls
 */
export function useSplitMode() {
  const { state, setSplitMode, toggleSplitScreen } = useLayout();
  return {
    mode: state.splitMode,
    setMode: setSplitMode,
    isActive: state.splitScreen,
    toggle: toggleSplitScreen,
  };
}

/**
 * Get highlight state and controls
 */
export function useHighlights() {
  const {
    state,
    toggleHighlight,
    setActiveHighlights,
    setAnalysisData,
    clearAnalysisData,
  } = useLayout();
  return {
    activeHighlights: state.activeHighlights,
    analysisData: state.analysisData,
    toggle: toggleHighlight,
    setActive: setActiveHighlights,
    setData: setAnalysisData,
    clear: clearAnalysisData,
    isLayerActive: (layer: HighlightLayer) => state.activeHighlights.includes(layer),
  };
}
