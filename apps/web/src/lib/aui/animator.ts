/**
 * AUI Animator - "Show Don't Tell" Animation System
 *
 * When AUI performs an action, this system animates the UI to SHOW
 * how the user could have done it themselves manually.
 *
 * Philosophy:
 * - AUI completes the task immediately (doesn't wait for animation)
 * - Animation runs in parallel to educate the user
 * - User sees panels open, elements highlight, steps sequence
 * - Teaches muscle memory through visual demonstration
 */

import type { LayoutContextValue, PanelId } from '../../components/layout/LayoutContext';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface AnimationStep {
  /** What to do */
  type: 'open-panel' | 'highlight' | 'type' | 'click' | 'wait' | 'toast' | 'scroll-to';
  /** Target (panel ID, CSS selector, or text for toast) */
  target: string;
  /** Duration in ms */
  duration?: number;
  /** Text to "type" or display */
  text?: string;
  /** Delay before this step */
  delay?: number;
}

export interface AnimationSequence {
  /** Unique ID for this animation */
  id: string;
  /** Steps to execute */
  steps: AnimationStep[];
  /** Optional: what tool triggered this */
  toolName?: string;
  /** Optional: summary for user */
  summary?: string;
}

export interface AnimatorState {
  /** Whether animation is currently playing */
  isPlaying: boolean;
  /** Current step index */
  currentStep: number;
  /** Total steps */
  totalSteps: number;
  /** Current animation ID */
  currentAnimationId: string | null;
  /** Elements currently highlighted */
  highlightedElements: Set<string>;
}

export interface AUIAnimatorAPI {
  /** Run an animation sequence */
  animate: (sequence: AnimationSequence) => Promise<void>;
  /** Stop current animation */
  stop: () => void;
  /** Current state */
  state: AnimatorState;
  /** Quick helpers */
  openPanel: (panel: PanelId, highlight?: string) => Promise<void>;
  highlightElement: (selector: string, duration?: number) => Promise<void>;
  showToast: (message: string, icon?: string) => Promise<void>;
  showShortcut: (keys: string) => Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════
// ELEMENT SELECTOR MAP
// ═══════════════════════════════════════════════════════════════════

/**
 * Maps human-readable names from teaching.guiPath to CSS selectors
 */
export const ELEMENT_SELECTORS: Record<string, string> = {
  // Panels
  'Archive panel': '.archive-panel',
  'Archives panel': '.archive-panel',
  'Tools panel': '.tools-panel',
  'Workspace': '.studio__workspace',

  // Archive tabs
  'Conversations tab': '[data-tab="conversations"]',
  'Books tab': '[data-tab="books"]',
  'Gallery tab': '[data-tab="gallery"]',
  'Explore tab': '[data-tab="explore"]',
  'Files tab': '[data-tab="files"]',

  // Tools tabs
  'Humanizer tab': '[data-tab="humanizer"]',
  'Persona tab': '[data-tab="persona"]',
  'Style tab': '[data-tab="style"]',
  'Analysis tab': '[data-tab="analysis"]',
  'Extraction tab': '[data-tab="extraction"]',
  'Settings tab': '[data-tab="settings"]',

  // Common elements
  'Search field': '.archive-search__input, .search-input',
  'Search button': '.archive-search__button, .search-btn',
  'Filter dropdown': '.archive-filter__select, .filter-select',

  // Book editor
  'Chapters list': '.book-chapters',
  'Passages list': '.book-passages',
  'Add passage button': '.add-passage-btn',
  'Chapter content': '.chapter-content',

  // Toolbar buttons
  'Humanize button': '.humanize-btn, [data-tool="humanize"]',
  'Analyze button': '.analyze-btn, [data-tool="analyze"]',
  'Transform button': '.transform-btn',
};

// ═══════════════════════════════════════════════════════════════════
// ANIMATOR CLASS
// ═══════════════════════════════════════════════════════════════════

export class AUIAnimator {
  private layoutContext: LayoutContextValue | null = null;
  private state: AnimatorState = {
    isPlaying: false,
    currentStep: 0,
    totalSteps: 0,
    currentAnimationId: null,
    highlightedElements: new Set(),
  };
  private abortController: AbortController | null = null;
  private onStateChange?: (state: AnimatorState) => void;
  private toastContainer: HTMLElement | null = null;

  constructor() {
    // Create toast container on init
    if (typeof document !== 'undefined') {
      this.initToastContainer();
    }
  }

  /** Set the layout context for panel control */
  setLayoutContext(ctx: LayoutContextValue) {
    this.layoutContext = ctx;
  }

  /** Set state change callback */
  setStateChangeCallback(cb: (state: AnimatorState) => void) {
    this.onStateChange = cb;
  }

