/**
 * ErrorBoundary - Catches React render errors and displays fallback UI
 *
 * Wraps components that may throw during rendering. Required as a class
 * component because React only supports error boundaries via class lifecycle.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';

// ============================================
// Types
// ============================================

export interface ErrorBoundaryProps {
  /** Child components to render */
  children: ReactNode;
  /** Custom fallback UI when error occurs */
  fallback?: ReactNode;
  /** Optional callback when error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Component name for error logging */
  componentName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// ============================================
// Error Boundary Component
// ============================================

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { onError, componentName } = this.props;

    // Log to console with component context
    console.error(
      `[ErrorBoundary]${componentName ? ` ${componentName}:` : ''} Caught error:`,
      error,
      errorInfo.componentStack
    );

    // Store error info for display
    this.setState({ errorInfo });

    // Call optional callback
    onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    if (hasError) {
      // Custom fallback provided
      if (fallback) {
        return fallback;
      }

      // Default fallback UI
      return (
        <div className="error-boundary">
          <div className="error-boundary__content">
            <h2 className="error-boundary__title">Something went wrong</h2>
            <p className="error-boundary__message">
              {error?.message || 'An unexpected error occurred'}
            </p>
            <div className="error-boundary__actions">
              <button
                className="error-boundary__retry"
                onClick={this.handleRetry}
              >
                Try Again
              </button>
              <button
                className="error-boundary__reload"
                onClick={() => window.location.reload()}
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return children;
  }
}

// ============================================
// Specialized Error Boundaries
// ============================================

/**
 * ViewErrorBoundary - For wrapping individual views/panels
 * Shows a smaller inline error instead of full-page fallback
 */
export function ViewErrorBoundary({
  children,
  viewName = 'View',
}: {
  children: ReactNode;
  viewName?: string;
}) {
  return (
    <ErrorBoundary
      componentName={viewName}
      fallback={
        <div className="error-boundary error-boundary--inline">
          <p className="error-boundary__inline-message">
            Failed to load {viewName.toLowerCase()}
          </p>
          <button
            className="error-boundary__inline-retry"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
