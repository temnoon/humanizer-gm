/**
 * FilterDimensionCarousel - Compact horizontal scroll filter controls
 *
 * Scroll/wheel on the dimension label to cycle through filter types:
 * - Date: Created/imported date ranges
 * - Words: Word count range
 * - Messages: Child passage count (conversations)
 * - Type: Content block types
 * - Tags: Tag selection
 * - Quality: SIC/AI detection score
 * - Source: Source type filter
 * - Author: Role filter (user/assistant)
 * - Has: Contains images, code, links
 * - Text: Full-text search
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import './filter-dimension-carousel.css';

export type FilterDimension =
  | 'date'
  | 'words'
  | 'messages'
  | 'type'
  | 'tags'
  | 'quality'
  | 'source'
  | 'author'
  | 'has'
  | 'text';

interface DimensionConfig {
  id: FilterDimension;
  label: string;
  icon: string;
  description: string;
}

const DIMENSIONS: DimensionConfig[] = [
  { id: 'date', label: 'Date', icon: '📅', description: 'Filter by date range' },
  { id: 'words', label: 'Words', icon: '📏', description: 'Filter by word count' },
  { id: 'messages', label: 'Messages', icon: '💬', description: 'Filter by message count' },
  { id: 'type', label: 'Type', icon: '📄', description: 'Filter by content type' },
  { id: 'tags', label: 'Tags', icon: '🏷️', description: 'Filter by tags' },
  { id: 'quality', label: 'Quality', icon: '✨', description: 'Filter by quality score' },
  { id: 'source', label: 'Source', icon: '📥', description: 'Filter by source' },
  { id: 'author', label: 'Author', icon: '👤', description: 'Filter by author role' },
  { id: 'has', label: 'Has', icon: '📎', description: 'Filter by content features' },
  { id: 'text', label: 'Text', icon: '🔍', description: 'Search in text' },
];

export interface FilterDimensionCarouselProps {
  /** Called when a filter is applied */
  onApplyFilter: (queryPart: string) => void;
  /** Available source types */
  availableSources?: string[];
  /** Available tags */
  availableTags?: string[];
  /** Available content types */
  availableTypes?: string[];
  /** Compact mode */
  compact?: boolean;
  /** Custom class */
  className?: string;
}