  /** Get current state */
  getState(): AnimatorState {
    return { ...this.state };
  }

  /** Initialize toast container */
  private initToastContainer() {
    if (this.toastContainer) return;

    this.toastContainer = document.createElement('div');
    this.toastContainer.className = 'aui-toast-container';
    this.toastContainer.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.toastContainer);
  }

  /** Update state and notify */
  private updateState(updates: Partial<AnimatorState>) {
    this.state = { ...this.state, ...updates };
    this.onStateChange?.(this.state);
  }

  /** Run an animation sequence */
  async animate(sequence: AnimationSequence): Promise<void> {
    // Cancel any running animation
    this.stop();

    this.abortController = new AbortController();
    this.updateState({
      isPlaying: true,
      currentStep: 0,
      totalSteps: sequence.steps.length,
      currentAnimationId: sequence.id,
    });

    try {
      for (let i = 0; i < sequence.steps.length; i++) {
        if (this.abortController.signal.aborted) break;

        this.updateState({ currentStep: i + 1 });
        const step = sequence.steps[i];

        // Delay before step
        if (step.delay) {
          await this.wait(step.delay);
        }

        // Execute step
        await this.executeStep(step);
      }
    } finally {
      this.updateState({
        isPlaying: false,
        currentAnimationId: null,
      });
      this.clearAllHighlights();
    }
  }

  /** Stop current animation */
  stop() {
    this.abortController?.abort();
    this.abortController = null;
    this.clearAllHighlights();
    this.updateState({
      isPlaying: false,
      currentAnimationId: null,
    });
  }

  /** Execute a single step */
  private async executeStep(step: AnimationStep): Promise<void> {
    const duration = step.duration ?? 500;

    switch (step.type) {
      case 'open-panel':
        await this.openPanel(step.target as PanelId);
        break;

      case 'highlight':
        await this.highlightElement(step.target, duration);
        break;

      case 'type':
        await this.simulateTyping(step.target, step.text ?? '');
        break;

      case 'click':
        await this.simulateClick(step.target);
        break;

      case 'scroll-to':
        await this.scrollToElement(step.target);
        break;

      case 'toast':
        await this.showToast(step.text ?? '', step.target);
        break;

      case 'wait':
        await this.wait(duration);
        break;
    }
  }

  /** Open a panel with animation */
  async openPanel(panel: PanelId, highlight?: string): Promise<void> {
    if (!this.layoutContext) return;

    const isVisible = this.layoutContext.isPanelVisible(panel);
    if (!isVisible) {
      this.layoutContext.setPanelState(panel, 'expanded');
      // Wait for panel animation
      await this.wait(300);
    }

    if (highlight) {
      await this.highlightElement(highlight, 1500);
    }
  }

  /** Highlight an element */
  async highlightElement(selector: string, duration = 1500): Promise<void> {
    // Resolve friendly name to selector
    const actualSelector = ELEMENT_SELECTORS[selector] || selector;
    const element = document.querySelector(actualSelector);

    if (!element) {
      console.warn(`[AUIAnimator] Element not found: ${selector}`);
      return;
    }

    // Add highlight class
    element.classList.add('aui-highlight');
    this.state.highlightedElements.add(actualSelector);

    // Scroll into view if needed
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    await this.wait(duration);

    // Remove highlight
    element.classList.remove('aui-highlight');
    this.state.highlightedElements.delete(actualSelector);
  }

  /** Simulate typing into an input */
  private async simulateTyping(selector: string, text: string): Promise<void> {
    const actualSelector = ELEMENT_SELECTORS[selector] || selector;
    const element = document.querySelector(actualSelector) as HTMLInputElement;

    if (!element) {
      console.warn(`[AUIAnimator] Input not found: ${selector}`);
      return;
    }

    // Focus and highlight
    element.focus();
    element.classList.add('aui-typing');

    // Type character by character
    const originalValue = element.value;
    element.value = '';

    for (const char of text) {
      if (this.abortController?.signal.aborted) break;
      element.value += char;
      // Trigger input event for React
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await this.wait(50 + Math.random() * 30);
    }

    await this.wait(500);
    element.classList.remove('aui-typing');

    // Restore if this was just demonstration
    // (actual search is done by the AUI tool itself)
  }

  /** Simulate click on an element */
  private async simulateClick(selector: string): Promise<void> {
    const actualSelector = ELEMENT_SELECTORS[selector] || selector;
    const element = document.querySelector(actualSelector) as HTMLElement;

    if (!element) {
      console.warn(`[AUIAnimator] Click target not found: ${selector}`);
      return;
    }

    // Highlight briefly
    element.classList.add('aui-click-target');
    await this.wait(300);

    // Visual pulse
    element.classList.add('aui-clicking');
    await this.wait(150);
    element.classList.remove('aui-clicking');

    await this.wait(200);
    element.classList.remove('aui-click-target');
  }

