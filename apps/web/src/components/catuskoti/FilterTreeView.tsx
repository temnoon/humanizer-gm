/**
 * FilterTreeView - Visual display of parsed filter tree
 *
 * Renders the filter tree as nested cards showing:
 * - Boolean groups (AND/OR)
 * - Catuskoti filters with state indicators
 * - Regex patterns
 * - Phrases and wildcards
 * - Comparisons and ranges
 */

import { useMemo } from 'react';
import type {
  FilterNode,
  FilterGroupNode,
  CatuskotiFilterNode,
  RegexFilterNode,
  PhraseFilterNode,
  WildcardFilterNode,
  ComparisonFilterNode,
  SavedStackRefNode,
} from '../../lib/query';
import { getCatuskotiIcon, describeCatuskotiState } from './types';
import './filter-tree-view.css';

export interface FilterTreeViewProps {
  root: FilterNode | null;
  onRemoveNode?: (path: number[]) => void;
  onEditNode?: (path: number[], node: FilterNode) => void;
  compact?: boolean;
  className?: string;
}

export function FilterTreeView({
  root,
  onRemoveNode,
  onEditNode,
  compact = false,
  className = '',
}: FilterTreeViewProps) {
  if (!root) {
    return (
      <div className={`filter-tree-view filter-tree-view--empty ${className}`}>
        <span className="filter-tree-view__placeholder">No filters applied</span>
      </div>
    );
  }

  return (
    <div className={`filter-tree-view ${compact ? 'filter-tree-view--compact' : ''} ${className}`}>
      <FilterNodeView
        node={root}
        path={[]}
        onRemove={onRemoveNode}
        onEdit={onEditNode}
        depth={0}
      />
    </div>
  );
}

interface FilterNodeViewProps {
  node: FilterNode;
  path: number[];
  onRemove?: (path: number[]) => void;
  onEdit?: (path: number[], node: FilterNode) => void;
  depth: number;
}

function FilterNodeView({ node, path, onRemove, onEdit, depth }: FilterNodeViewProps) {
  switch (node.type) {
    case 'AND':
    case 'OR':
      return (
        <GroupNodeView
          node={node as FilterGroupNode}
          path={path}
          onRemove={onRemove}
          onEdit={onEdit}
          depth={depth}
        />
      );
    case 'CATUSKOTI':
      return (
        <CatuskotiNodeView
          node={node as CatuskotiFilterNode}
          path={path}
          onRemove={onRemove}
          onEdit={onEdit}
        />
      );
    case 'REGEX':
      return (
        <RegexNodeView
          node={node as RegexFilterNode}
          path={path}
          onRemove={onRemove}
        />
      );
    case 'PHRASE':
      return (
        <PhraseNodeView
          node={node as PhraseFilterNode}
          path={path}
          onRemove={onRemove}
        />
      );
    case 'WILDCARD':
      return (
        <WildcardNodeView
          node={node as WildcardFilterNode}
          path={path}
          onRemove={onRemove}
        />
      );
    case 'COMPARISON':
      return (
        <ComparisonNodeView
          node={node as ComparisonFilterNode}
          path={path}
          onRemove={onRemove}
        />
      );
    case 'STACK_REF':
      return (
        <StackRefNodeView
          node={node as SavedStackRefNode}
          path={path}
          onRemove={onRemove}
        />
      );
    default:
      return <div className="filter-node filter-node--unknown">Unknown filter</div>;
  }
}

function GroupNodeView({
  node,
  path,
  onRemove,
  onEdit,
  depth,
}: {
  node: FilterGroupNode;
  path: number[];
  onRemove?: (path: number[]) => void;
  onEdit?: (path: number[], node: FilterNode) => void;
  depth: number;
}) {
  const isNegated = node.negated;
  const groupType = node.type;

  return (
    <div
      className={`filter-node filter-node--group filter-node--${groupType.toLowerCase()} ${isNegated ? 'filter-node--negated' : ''}`}
      data-depth={depth}
    >
      <div className="filter-node__header">
        <span className="filter-node__type">
          {isNegated && <span className="filter-node__not">NOT</span>}
          <span className="filter-node__operator">{groupType}</span>
        </span>
        {onRemove && (
          <button
            className="filter-node__remove"
            onClick={() => onRemove(path)}
            aria-label="Remove group"
          >
            ×
          </button>
        )}
      </div>
      <div className="filter-node__children">
        {node.children.map((child, i) => (
          <FilterNodeView
            key={i}
            node={child}
            path={[...path, i]}
            onRemove={onRemove}
            onEdit={onEdit}
            depth={depth + 1}
          />
        ))}
      </div>
    </div>
  );
}

function CatuskotiNodeView({
  node,
  path,
  onRemove,
  onEdit,
}: {
  node: CatuskotiFilterNode;
  path: number[];
  onRemove?: (path: number[]) => void;
  onEdit?: (path: number[], node: FilterNode) => void;
}) {
  const icon = getCatuskotiIcon(node.state);
  const stateDesc = describeCatuskotiState(node.state, node.value);
  const stateLabel = node.state === 'is' ? 'include' :
                     node.state === 'is-not' ? 'exclude' :
                     node.state === 'both' ? 'spanning' : 'neither';

  return (
    <div
      className={`filter-node filter-node--catuskoti filter-node--${node.state}`}
      data-state={node.state}
      title={stateDesc}
    >
      <span className="filter-node__icon">{icon}</span>
      <span className="filter-node__category">{node.category}</span>
      <span className="filter-node__separator">:</span>
      <span className="filter-node__value">{node.value}</span>
      <span className="filter-node__state-label">{stateLabel}</span>
      {onRemove && (
        <button
          className="filter-node__remove"
          onClick={() => onRemove(path)}
          aria-label={`Remove ${node.category}:${node.value} filter`}
        >
          ×
        </button>
      )}
    </div>
  );
}

