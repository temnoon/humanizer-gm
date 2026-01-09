/**
 * Layout Components
 *
 * Symmetric 3-panel layout system for the Studio
 */

// Context and hooks
export {
  LayoutProvider,
  useLayout,
  useLayoutMode,
  useIsMobile,
  usePanelState,
  useSplitScreen,
  useSplitMode,
  useHighlights,
  type PanelId,
  type PanelState,
  type LayoutMode,
  type PanelConfig,
  type LayoutState,
  type LayoutContextValue,
  type SplitMode,
  type HighlightLayer,
  type AnalysisData,
} from './LayoutContext';

// Components
export {
  SymmetricMenubar,
  BottomSheetHandle,
} from './SymmetricMenubar';

export { CornerAssistant } from './CornerAssistant';

export { PanelResizer } from './PanelResizer';

export {
  SplitScreenWorkspace,
  type SplitPaneContent,
} from './SplitScreenWorkspace';

export { SplitDivider } from './SplitDivider';

export { SplitModeToolbar } from './SplitModeToolbar';

export { HoverPanel, type HoverPanelProps } from './HoverPanel';

export { UserDropdown, type UserDropdownProps } from './UserDropdown';

export { TopBar, type TopBarProps } from './TopBar';
