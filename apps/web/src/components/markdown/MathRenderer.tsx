/**
 * MathRenderer - Full markdown with KaTeX support
 *
 * This component is lazy-loaded by MathMarkdown to avoid bundling
 * KaTeX (~150KB gzipped) into the main chunk.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export interface MathRendererProps {
  children: string;
  className?: string;
}

export function MathRenderer({ children, className }: MathRendererProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false }]]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export default MathRenderer;
