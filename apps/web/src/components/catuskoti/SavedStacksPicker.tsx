/**
 * SavedStacksPicker - UI for managing and applying saved filter stacks
 *
 * Features:
 * - List of saved stacks with usage stats
 * - Quick apply via click or keyboard (Ctrl+1..9)
 * - Create/edit/delete operations
 * - Drag to reorder shortcuts
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { SavedStack, FilterTree } from '../../lib/query';
import { getSavedStacksStore } from '../../lib/query/SavedStacks';
import './saved-stacks-picker.css';

export interface SavedStacksPickerProps {
  /** Called when a stack is applied */
  onApply: (stack: SavedStack) => void;
  /** Called when creating a new stack (passes current query for pre-fill) */
  onCreateNew?: () => void;
  /** Current query for "Save current" feature */
  currentQuery?: string;
  /** Archive server URL for sync */
  archiveServerUrl?: string;
  /** Compact mode */
  compact?: boolean;
  /** Custom class name */
  className?: string;
}

export function SavedStacksPicker({
  onApply,
  onCreateNew,
  currentQuery = '',
  archiveServerUrl,
  compact = false,
  className = '',
}: SavedStacksPickerProps) {
  const store = useMemo(() => getSavedStacksStore(archiveServerUrl), [archiveServerUrl]);
  const [stacks, setStacks] = useState<SavedStack[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Load stacks
  useEffect(() => {
    setStacks(store.getAll());
    return store.subscribe(setStacks);
  }, [store]);

  // Handle keyboard shortcuts (Ctrl+1..9)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '9') {
        const shortcut = parseInt(e.key);
        const stack = store.getByShortcut(shortcut);
        if (stack) {
          e.preventDefault();
          handleApply(stack);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store]);

  const handleApply = useCallback((stack: SavedStack) => {
    store.recordUsage(stack.name);
    onApply(stack);
  }, [store, onApply]);

  const handleCreate = useCallback(() => {
    if (!newName.trim()) {
      setError('Name is required');
      return;
    }

    try {
      const stack = store.create(newName.trim(), currentQuery);
      setIsCreating(false);
      setNewName('');
      setError(null);
      handleApply(stack);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [store, newName, currentQuery, handleApply]);

  const handleDelete = useCallback((name: string) => {
    if (confirm(`Delete saved stack "${name}"?`)) {
      store.delete(name);
    }
  }, [store]);

  const handleAssignShortcut = useCallback((name: string, shortcut: number | undefined) => {
    store.assignShortcut(name, shortcut);
  }, [store]);

  // Group stacks by shortcut assignment
  const { withShortcuts, withoutShortcuts } = useMemo(() => {
    const with_: SavedStack[] = [];
    const without: SavedStack[] = [];

    for (const stack of stacks) {
      if (stack.keyboardShortcut) {
        with_.push(stack);
      } else {
        without.push(stack);
      }
    }

    // Sort by shortcut
    with_.sort((a, b) => (a.keyboardShortcut || 0) - (b.keyboardShortcut || 0));

    return { withShortcuts: with_, withoutShortcuts: without };
  }, [stacks]);

  return (
    <div className={`saved-stacks-picker ${compact ? 'saved-stacks-picker--compact' : ''} ${className}`}>
      <div className="saved-stacks-picker__header">
        <h3 className="saved-stacks-picker__title">Saved Stacks</h3>
        {currentQuery && (
          <button
            className="saved-stacks-picker__save-btn"
            onClick={() => setIsCreating(true)}
            title="Save current query as stack"
          >
            + Save Current
          </button>
        )}
      </div>

      {/* Create new stack form */}
      {isCreating && (
        <div className="saved-stacks-picker__create">
          <input
            type="text"
            className="saved-stacks-picker__input"
            placeholder="Stack name (e.g., philosophy)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') {
                setIsCreating(false);
                setNewName('');
                setError(null);
              }
            }}
            autoFocus
          />
          <button
            className="saved-stacks-picker__create-btn"
            onClick={handleCreate}
          >
            Save
          </button>
          <button
            className="saved-stacks-picker__cancel-btn"
            onClick={() => {
              setIsCreating(false);
              setNewName('');
              setError(null);
            }}
          >
            Cancel
          </button>
          {error && <div className="saved-stacks-picker__error">{error}</div>}
        </div>
      )}

      {/* Stacks with keyboard shortcuts */}
      {withShortcuts.length > 0 && (
        <div className="saved-stacks-picker__section">
          <div className="saved-stacks-picker__section-title">Quick Access (Ctrl+N)</div>
          <div className="saved-stacks-picker__list">
            {withShortcuts.map(stack => (
              <StackItem
                key={stack.id}
                stack={stack}
                onApply={() => handleApply(stack)}
                onDelete={() => handleDelete(stack.name)}
                onAssignShortcut={(n) => handleAssignShortcut(stack.name, n)}
                compact={compact}
              />
            ))}
          </div>
        </div>
      )}

      {/* Other stacks */}
      {withoutShortcuts.length > 0 && (
        <div className="saved-stacks-picker__section">
          {withShortcuts.length > 0 && (
            <div className="saved-stacks-picker__section-title">Other</div>
          )}
          <div className="saved-stacks-picker__list">
            {withoutShortcuts.map(stack => (
              <StackItem
                key={stack.id}
                stack={stack}
                onApply={() => handleApply(stack)}
                onDelete={() => handleDelete(stack.name)}
                onAssignShortcut={(n) => handleAssignShortcut(stack.name, n)}
                compact={compact}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {stacks.length === 0 && !isCreating && (
        <div className="saved-stacks-picker__empty">
          <p>No saved stacks yet.</p>
          <p>Save your current filters as a stack for quick access.</p>
        </div>
      )}
    </div>
  );
}

// Stack item component
interface StackItemProps {
  stack: SavedStack;
  onApply: () => void;
  onDelete: () => void;
  onAssignShortcut: (shortcut: number | undefined) => void;
  compact?: boolean;
}

function StackItem({ stack, onApply, onDelete, onAssignShortcut, compact }: StackItemProps) {
  const [showShortcutPicker, setShowShortcutPicker] = useState(false);

  return (
    <div className={`stack-item ${compact ? 'stack-item--compact' : ''}`}>
      <button
        className="stack-item__main"
        onClick={onApply}
        title={`Apply @${stack.name}\n${stack.query}`}
      >
        {stack.keyboardShortcut && (
          <kbd className="stack-item__shortcut">{stack.keyboardShortcut}</kbd>
        )}
        <span className="stack-item__name">@{stack.name}</span>
        {stack.resultCount !== undefined && (
          <span className="stack-item__count">{stack.resultCount.toLocaleString()}</span>
        )}
      </button>

      <div className="stack-item__actions">
        {/* Shortcut picker */}
        <button
          className="stack-item__action"
          onClick={() => setShowShortcutPicker(!showShortcutPicker)}
          title="Assign keyboard shortcut"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
          </svg>
        </button>

        {/* Delete */}
        <button
          className="stack-item__action stack-item__action--danger"
          onClick={onDelete}
          title="Delete stack"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
          </svg>
        </button>
      </div>

      {/* Shortcut picker dropdown */}
      {showShortcutPicker && (
        <div className="stack-item__shortcut-picker">
          <button
            className="stack-item__shortcut-option"
            onClick={() => {
              onAssignShortcut(undefined);
              setShowShortcutPicker(false);
            }}
          >
            None
          </button>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
            <button
              key={n}
              className={`stack-item__shortcut-option ${stack.keyboardShortcut === n ? 'stack-item__shortcut-option--active' : ''}`}
              onClick={() => {
                onAssignShortcut(n);
                setShowShortcutPicker(false);
              }}
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Inline version showing just the quick-access stacks
 */
export function SavedStacksInline({
  onApply,
  archiveServerUrl,
  className = '',
}: Pick<SavedStacksPickerProps, 'onApply' | 'archiveServerUrl' | 'className'>) {
  const store = useMemo(() => getSavedStacksStore(archiveServerUrl), [archiveServerUrl]);
  const [stacks, setStacks] = useState<SavedStack[]>([]);

  useEffect(() => {
    const update = () => setStacks(
      store.getAll()
        .filter(s => s.keyboardShortcut)
        .sort((a, b) => (a.keyboardShortcut || 0) - (b.keyboardShortcut || 0))
    );
    update();
    return store.subscribe(update);
  }, [store]);

  if (stacks.length === 0) return null;

  return (
    <div className={`saved-stacks-inline ${className}`}>
      {stacks.map(stack => (
        <button
          key={stack.id}
          className="saved-stacks-inline__item"
          onClick={() => {
            store.recordUsage(stack.name);
            onApply(stack);
          }}
          title={`Ctrl+${stack.keyboardShortcut}: @${stack.name}`}
        >
          <kbd>{stack.keyboardShortcut}</kbd>
          <span>@{stack.name}</span>
        </button>
      ))}
    </div>
  );
}
