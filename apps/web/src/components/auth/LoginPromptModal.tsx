/**
 * Login Prompt Modal
 *
 * Shows a login modal when authentication is required.
 * Triggered by useAuth().requireAuth() or 401 responses.
 *
 * Include this component once at the app root level.
 *
 * WCAG 2.1 AA compliant:
 * - Focus trap (keeps focus within modal)
 * - Escape key closes modal
 * - role="dialog" and aria-modal="true"
 * - Returns focus to trigger on close
 */

import { useRef } from 'react';
import { useAuth } from '../../lib/auth';
import { LoginPage } from './LoginPage';
import { useModalAccessibility } from '../../hooks';

export function LoginPromptModal() {
  const { showLoginPrompt, loginPromptMessage, dismissLoginPrompt } = useAuth();
  const modalRef = useRef<HTMLDivElement>(null);

  // Apply accessibility features (focus trap, escape key, focus management)
  useModalAccessibility(modalRef, showLoginPrompt, dismissLoginPrompt);

  if (!showLoginPrompt) {
    return null;
  }

  return (
    <div
      className="login-prompt-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-modal-title"
      ref={modalRef}
    >
      <div className="login-prompt-modal__backdrop" onClick={dismissLoginPrompt} />
      <div className="login-prompt-modal__content">
        <h2 id="login-modal-title" className="sr-only">Login Required</h2>
        {loginPromptMessage && (
          <div className="login-prompt-modal__message">
            {loginPromptMessage}
          </div>
        )}
        <LoginPage
          onSuccess={dismissLoginPrompt}
          onClose={dismissLoginPrompt}
        />
      </div>
    </div>
  );
}

export default LoginPromptModal;
