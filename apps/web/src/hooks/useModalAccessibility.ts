/**
 * Modal Accessibility Hook
 *
 * WCAG 2.1 AA compliant modal behavior:
 * - Focus trap: keeps focus within modal
 * - Escape key: closes modal
 * - Initial focus: moves to first focusable element
 * - Return focus: restores focus to trigger on close
 *
 * Usage:
 * ```tsx
 * function MyModal({ isOpen, onClose }: Props) {
 *   const modalRef = useRef<HTMLDivElement>(null);
 *   useModalAccessibility(modalRef, isOpen, onClose);
 *
 *   return (
 *     <div ref={modalRef} role="dialog" aria-modal="true">
 *       ...
 *     </div>
 *   );
 * }
 * ```
 */

import { useEffect, useRef, type RefObject } from 'react';

// Focusable element selectors for focus trap
const FOCUSABLE_SELECTORS = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

/**
 * Get all focusable elements within a container
 */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS))
    .filter(el => {
      // Filter out elements that are not visible
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
}

export interface UseModalAccessibilityOptions {
  /** Initial element to focus (selector or 'first' | 'close') */
  initialFocus?: string | 'first' | 'close';
  /** Disable escape key handling */
  disableEscape?: boolean;
  /** Disable focus trap */
  disableFocusTrap?: boolean;
  /** Called when focus leaves the modal (for debugging) */
  onFocusEscape?: () => void;
}

/**
 * Hook for modal accessibility features
 *
 * @param modalRef - Ref to the modal container element
 * @param isOpen - Whether the modal is currently open
 * @param onClose - Callback to close the modal
 * @param options - Configuration options
 */
export function useModalAccessibility(
  modalRef: RefObject<HTMLElement>,
  isOpen: boolean,
  onClose: () => void,
  options: UseModalAccessibilityOptions = {}
): void {
  const {
    initialFocus = 'first',
    disableEscape = false,
    disableFocusTrap = false,
  } = options;

  // Store the element that triggered the modal
  const triggerRef = useRef<HTMLElement | null>(null);

  // Store the modal open state
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  // Capture trigger element and set initial focus when modal opens
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;

    // Store the currently focused element as the trigger
    triggerRef.current = document.activeElement as HTMLElement;

    // Set initial focus
    const setInitialFocus = () => {
      const modal = modalRef.current;
      if (!modal) return;

      let elementToFocus: HTMLElement | null = null;

      if (initialFocus === 'close') {
        // Focus the close button
        elementToFocus = modal.querySelector('[aria-label*="close" i], [aria-label*="Close" i], .modal__close, .theme-modal__close');
      } else if (initialFocus === 'first') {
        // Focus the first focusable element
        const focusable = getFocusableElements(modal);
        elementToFocus = focusable[0] || null;
      } else if (typeof initialFocus === 'string') {
        // Focus a specific element by selector
        elementToFocus = modal.querySelector(initialFocus);
      }

      if (elementToFocus) {
        elementToFocus.focus();
      } else {
        // Fallback: make the modal itself focusable
        modal.setAttribute('tabindex', '-1');
        modal.focus();
      }
    };

    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(setInitialFocus);
  }, [isOpen, initialFocus, modalRef]);

  // Return focus to trigger when modal closes
  useEffect(() => {
    return () => {
      // Only restore focus if we're actually closing (isOpen was true, now false)
      if (!isOpenRef.current && triggerRef.current) {
        // Check if the trigger element is still in the DOM and focusable
        if (document.contains(triggerRef.current)) {
          triggerRef.current.focus();
        }
        triggerRef.current = null;
      }
    };
  }, [isOpen]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen || disableEscape) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, disableEscape, onClose]);

  // Focus trap
  useEffect(() => {
    if (!isOpen || disableFocusTrap || !modalRef.current) return;

    const handleFocusTrap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !modalRef.current) return;

      const focusable = getFocusableElements(modalRef.current);
      if (focusable.length === 0) return;

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];

      // Shift+Tab on first element -> go to last
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }
      // Tab on last element -> go to first
      else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleFocusTrap);
    return () => document.removeEventListener('keydown', handleFocusTrap);
  }, [isOpen, disableFocusTrap, modalRef]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);
}

/**
 * Hook for getting modal props (for spreading on modal element)
 */
export function useModalProps(
  title: string,
  titleId?: string
): {
  role: 'dialog';
  'aria-modal': true;
  'aria-labelledby': string;
} {
  const id = titleId || `modal-title-${title.toLowerCase().replace(/\s+/g, '-')}`;
  return {
    role: 'dialog',
    'aria-modal': true,
    'aria-labelledby': id,
  };
}

export default useModalAccessibility;
