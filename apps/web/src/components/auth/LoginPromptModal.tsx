/**
 * Login Prompt Modal
 *
 * Shows a login modal when authentication is required.
 * Triggered by useAuth().requireAuth() or 401 responses.
 *
 * Include this component once at the app root level.
 */

import { useAuth } from '../../lib/auth';
import { LoginPage } from './LoginPage';

export function LoginPromptModal() {
  const { showLoginPrompt, loginPromptMessage, dismissLoginPrompt } = useAuth();

  if (!showLoginPrompt) {
    return null;
  }

  return (
    <div className="login-prompt-modal">
      <div className="login-prompt-modal__backdrop" onClick={dismissLoginPrompt} />
      <div className="login-prompt-modal__content">
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