export function FilterDimensionCarousel({
  onApplyFilter,
  availableSources = [],
  availableTags = [],
  availableTypes = ['chat', 'note', 'document', 'folder'],
  compact = false,
  className = '',
}: FilterDimensionCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const labelRef = useRef<HTMLButtonElement>(null);

  const currentDimension = DIMENSIONS[currentIndex];

  // Cycle through dimensions
  const cycleDimension = useCallback((delta: number) => {
    setCurrentIndex((prev) => {
      const next = prev + delta;
      if (next < 0) return DIMENSIONS.length - 1;
      if (next >= DIMENSIONS.length) return 0;
      return next;
    });
  }, []);

  // Attach non-passive wheel listener to allow preventDefault
  useEffect(() => {
    const label = labelRef.current;
    if (!label) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1 : -1;
      setCurrentIndex((prev) => {
        const next = prev + delta;
        if (next < 0) return DIMENSIONS.length - 1;
        if (next >= DIMENSIONS.length) return 0;
        return next;
      });
    };

    label.addEventListener('wheel', handleWheel, { passive: false });
    return () => label.removeEventListener('wheel', handleWheel);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      cycleDimension(-1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      cycleDimension(1);
    }
  }, [cycleDimension]);

  return (
    <div className={`filter-carousel ${compact ? 'filter-carousel--compact' : ''} ${className}`}>
      {/* Dimension selector */}
      <button
        ref={labelRef}
        className="filter-carousel__label"
        onKeyDown={handleKeyDown}
        onClick={() => cycleDimension(1)}
        title={`${currentDimension.description} (scroll to change)`}
        aria-label={`Filter dimension: ${currentDimension.label}. Scroll or click to change.`}
      >
        <span className="filter-carousel__icon">{currentDimension.icon}</span>
        <span className="filter-carousel__name">{currentDimension.label}</span>
        <span className="filter-carousel__arrows">▲▼</span>
      </button>

      {/* Dimension-specific controls */}
      <div className="filter-carousel__controls">
        {currentDimension.id === 'date' && (
          <DateDimensionControls onApply={onApplyFilter} />
        )}
        {currentDimension.id === 'words' && (
          <RangeDimensionControls
            dimension="words"
            onApply={onApplyFilter}
            placeholder={{ min: 'Min', max: 'Max' }}
          />
        )}
        {currentDimension.id === 'messages' && (
          <RangeDimensionControls
            dimension="messages"
            onApply={onApplyFilter}
            placeholder={{ min: 'Min', max: 'Max' }}
          />
        )}
        {currentDimension.id === 'type' && (
          <SelectDimensionControls
            dimension="type"
            options={availableTypes}
            onApply={onApplyFilter}
          />
        )}
        {currentDimension.id === 'tags' && (
          <TagsDimensionControls
            availableTags={availableTags}
            onApply={onApplyFilter}
          />
        )}
        {currentDimension.id === 'quality' && (
          <QualityDimensionControls onApply={onApplyFilter} />
        )}
        {currentDimension.id === 'source' && (
          <SelectDimensionControls
            dimension="source"
            options={availableSources}
            onApply={onApplyFilter}
          />
        )}
        {currentDimension.id === 'author' && (
          <SelectDimensionControls
            dimension="author"
            options={['user', 'assistant', 'system']}
            onApply={onApplyFilter}
          />
        )}
        {currentDimension.id === 'has' && (
          <HasDimensionControls onApply={onApplyFilter} />
        )}
        {currentDimension.id === 'text' && (
          <TextDimensionControls onApply={onApplyFilter} />
        )}
      </div>

      {/* Dimension indicator dots */}
      <div className="filter-carousel__dots" aria-hidden="true">
        {DIMENSIONS.map((dim, i) => (
          <button
            key={dim.id}
            className={`filter-carousel__dot ${i === currentIndex ? 'filter-carousel__dot--active' : ''}`}
            onClick={() => setCurrentIndex(i)}
            title={dim.label}
            tabIndex={-1}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Dimension-specific control components
// ============================================================================

interface DateDimensionControlsProps {
  onApply: (queryPart: string) => void;
}

function DateDimensionControls({ onApply }: DateDimensionControlsProps) {
  const [mode, setMode] = useState<'range' | 'relative'>('relative');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [relative, setRelative] = useState('7d');

  const handleApply = () => {
    if (mode === 'range' && startDate) {
      const query = endDate
        ? `date:${startDate}..${endDate}`
        : `date:>${startDate}`;
      onApply(query);
    } else if (mode === 'relative') {
      onApply(`date:${relative}`);
    }
  };

  return (
    <div className="filter-carousel__dimension filter-carousel__dimension--date">
      <select
        className="filter-carousel__select filter-carousel__select--mode"
        value={mode}
        onChange={(e) => setMode(e.target.value as 'range' | 'relative')}
      >
        <option value="relative">Relative</option>
        <option value="range">Range</option>
      </select>

      {mode === 'relative' ? (
        <select
          className="filter-carousel__select"
          value={relative}
          onChange={(e) => setRelative(e.target.value)}
        >
          <option value="1d">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="1y">Last year</option>
          <option value="2024">2024</option>
          <option value="2023">2023</option>
        </select>
      ) : (
        <>
          <input
            type="date"
            className="filter-carousel__input filter-carousel__input--date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            placeholder="Start"
          />
          <span className="filter-carousel__separator">to</span>
          <input
            type="date"
            className="filter-carousel__input filter-carousel__input--date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            placeholder="End"
          />
        </>
      )}

      <button className="filter-carousel__apply" onClick={handleApply}>
        +
      </button>
    </div>
  );
}

interface RangeDimensionControlsProps {
  dimension: string;
  onApply: (queryPart: string) => void;
  placeholder?: { min: string; max: string };
}

function RangeDimensionControls({
  dimension,
  onApply,
  placeholder = { min: 'Min', max: 'Max' },
}: RangeDimensionControlsProps) {
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');

  const handleApply = () => {
    if (min && max) {
      onApply(`${dimension}:${min}..${max}`);
    } else if (min) {
      onApply(`${dimension}:>${min}`);
    } else if (max) {
      onApply(`${dimension}:<${max}`);
    }
  };

  return (
    <div className="filter-carousel__dimension filter-carousel__dimension--range">
      <input
        type="number"
        className="filter-carousel__input filter-carousel__input--number"
        value={min}
        onChange={(e) => setMin(e.target.value)}
        placeholder={placeholder.min}
        min="0"
      />
      <span className="filter-carousel__separator">–</span>
      <input
        type="number"
        className="filter-carousel__input filter-carousel__input--number"
        value={max}
        onChange={(e) => setMax(e.target.value)}
        placeholder={placeholder.max}
        min="0"
      />
      <button
        className="filter-carousel__apply"
        onClick={handleApply}
        disabled={!min && !max}
      >
        +
      </button>
    </div>
  );
}

interface SelectDimensionControlsProps {
  dimension: string;
  options: string[];
  onApply: (queryPart: string) => void;
}

function SelectDimensionControls({
  dimension,
  options,
  onApply,
}: SelectDimensionControlsProps) {
  const [selected, setSelected] = useState('');
  const [include, setInclude] = useState(true);

  const handleApply = () => {
    if (selected) {
      const op = include ? '+' : '-';
      onApply(`${op}${dimension}:${selected}`);
    }
  };

  return (
    <div className="filter-carousel__dimension filter-carousel__dimension--select">
      <button
        className={`filter-carousel__toggle ${include ? 'filter-carousel__toggle--include' : 'filter-carousel__toggle--exclude'}`}
        onClick={() => setInclude(!include)}
        title={include ? 'Include (click to exclude)' : 'Exclude (click to include)'}
      >
        {include ? '+' : '−'}
      </button>
      <select
        className="filter-carousel__select"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">Select...</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <button
        className="filter-carousel__apply"
        onClick={handleApply}
        disabled={!selected}
      >
        +
      </button>
    </div>
  );
}

interface TagsDimensionControlsProps {
  availableTags: string[];
  onApply: (queryPart: string) => void;
}

function TagsDimensionControls({ availableTags, onApply }: TagsDimensionControlsProps) {
  const [tag, setTag] = useState('');
  const [include, setInclude] = useState(true);

  const handleApply = () => {
    if (tag) {
      const op = include ? '+' : '-';
      onApply(`${op}tags:${tag}`);
      setTag('');
    }
  };

  return (
    <div className="filter-carousel__dimension filter-carousel__dimension--tags">
      <button
        className={`filter-carousel__toggle ${include ? 'filter-carousel__toggle--include' : 'filter-carousel__toggle--exclude'}`}
        onClick={() => setInclude(!include)}
        title={include ? 'Include (click to exclude)' : 'Exclude (click to include)'}
      >
        {include ? '+' : '−'}
      </button>
      <input
        type="text"
        className="filter-carousel__input"
        value={tag}
        onChange={(e) => setTag(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleApply()}
        placeholder="Tag name..."
        list="available-tags"
      />
      <datalist id="available-tags">
        {availableTags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <button
        className="filter-carousel__apply"
        onClick={handleApply}
        disabled={!tag}
      >
        +
      </button>
    </div>
  );
}

interface QualityDimensionControlsProps {
  onApply: (queryPart: string) => void;
}

function QualityDimensionControls({ onApply }: QualityDimensionControlsProps) {
  const [threshold, setThreshold] = useState(0.7);
  const [comparison, setComparison] = useState<'>' | '<'>('>');

  const handleApply = () => {
    onApply(`quality:${comparison}${threshold}`);
  };

  return (
    <div className="filter-carousel__dimension filter-carousel__dimension--quality">
      <select
        className="filter-carousel__select filter-carousel__select--small"
        value={comparison}
        onChange={(e) => setComparison(e.target.value as '>' | '<')}
      >
        <option value=">">Above</option>
        <option value="<">Below</option>
      </select>
      <input
        type="range"
        className="filter-carousel__slider"
        min="0"
        max="1"
        step="0.1"
        value={threshold}
        onChange={(e) => setThreshold(parseFloat(e.target.value))}
      />
      <span className="filter-carousel__value">{threshold.toFixed(1)}</span>
      <button className="filter-carousel__apply" onClick={handleApply}>
        +
      </button>
    </div>
  );
}

interface HasDimensionControlsProps {
  onApply: (queryPart: string) => void;
}

function HasDimensionControls({ onApply }: HasDimensionControlsProps) {
  const features = [
    { id: 'images', label: 'Images', icon: '🖼️' },
    { id: 'code', label: 'Code', icon: '💻' },
    { id: 'links', label: 'Links', icon: '🔗' },
    { id: 'lists', label: 'Lists', icon: '📋' },
    { id: 'tables', label: 'Tables', icon: '📊' },
  ];

  return (
    <div className="filter-carousel__dimension filter-carousel__dimension--has">
      {features.map((f) => (
        <button
          key={f.id}
          className="filter-carousel__feature-btn"
          onClick={() => onApply(`+has:${f.id}`)}
          title={`Has ${f.label}`}
        >
          {f.icon}
        </button>
      ))}
    </div>
  );
}

interface TextDimensionControlsProps {
  onApply: (queryPart: string) => void;
}

function TextDimensionControls({ onApply }: TextDimensionControlsProps) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'phrase' | 'regex' | 'wildcard'>('phrase');

  const handleApply = () => {
    if (!text) return;

    switch (mode) {
      case 'phrase':
        onApply(`"${text}"`);
        break;
      case 'regex':
        onApply(`/${text}/`);
        break;
      case 'wildcard':
        onApply(text.includes('*') ? text : `${text}*`);
        break;
    }
    setText('');
  };

  return (
    <div className="filter-carousel__dimension filter-carousel__dimension--text">
      <select
        className="filter-carousel__select filter-carousel__select--mode"
        value={mode}
        onChange={(e) => setMode(e.target.value as 'phrase' | 'regex' | 'wildcard')}
      >
        <option value="phrase">"Phrase"</option>
        <option value="regex">/Regex/</option>
        <option value="wildcard">Wild*</option>
      </select>
      <input
        type="text"
        className="filter-carousel__input filter-carousel__input--text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleApply()}
        placeholder={
          mode === 'phrase' ? 'Exact phrase...' :
          mode === 'regex' ? 'Pattern...' :
          'Search*...'
        }
      />
      <button
        className="filter-carousel__apply"
        onClick={handleApply}
        disabled={!text}
      >
        +
      </button>
    </div>
  );
}

export default FilterDimensionCarousel;
