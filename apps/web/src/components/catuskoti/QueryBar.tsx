/**
 * QueryBar - TECO-inspired query input with syntax highlighting
 *
 * Features:
 * - Syntax highlighting for operators, categories, regex
 * - Autocomplete for categories and source values
 * - Error indicators for parse errors
 * - Keyboard shortcuts (/, Ctrl+Enter, Escape)
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { parseQuery, type FilterTree, type ParseError, CATEGORY_PREFIXES, SOURCE_VALUES, FORMAT_VALUES } from '../../lib/query';
import './query-bar.css';

export interface QueryBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (tree: FilterTree) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

interface AutocompleteItem {
  value: string;
  label: string;
  category: string;
}

export function QueryBar({
  value,
  onChange,
  onSubmit,
  onFocus,
  onBlur,
  placeholder = 'Search... (+source:chatgpt /pattern/ @stack)',
  disabled = false,
  autoFocus = false,
  className = '',
}: QueryBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(0);

  // Parse the query for error highlighting
  const parseResult = useMemo(() => parseQuery(value), [value]);

  // Generate autocomplete suggestions based on cursor position
  const suggestions = useMemo(() => {
    if (!isFocused || !value) return [];

    const textBeforeCursor = value.slice(0, cursorPosition);
    const items: AutocompleteItem[] = [];

    // Check what we're typing
    const lastWord = textBeforeCursor.match(/[\w-]+$/)?.[0] || '';
    const hasColon = textBeforeCursor.endsWith(':') || /:\w*$/.test(textBeforeCursor);
    const categoryMatch = textBeforeCursor.match(/(\w+):(\w*)$/);

    if (categoryMatch) {
      const category = categoryMatch[1];
      const partial = categoryMatch[2].toLowerCase();

      // Suggest values for this category
      if (category === 'source') {
        for (const src of SOURCE_VALUES) {
          if (src.toLowerCase().startsWith(partial)) {
            items.push({ value: src, label: src, category: 'source' });
          }
        }
      } else if (category === 'format') {
        for (const fmt of FORMAT_VALUES) {
          if (fmt.toLowerCase().startsWith(partial)) {
            items.push({ value: fmt, label: fmt, category: 'format' });
          }
        }
      }
    } else if (lastWord && !hasColon) {
      // Suggest category prefixes
      const partial = lastWord.toLowerCase();
      for (const cat of CATEGORY_PREFIXES) {
        if (cat.startsWith(partial)) {
          items.push({ value: `${cat}:`, label: `${cat}:`, category: 'category' });
        }
      }

      // Also suggest source values if typing bare word
      for (const src of SOURCE_VALUES) {
        if (src.toLowerCase().startsWith(partial)) {
          items.push({ value: src, label: src, category: 'source' });
        }
      }
    }

    return items.slice(0, 8);
  }, [value, cursorPosition, isFocused]);

  // Syntax highlighting tokens
  const highlightedTokens = useMemo(() => {
    const tokens: Array<{ text: string; className: string }> = [];
    let remaining = value;
    let pos = 0;

    // Simple regex-based highlighting
    const patterns: Array<[RegExp, string]> = [
      [/^[+~?-]/, 'query-operator'],
      [/^&|\|/, 'query-boolean'],
      [/^!/, 'query-not'],
      [/^[()]/, 'query-paren'],
      [/^@[\w-]+/, 'query-stack'],
      [/^\/[^/]*\/[gimsuy]*/, 'query-regex'],
      [/^"[^"]*"/, 'query-phrase'],
      [/^(source|format|date|words|tags|quality|sim|content):/, 'query-category'],
      [/^[><=]+/, 'query-comparison'],
      [/^\.\./, 'query-range'],
      [/^\d{4}-\d{2}(-\d{2})?/, 'query-date'],
      [/^\d+(\.\d+)?/, 'query-number'],
      [/^[\w-]+\*/, 'query-wildcard'],
      [/^[\w-]+/, 'query-identifier'],
      [/^\s+/, 'query-whitespace'],
    ];

    while (remaining.length > 0) {
      let matched = false;

      for (const [pattern, className] of patterns) {
        const match = remaining.match(pattern);
        if (match) {
          tokens.push({ text: match[0], className });
          remaining = remaining.slice(match[0].length);
          pos += match[0].length;
          matched = true;
          break;
        }
      }

      if (!matched) {
        tokens.push({ text: remaining[0], className: 'query-unknown' });
        remaining = remaining.slice(1);
        pos += 1;
      }
    }

    return tokens;
  }, [value]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (e.ctrlKey || e.metaKey || !showAutocomplete) {
        e.preventDefault();
        onSubmit(parseResult);
      } else if (showAutocomplete && suggestions.length > 0) {
        e.preventDefault();
        applyAutocomplete(suggestions[autocompleteIndex]);
      }
    } else if (e.key === 'Escape') {
      if (showAutocomplete) {
        setShowAutocomplete(false);
      } else {
        onChange('');
        inputRef.current?.blur();
      }
    } else if (e.key === 'ArrowDown' && showAutocomplete) {
      e.preventDefault();
      setAutocompleteIndex(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp' && showAutocomplete) {
      e.preventDefault();
      setAutocompleteIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Tab' && showAutocomplete && suggestions.length > 0) {
      e.preventDefault();
      applyAutocomplete(suggestions[autocompleteIndex]);
    }
  }, [onSubmit, parseResult, showAutocomplete, suggestions, autocompleteIndex, onChange]);

  // Apply autocomplete selection
  const applyAutocomplete = useCallback((item: AutocompleteItem) => {
    const textBeforeCursor = value.slice(0, cursorPosition);
    const textAfterCursor = value.slice(cursorPosition);

    // Find what to replace
    const categoryMatch = textBeforeCursor.match(/(\w+):(\w*)$/);
    const wordMatch = textBeforeCursor.match(/[\w-]+$/);

    let newValue: string;
    let newCursorPos: number;

    if (categoryMatch) {
      // Replace value after colon
      const beforeValue = textBeforeCursor.slice(0, -categoryMatch[2].length);
      newValue = beforeValue + item.value + textAfterCursor;
      newCursorPos = beforeValue.length + item.value.length;
    } else if (wordMatch) {
      // Replace word
      const beforeWord = textBeforeCursor.slice(0, -wordMatch[0].length);
      newValue = beforeWord + item.value + textAfterCursor;
      newCursorPos = beforeWord.length + item.value.length;
    } else {
      newValue = value + item.value;
      newCursorPos = newValue.length;
    }

    onChange(newValue);
    setShowAutocomplete(false);

    // Restore cursor position
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.selectionStart = newCursorPos;
        inputRef.current.selectionEnd = newCursorPos;
      }
    });
  }, [value, cursorPosition, onChange]);

  // Track cursor position
  const handleSelect = useCallback(() => {
    if (inputRef.current) {
      setCursorPosition(inputRef.current.selectionStart || 0);
    }
  }, []);

  // Show autocomplete when typing
  useEffect(() => {
    if (suggestions.length > 0 && isFocused) {
      setShowAutocomplete(true);
      setAutocompleteIndex(0);
    } else {
      setShowAutocomplete(false);
    }
  }, [suggestions, isFocused]);

  // Sync overlay scroll with input
  useEffect(() => {
    if (inputRef.current && overlayRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  }, [value]);

  const handleFocus = () => {
    setIsFocused(true);
    onFocus?.();
  };

  const handleBlur = () => {
    // Delay to allow autocomplete clicks
    setTimeout(() => {
      setIsFocused(false);
      setShowAutocomplete(false);
      onBlur?.();
    }, 150);
  };

  const hasErrors = parseResult.parseErrors.length > 0;

  return (
    <div
      className={`query-bar ${className} ${isFocused ? 'query-bar--focused' : ''} ${hasErrors ? 'query-bar--error' : ''} ${disabled ? 'query-bar--disabled' : ''}`}
    >
      <div className="query-bar__icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      </div>

      <div className="query-bar__input-wrapper">
        {/* Syntax highlighting overlay */}
        <div className="query-bar__overlay" ref={overlayRef} aria-hidden="true">
          {highlightedTokens.map((token, i) => (
            <span key={i} className={token.className}>
              {token.text}
            </span>
          ))}
        </div>

        {/* Actual input */}
        <input
          ref={inputRef}
          type="text"
          className="query-bar__input"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onSelect={handleSelect}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          aria-label="Query input"
          aria-describedby={hasErrors ? 'query-bar-errors' : undefined}
        />
      </div>

      {/* Keyboard shortcut hint */}
      {isFocused && value && (
        <div className="query-bar__hint">
          <kbd>Enter</kbd> to search
        </div>
      )}

      {/* Autocomplete dropdown */}
      {showAutocomplete && suggestions.length > 0 && (
        <div className="query-bar__autocomplete" role="listbox">
          {suggestions.map((item, i) => (
            <button
              key={item.value}
              className={`query-bar__autocomplete-item ${i === autocompleteIndex ? 'query-bar__autocomplete-item--selected' : ''}`}
              onClick={() => applyAutocomplete(item)}
              role="option"
              aria-selected={i === autocompleteIndex}
            >
              <span className="query-bar__autocomplete-value">{item.label}</span>
              <span className="query-bar__autocomplete-category">{item.category}</span>
            </button>
          ))}
        </div>
      )}

      {/* Error display */}
      {hasErrors && (
        <div id="query-bar-errors" className="query-bar__errors" role="alert">
          {parseResult.parseErrors.map((error, i) => (
            <div key={i} className="query-bar__error">
              {error.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
