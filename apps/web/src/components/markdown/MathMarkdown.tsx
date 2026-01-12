/**
 * MathMarkdown - Markdown renderer with lazy-loaded KaTeX support
 *
 * Only loads KaTeX (150KB+ with fonts) when math content is detected.
 * Falls back to simple markdown for non-math content.
 */

import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

// Lazy load math plugins only when needed
const MathRenderer = lazy(() => import('./MathRenderer'));

export interface MathMarkdownProps {
  children: string;
  className?: string;
}

/**
 * Check if content contains LaTeX math expressions
 * Looks for: $...$ $$...$$ \[...\] \(...\)
 */
function hasMathContent(content: string): boolean {
  // Quick checks for common math delimiters
  return /\$[^$]+\$|\\\[|\\\(/.test(content);
}

/**
 * Simple markdown without math support (lightweight)
 * Uses remarkBreaks to convert single newlines to <br> for proper paragraph display
 */
function SimpleMarkdown({ children, className }: MathMarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Loading fallback while KaTeX loads
 */
function MathLoadingFallback({ children, className }: MathMarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
        {children}
      </ReactMarkdown>
      <span className="sr-only">Loading math rendering...</span>
    </div>
  );
}

/**
 * Smart markdown component that only loads KaTeX when math is detected
 */
export function MathMarkdown({ children, className }: MathMarkdownProps) {
  const needsMath = useMemo(() => hasMathContent(children), [children]);

  if (!needsMath) {
    return <SimpleMarkdown className={className}>{children}</SimpleMarkdown>;
  }

  return (
    <Suspense fallback={<MathLoadingFallback className={className}>{children}</MathLoadingFallback>}>
      <MathRenderer className={className}>{children}</MathRenderer>
    </Suspense>
  );
}

export default MathMarkdown;