  /** Scroll element into view */
  private async scrollToElement(selector: string): Promise<void> {
    const actualSelector = ELEMENT_SELECTORS[selector] || selector;
    const element = document.querySelector(actualSelector);

    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.wait(500);
    }
  }

  /** Show a toast notification */
  async showToast(message: string, icon = '💡'): Promise<void> {
    if (!this.toastContainer) this.initToastContainer();

    const toast = document.createElement('div');
    toast.className = 'aui-toast';
    toast.innerHTML = `
      <span class="aui-toast__icon">${icon}</span>
      <span class="aui-toast__message">${message}</span>
    `;

    this.toastContainer!.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('aui-toast--visible');
    });

    await this.wait(3000);

    toast.classList.remove('aui-toast--visible');
    toast.classList.add('aui-toast--hiding');

    await this.wait(300);
    toast.remove();
  }

  /** Show keyboard shortcut toast */
  async showShortcut(keys: string): Promise<void> {
    await this.showToast(`Shortcut: ${keys}`, '⌨️');
  }

  /** Clear all highlights */
  private clearAllHighlights() {
    for (const selector of this.state.highlightedElements) {
      const element = document.querySelector(selector);
      if (element) {
        element.classList.remove('aui-highlight', 'aui-typing', 'aui-click-target', 'aui-clicking');
      }
    }
    this.state.highlightedElements.clear();
  }

  /** Wait helper */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, ms);
      this.abortController?.signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEACHING TO ANIMATION CONVERTER
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert a teaching object from a tool result into an animation sequence
 */
export function teachingToAnimation(
  toolName: string,
  teaching: {
    whatHappened: string;
    guiPath?: string[];
    shortcut?: string;
    why?: string;
  }
): AnimationSequence {
  const steps: AnimationStep[] = [];

  // Parse guiPath to create animation steps
  if (teaching.guiPath) {
    for (const step of teaching.guiPath) {
      const lowerStep = step.toLowerCase();

      // Detect panel opening
      if (lowerStep.includes('open') && lowerStep.includes('archive')) {
        steps.push({ type: 'open-panel', target: 'archives', delay: 200 });
      } else if (lowerStep.includes('open') && lowerStep.includes('tools')) {
        steps.push({ type: 'open-panel', target: 'tools', delay: 200 });
      }
      // Detect tab switching
      else if (lowerStep.includes('click') || lowerStep.includes('select') || lowerStep.includes('go to')) {
        // Try to find a matching element
        const matchedSelector = findMatchingSelector(step);
        if (matchedSelector) {
          steps.push({ type: 'highlight', target: matchedSelector, duration: 1000, delay: 300 });
        }
      }
      // Detect typing in search
      else if (lowerStep.includes('type') || lowerStep.includes('enter') || lowerStep.includes('search')) {
        steps.push({ type: 'highlight', target: 'Search field', duration: 1000, delay: 200 });
      }
      // Generic step - show as toast
      else {
        steps.push({ type: 'toast', target: '📍', text: step, delay: 500 });
      }
    }
  }

  // Show shortcut if available
  if (teaching.shortcut) {
    steps.push({ type: 'toast', target: '⌨️', text: `Shortcut: ${teaching.shortcut}`, delay: 300 });
  }

  return {
    id: `${toolName}-${Date.now()}`,
    toolName,
    summary: teaching.whatHappened,
    steps,
  };
}

/**
 * Find a matching selector from step description
 */
function findMatchingSelector(stepDescription: string): string | null {
  const lower = stepDescription.toLowerCase();

  for (const [name, _selector] of Object.entries(ELEMENT_SELECTORS)) {
    if (lower.includes(name.toLowerCase())) {
      return name;
    }
  }

  // Common patterns
  if (lower.includes('conversation')) return 'Conversations tab';
  if (lower.includes('book')) return 'Books tab';
  if (lower.includes('gallery') || lower.includes('media')) return 'Gallery tab';
  if (lower.includes('explore') || lower.includes('semantic')) return 'Explore tab';
  if (lower.includes('humanize')) return 'Humanizer tab';
  if (lower.includes('persona')) return 'Persona tab';
  if (lower.includes('style')) return 'Style tab';
  if (lower.includes('chapter')) return 'Chapters list';
  if (lower.includes('passage')) return 'Passages list';

  return null;
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════

export const auiAnimator = new AUIAnimator();