function RegexNodeView({
  node,
  path,
  onRemove,
}: {
  node: RegexFilterNode;
  path: number[];
  onRemove?: (path: number[]) => void;
}) {
  return (
    <div className="filter-node filter-node--regex">
      <span className="filter-node__icon">⌘</span>
      <span className="filter-node__pattern">
        /{node.pattern}/{node.flags}
      </span>
      {node.field && (
        <span className="filter-node__field">in {node.field}</span>
      )}
      {onRemove && (
        <button
          className="filter-node__remove"
          onClick={() => onRemove(path)}
          aria-label="Remove regex filter"
        >
          ×
        </button>
      )}
    </div>
  );
}

function PhraseNodeView({
  node,
  path,
  onRemove,
}: {
  node: PhraseFilterNode;
  path: number[];
  onRemove?: (path: number[]) => void;
}) {
  return (
    <div className="filter-node filter-node--phrase">
      <span className="filter-node__icon">"</span>
      <span className="filter-node__value">{node.phrase}</span>
      <span className="filter-node__icon">"</span>
      {node.field && (
        <span className="filter-node__field">in {node.field}</span>
      )}
      {onRemove && (
        <button
          className="filter-node__remove"
          onClick={() => onRemove(path)}
          aria-label="Remove phrase filter"
        >
          ×
        </button>
      )}
    </div>
  );
}

function WildcardNodeView({
  node,
  path,
  onRemove,
}: {
  node: WildcardFilterNode;
  path: number[];
  onRemove?: (path: number[]) => void;
}) {
  return (
    <div className="filter-node filter-node--wildcard">
      <span className="filter-node__icon">*</span>
      <span className="filter-node__value">{node.pattern}</span>
      {node.field && (
        <span className="filter-node__field">in {node.field}</span>
      )}
      {onRemove && (
        <button
          className="filter-node__remove"
          onClick={() => onRemove(path)}
          aria-label="Remove wildcard filter"
        >
          ×
        </button>
      )}
    </div>
  );
}

function ComparisonNodeView({
  node,
  path,
  onRemove,
}: {
  node: ComparisonFilterNode;
  path: number[];
  onRemove?: (path: number[]) => void;
}) {
  const displayValue = node.endValue !== undefined
    ? `${node.value}..${node.endValue}`
    : `${node.operator}${node.value}`;

  return (
    <div className="filter-node filter-node--comparison">
      <span className="filter-node__category">{node.category}</span>
      <span className="filter-node__separator">:</span>
      <span className="filter-node__comparison">{displayValue}</span>
      {onRemove && (
        <button
          className="filter-node__remove"
          onClick={() => onRemove(path)}
          aria-label={`Remove ${node.category} filter`}
        >
          ×
        </button>
      )}
    </div>
  );
}

function StackRefNodeView({
  node,
  path,
  onRemove,
}: {
  node: SavedStackRefNode;
  path: number[];
  onRemove?: (path: number[]) => void;
}) {
  return (
    <div className={`filter-node filter-node--stack-ref ${node.resolved ? '' : 'filter-node--unresolved'}`}>
      <span className="filter-node__icon">@</span>
      <span className="filter-node__value">{node.name}</span>
      {!node.resolved && (
        <span className="filter-node__warning" title="Stack not found">⚠</span>
      )}
      {onRemove && (
        <button
          className="filter-node__remove"
          onClick={() => onRemove(path)}
          aria-label={`Remove @${node.name} stack reference`}
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Get a flat summary of active filters
 */
export function getFilterSummary(root: FilterNode | null): string[] {
  if (!root) return [];

  const summaries: string[] = [];

  function walk(node: FilterNode) {
    switch (node.type) {
      case 'AND':
      case 'OR': {
        const group = node as FilterGroupNode;
        for (const child of group.children) {
          walk(child);
        }
        break;
      }
      case 'CATUSKOTI': {
        const cat = node as CatuskotiFilterNode;
        const op = cat.state === 'is' ? '+' : cat.state === 'is-not' ? '-' : cat.state === 'both' ? '~' : '?';
        summaries.push(`${op}${cat.category}:${cat.value}`);
        break;
      }
      case 'REGEX': {
        const regex = node as RegexFilterNode;
        summaries.push(`/${regex.pattern}/`);
        break;
      }
      case 'PHRASE': {
        const phrase = node as PhraseFilterNode;
        summaries.push(`"${phrase.phrase}"`);
        break;
      }
      case 'WILDCARD': {
        const wc = node as WildcardFilterNode;
        summaries.push(wc.pattern);
        break;
      }
      case 'COMPARISON': {
        const comp = node as ComparisonFilterNode;
        const value = comp.endValue !== undefined
          ? `${comp.value}..${comp.endValue}`
          : `${comp.operator}${comp.value}`;
        summaries.push(`${comp.category}:${value}`);
        break;
      }
      case 'STACK_REF': {
        const ref = node as SavedStackRefNode;
        summaries.push(`@${ref.name}`);
        break;
      }
    }
  }

  walk(root);
  return summaries;
}
