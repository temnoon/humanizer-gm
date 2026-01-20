/**
 * UnifiedArchiveView - Single view for all UCG content with nested navigation
 *
 * Features:
 * - Catuskoti four-state filtering (Is/Is Not/Both/Neither)
 * - Nested keyword navigation with breadcrumbs
 * - Back/forward through view history
 * - Infinite scroll with IntersectionObserver
 * - Integrates with buffer system for persistence
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getArchiveServerUrl, getArchiveServerUrlSync } from '../../lib/platform';
import { useBuffers } from '../../lib/buffer';
import { sanitizeText } from '../../lib/book-studio/sanitize';
import { MathMarkdown } from '../markdown/MathMarkdown';
import {
  CatuskotiFilterBar,
  CatuskotiActiveStrip,
  CatuskotiFilter,
  CatuskotiState,
  FilterCategory,
} from '../catuskoti';
import { FilterBuilder } from '../catuskoti/FilterBuilder';
import { RefinementBreadcrumbs } from '../catuskoti/RefinementBreadcrumbs';
import { SavedStacksInline } from '../catuskoti/SavedStacksPicker';
import { useRefinementHistory } from '../catuskoti/useRefinementHistory';
import {
  parseQuery,
  compileFilterTree,
  catuskotiFiltersToTree,
  filterTreeToCatuskotiFilters,
  type FilterTree,
  type CompiledQuery,
  type SavedStack,
  getSavedStacksStore,
} from '../../lib/query';
import './UnifiedArchiveView.css';

// ============================================================================
// Types
// ============================================================================

interface ContentNode {
  id: string;
  uri: string;
  content: {
    text: string;
    format: string;
    rendered?: string;
  };
  metadata: {
    title?: string;
    author?: string;
    createdAt: number;
    importedAt: number;
    wordCount: number;
    tags: string[];
    sourceMetadata?: Record<string, unknown>;
  };
  source: {
    type: string;
    adapter: string;
    originalId?: string;
    originalPath?: string;
    importBatch?: string;
  };
}

interface UCGStats {
  nodeCount: number;
  sourceTypeCounts: Record<string, number>;
  linkTypeCounts: Record<string, number>;
}

interface KeywordScore {
  keyword: string;
  occurrences: number;
  centrality: number;
  titleMatch: boolean;
  positionBonus: boolean;
}

interface KeywordResult {
  node: ContentNode;
  score: KeywordScore;
}

type SortBy = 'createdAt' | 'importedAt' | 'title' | 'wordCount' | 'centrality';

/**
 * Archive View State - represents a single view in the navigation stack
 */
interface ArchiveViewState {
  id: string;
  type: 'root' | 'search' | 'keyword';
  label: string;

  // For search states
  searchQuery?: string;

  // For keyword states
  keyword?: string;
  sourceNodeId?: string;

  // Common filters (legacy catuskoti)
  catuskotiFilters: CatuskotiFilter[];

  // Advanced query (new system)
  queryString?: string;
  filterTree?: FilterTree;
  compiledQuery?: CompiledQuery;

  sortBy: SortBy;
  sortDirection: 'asc' | 'desc';

  // Results (cached)
  results?: ContentNode[];
  keywordResults?: KeywordResult[];
  totalCount?: number;
}

// ============================================================================
// Media URL Transformation
// ============================================================================

/**
 * Transform file-service:// URLs in content to resolvable API endpoints.
 *
 * OpenAI exports use file-service://file-XXX URLs for media references.
 * This function replaces them with /api/ucg/media/by-pointer?pointer=... URLs
 * that the archive server can resolve.
 */
function transformMediaUrls(text: string, archiveServer: string | null): string {
  if (!text) return text;

  // Match file-service://file-XXX URLs in markdown image syntax: ![alt](file-service://...)
  // and also bare URLs
  const fileServicePattern = /file-service:\/\/file-[a-zA-Z0-9_-]+/g;

  return text.replace(fileServicePattern, (match) => {
    const baseUrl = archiveServer || '';
    return `${baseUrl}/api/ucg/media/by-pointer?pointer=${encodeURIComponent(match)}`;
  });
}

// ============================================================================
// Keyword Extraction (for detail panel)
// ============================================================================

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
  'shall', 'can', 'need', 'dare', 'ought', 'used', 'it', 'its', 'this', 'that',
  'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us',
  'them', 'my', 'your', 'his', 'our', 'their', 'mine', 'yours', 'hers', 'ours',
  'theirs', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'also', 'now', 'here', 'there', 'then', 'once', 'if', 'because', 'until', 'while',
  'about', 'after', 'before', 'above', 'below', 'between', 'into', 'through',
  'during', 'again', 'further', 'any', 'being', 'get', 'got', 'getting', 'going',
  'go', 'went', 'come', 'came', 'say', 'said', 'says', 'like', 'know', 'think',
  'see', 'look', 'want', 'give', 'use', 'find', 'tell', 'ask', 'work', 'seem',
  'feel', 'try', 'leave', 'call', 'keep', 'let', 'begin', 'show', 'hear', 'play',
  'run', 'move', 'live', 'believe', 'bring', 'happen', 'write', 'provide', 'sit',
  'stand', 'lose', 'pay', 'meet', 'include', 'continue', 'set', 'learn', 'change',
  'lead', 'understand', 'watch', 'follow', 'stop', 'create', 'speak', 'read',
  'allow', 'add', 'spend', 'grow', 'open', 'walk', 'win', 'offer', 'remember',
  'love', 'consider', 'appear', 'buy', 'wait', 'serve', 'die', 'send', 'expect',
  'build', 'stay', 'fall', 'cut', 'reach', 'kill', 'remain', 'yet', 'still',
  'even', 'however', 'though', 'although', 'unless', 'whether', 'since', 'therefore',
  'thus', 'hence', 'anyway', 'besides', 'otherwise', 'instead', 'meanwhile',
  're', 've', 'll', 'd', 's', 't', 'm', 'don', 'doesn', 'didn', 'won', 'wouldn',
  'couldn', 'shouldn', 'ain', 'aren', 'isn', 'wasn', 'weren', 'hasn', 'haven', 'hadn',
]);

function extractKeywords(text: string, maxKeywords: number = 15): string[] {
  if (!text || text.length < 50) return [];

  const words = text.toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) || 0) + 1);
  }

  const phrases = new Map<string, number>();
  for (let i = 0; i < words.length - 1; i++) {
    const phrase = `${words[i]} ${words[i + 1]}`;
    if (words[i].length > 2 && words[i + 1].length > 2) {
      phrases.set(phrase, (phrases.get(phrase) || 0) + 1);
    }
  }

  const results: Array<{ term: string; score: number }> = [];

  for (const [phrase, count] of phrases) {
    if (count >= 2) {
      results.push({ term: phrase, score: count * 2.5 });
    }
  }

  for (const [word, count] of freq) {
    if (count >= 2) {
      results.push({ term: word, score: count });
    }
  }

  results.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const { term } of results) {
    const termWords = term.split(' ');
    if (termWords.length === 1 && seen.has(term)) continue;

    keywords.push(term);
    termWords.forEach(w => seen.add(w));

    if (keywords.length >= maxKeywords) break;
  }

  const targetCount = Math.min(maxKeywords, Math.max(5, Math.floor(text.length / 200)));
  return keywords.slice(0, targetCount);
}

// ============================================================================
// Helper: Generate unique ID
// ============================================================================

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

// ============================================================================
// Component
// ============================================================================

export function UnifiedArchiveView() {
  const { importText } = useBuffers();

  // Navigation stack (history)
  const [navStack, setNavStack] = useState<ArchiveViewState[]>([]);
  const [navIndex, setNavIndex] = useState(-1);

  // Current view state
  const currentView = navIndex >= 0 ? navStack[navIndex] : null;

  // Stats for initializing filters
  const [stats, setStats] = useState<UCGStats | null>(null);

  // Loading and content state
  const [nodes, setNodes] = useState<ContentNode[]>([]);
  const [keywordResults, setKeywordResults] = useState<KeywordResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 50;

  // Selected node for detail panel
  const [selectedNode, setSelectedNode] = useState<ContentNode | null>(null);

  // Media items for selected node
  const [selectedNodeMedia, setSelectedNodeMedia] = useState<Array<{
    hash: string;
    url: string;
    mimeType: string | null;
    filename: string | null;
    width: number | null;
    height: number | null;
    description: string | null;
    altText: string | null;
  }>>([]);

  // Refs for infinite scroll
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Debounced search
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [searchInput, setSearchInput] = useState('');

  // Advanced query state
  const [queryString, setQueryString] = useState('');
  const [useAdvancedQuery, setUseAdvancedQuery] = useState(false);

  // Saved stacks
  const savedStacksStore = useMemo(() => getSavedStacksStore(), []);
  const [savedStacks, setSavedStacks] = useState<Map<string, SavedStack>>(new Map());

  // Load saved stacks
  useEffect(() => {
    setSavedStacks(savedStacksStore.getAsMap());
    return savedStacksStore.subscribe(() => {
      setSavedStacks(savedStacksStore.getAsMap());
    });
  }, [savedStacksStore]);

  // Refinement history
  const {
    history: refinementHistory,
    currentStep: currentRefinement,
    canUndo: canUndoRefinement,
    canRedo: canRedoRefinement,
    pushRefinement,
    undo: undoRefinement,
    redo: redoRefinement,
    goToStep: goToRefinementStep,
    allSteps: refinementSteps,
  } = useRefinementHistory({ initialCount: stats?.nodeCount || 0 });

  // ============================================================================
  // Initialize root view
  // ============================================================================

  useEffect(() => {
    fetchStats();
  }, []);

  // Fetch media when selected node changes
  useEffect(() => {
    if (!selectedNode) {
      setSelectedNodeMedia([]);
      return;
    }

    const fetchMedia = async () => {
      try {
        const archiveServer = await getArchiveServerUrl();
        const response = await fetch(`${archiveServer}/api/ucg/nodes/${selectedNode.id}/media`);
        if (response.ok) {
          const data = await response.json();
          setSelectedNodeMedia(data.media || []);
        } else {
          setSelectedNodeMedia([]);
        }
      } catch (error) {
        console.error('Failed to fetch media for node:', error);
        setSelectedNodeMedia([]);
      }
    };

    fetchMedia();
  }, [selectedNode?.id]);

  const fetchStats = async () => {
    try {
      const archiveServer = await getArchiveServerUrl();
      const response = await fetch(`${archiveServer}/api/ucg/stats`);
      if (response.ok) {
        const data: UCGStats = await response.json();
        setStats(data);

        // Initialize root view with filters
        const sourceFilters: CatuskotiFilter[] = data.sourceTypeCounts
          ? Object.entries(data.sourceTypeCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => ({
                id: `source:${type}`,
                label: formatSourceLabel(type),
                count,
                category: 'source' as FilterCategory,
                value: type,
                state: 'neutral' as CatuskotiState,
              }))
          : [];

        const rootView: ArchiveViewState = {
          id: generateId(),
          type: 'root',
          label: 'All Content',
          catuskotiFilters: sourceFilters,
          sortBy: 'createdAt',
          sortDirection: 'desc',
          totalCount: data.nodeCount,
        };

        setNavStack([rootView]);
        setNavIndex(0);
      }
    } catch (err) {
      console.error('Failed to fetch UCG stats:', err);
    }
  };

  // ============================================================================
  // Fetch content based on current view
  // ============================================================================

  useEffect(() => {
    if (!currentView) return;

    setPage(0);
    setNodes([]);
    setKeywordResults([]);

    if (currentView.type === 'keyword') {
      fetchKeywordResults();
    } else {
      fetchNodes(0);
    }
  }, [currentView?.id]);

  const fetchNodes = async (pageNum: number) => {
    if (!currentView) return;

    try {
      setLoading(true);
      const archiveServer = await getArchiveServerUrl();

      // Build query from either advanced query or legacy catuskoti filters
      let query: Record<string, unknown>;

      if (currentView.compiledQuery) {
        // Use advanced compiled query
        query = {
          ...currentView.compiledQuery,
          limit: pageSize,
          offset: pageNum * pageSize,
          orderBy: currentView.sortBy,
          orderDirection: currentView.sortDirection,
        };
      } else {
        // Fall back to legacy catuskoti filter extraction
        const includeTypes: string[] = [];
        const excludeTypes: string[] = [];

        for (const filter of currentView.catuskotiFilters) {
          if (filter.category === 'source') {
            if (filter.state === 'is') {
              includeTypes.push(filter.value);
            } else if (filter.state === 'is-not') {
              excludeTypes.push(filter.value);
            }
          }
        }

        query = {
          limit: pageSize,
          offset: pageNum * pageSize,
          orderBy: currentView.sortBy,
          orderDirection: currentView.sortDirection,
        };

        if (includeTypes.length > 0) {
          query.sourceType = includeTypes;
        }
        if (excludeTypes.length > 0) {
          query.excludeSourceTypes = excludeTypes;
        }
        if (currentView.searchQuery) {
          query.searchQuery = currentView.searchQuery;
        }
      }

      const response = await fetch(`${archiveServer}/api/ucg/nodes/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch nodes');
      }

      const data = await response.json();
      const fetchedNodes: ContentNode[] = data;

      if (pageNum === 0) {
        setNodes(fetchedNodes);
      } else {
        setNodes(prev => [...prev, ...fetchedNodes]);
      }

      setHasMore(fetchedNodes.length === pageSize);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch nodes:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch nodes');
    } finally {
      setLoading(false);
    }
  };

  const fetchKeywordResults = async () => {
    if (!currentView || currentView.type !== 'keyword' || !currentView.keyword) return;

    try {
      setLoading(true);
      const archiveServer = await getArchiveServerUrl();

      const response = await fetch(`${archiveServer}/api/ucg/nodes/by-keyword`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: currentView.keyword,
          excludeNodeId: currentView.sourceNodeId,
          limit: 50,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch keyword results');
      }

      const data = await response.json();
      setKeywordResults(data.results || []);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch keyword results:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // Infinite scroll
  // ============================================================================

  useEffect(() => {
    if (currentView?.type === 'keyword') return; // No pagination for keyword results

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          const nextPage = page + 1;
          setPage(nextPage);
          fetchNodes(nextPage);
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [hasMore, loading, page, currentView?.type]);

  // ============================================================================
  // Navigation functions
  // ============================================================================

  const pushView = useCallback((newView: ArchiveViewState) => {
    setNavStack(prev => {
      // Truncate forward history when pushing new view
      const newStack = prev.slice(0, navIndex + 1);
      return [...newStack, newView];
    });
    setNavIndex(prev => prev + 1);
    setSelectedNode(null);
  }, [navIndex]);

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navStack.length - 1;

  const goBack = useCallback(() => {
    if (canGoBack) {
      setNavIndex(prev => prev - 1);
      setSelectedNode(null);
    }
  }, [canGoBack]);

  const goForward = useCallback(() => {
    if (canGoForward) {
      setNavIndex(prev => prev + 1);
      setSelectedNode(null);
    }
  }, [canGoForward]);

  const navigateToIndex = useCallback((index: number) => {
    if (index >= 0 && index < navStack.length) {
      setNavIndex(index);
      setSelectedNode(null);
    }
  }, [navStack.length]);

  // ============================================================================
  // Filter handlers
  // ============================================================================

  const handleFilterChange = useCallback((filterId: string, newState: CatuskotiState) => {
    if (!currentView) return;

    const newFilters = currentView.catuskotiFilters.map(f =>
      f.id === filterId ? { ...f, state: newState } : f
    );

    // Update current view in stack
    setNavStack(prev => {
      const newStack = [...prev];
      newStack[navIndex] = { ...currentView, catuskotiFilters: newFilters };
      return newStack;
    });
  }, [currentView, navIndex]);

  const handleClearAllFilters = useCallback(() => {
    if (!currentView) return;

    const newFilters = currentView.catuskotiFilters.map(f => ({ ...f, state: 'neutral' as CatuskotiState }));

    setNavStack(prev => {
      const newStack = [...prev];
      newStack[navIndex] = {
        ...currentView,
        catuskotiFilters: newFilters,
        queryString: '',
        filterTree: undefined,
        compiledQuery: undefined,
      };
      return newStack;
    });
    setQueryString('');
  }, [currentView, navIndex]);

  // ============================================================================
  // Advanced Query handling
  // ============================================================================

  const handleAdvancedFilterChange = useCallback((compiled: CompiledQuery, tree: FilterTree) => {
    if (!currentView) return;

    // Update current view with new compiled query
    setNavStack(prev => {
      const newStack = [...prev];
      newStack[navIndex] = {
        ...currentView,
        queryString: tree.originalQuery,
        filterTree: tree,
        compiledQuery: compiled,
        // Also sync to legacy catuskoti filters for display
        catuskotiFilters: filterTreeToCatuskotiFilters(tree).length > 0
          ? filterTreeToCatuskotiFilters(tree)
          : currentView.catuskotiFilters,
      };
      return newStack;
    });
  }, [currentView, navIndex]);

  const handleAdvancedQuerySubmit = useCallback((compiled: CompiledQuery, tree: FilterTree) => {
    if (!currentView) return;

    // Generate a label for the refinement step
    const label = tree.originalQuery
      ? tree.originalQuery.slice(0, 30) + (tree.originalQuery.length > 30 ? '...' : '')
      : 'Filtered';

    // Push refinement to history (will be populated with count after fetch)
    pushRefinement(tree, nodes.length, label);

    // Push new view
    const searchView: ArchiveViewState = {
      id: generateId(),
      type: 'search',
      label: label,
      queryString: tree.originalQuery,
      filterTree: tree,
      compiledQuery: compiled,
      catuskotiFilters: filterTreeToCatuskotiFilters(tree).length > 0
        ? filterTreeToCatuskotiFilters(tree)
        : currentView.catuskotiFilters,
      sortBy: currentView.sortBy,
      sortDirection: currentView.sortDirection,
    };

    pushView(searchView);
  }, [currentView, nodes.length, pushRefinement, pushView]);

  const handleApplySavedStack = useCallback((stack: SavedStack) => {
    if (!currentView) return;

    const compiled = compileFilterTree(stack.tree);

    const searchView: ArchiveViewState = {
      id: generateId(),
      type: 'search',
      label: `@${stack.name}`,
      queryString: stack.query,
      filterTree: stack.tree,
      compiledQuery: compiled,
      catuskotiFilters: currentView.catuskotiFilters,
      sortBy: currentView.sortBy,
      sortDirection: currentView.sortDirection,
    };

    setQueryString(stack.query);
    pushView(searchView);
  }, [currentView, pushView]);

  // ============================================================================
  // Search handling
  // ============================================================================

  const handleSearch = useCallback((query: string) => {
    if (!currentView) return;

    if (!query.trim()) {
      // Clear search - update current view
      setNavStack(prev => {
        const newStack = [...prev];
        newStack[navIndex] = { ...currentView, searchQuery: undefined };
        return newStack;
      });
      return;
    }

    // Push new search view
    const searchView: ArchiveViewState = {
      id: generateId(),
      type: 'search',
      label: `"${query}"`,
      searchQuery: query,
      catuskotiFilters: currentView.catuskotiFilters,
      sortBy: currentView.sortBy,
      sortDirection: currentView.sortDirection,
    };

    pushView(searchView);
  }, [currentView, navIndex, pushView]);

  // Debounced search input
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      if (searchInput.trim() && searchInput !== currentView?.searchQuery) {
        handleSearch(searchInput);
      }
    }, 500);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchInput]);

  // ============================================================================
  // Keyword navigation
  // ============================================================================

  const handleKeywordClick = useCallback((keyword: string, sourceNodeId?: string) => {
    if (!currentView) return;

    const keywordView: ArchiveViewState = {
      id: generateId(),
      type: 'keyword',
      label: keyword,
      keyword,
      sourceNodeId,
      catuskotiFilters: currentView.catuskotiFilters,
      sortBy: 'centrality',
      sortDirection: 'desc',
    };

    pushView(keywordView);
  }, [currentView, pushView]);

  // ============================================================================
  // Open in workspace
  // ============================================================================

  const handleOpenInWorkspace = useCallback((node: ContentNode) => {
    const title = node.metadata.title || 'Untitled';
    const typeMap: Record<string, string> = {
      'chatgpt': 'chatgpt',
      'claude': 'chatgpt',
      'gemini': 'chatgpt',
      'facebook': 'facebook',
      'facebook-post': 'facebook',
      'facebook-comment': 'facebook',
      'facebook-message': 'facebook',
    };
    const mappedType = typeMap[node.source.type] || 'chatgpt';

    // Transform media URLs to include archive server prefix
    // This ensures images render correctly when workspace is on a different port
    const archiveServer = getArchiveServerUrlSync();
    let content = node.content.text;

    // 1. Transform file-service:// URLs to by-pointer API URLs
    content = transformMediaUrls(content, archiveServer);

    // 2. Transform relative /api/ URLs to absolute URLs
    // Match markdown images: ![alt](/api/...) and links: [text](/api/...)
    if (archiveServer) {
      content = content.replace(
        /(!\[[^\]]*\]|\[[^\]]*\])\(\/api\//g,
        `$1(${archiveServer}/api/`
      );
    }

    importText(content, title, {
      type: mappedType as 'chatgpt' | 'facebook',
      path: [node.source.type, title],
    });
    setSelectedNode(null);
  }, [importText]);

  // ============================================================================
  // Helpers
  // ============================================================================

  const formatSourceLabel = (type: string): string => {
    const labels: Record<string, string> = {
      'chatgpt': 'ChatGPT',
      'claude': 'Claude',
      'gemini': 'Gemini',
      'facebook': 'Facebook',
      'facebook-post': 'FB Posts',
      'facebook-comment': 'FB Comments',
      'facebook-message': 'FB Messages',
      'markdown': 'Markdown',
      'text': 'Text',
    };
    return labels[type] || type.charAt(0).toUpperCase() + type.slice(1);
  };

  const getSourceIcon = (type: string): string => {
    const icons: Record<string, string> = {
      'chatgpt': '💬',
      'claude': '🤖',
      'gemini': '✨',
      'facebook': '👤',
      'facebook-post': '📝',
      'facebook-comment': '💬',
      'facebook-message': '✉️',
      'markdown': '📄',
      'text': '📃',
      'file': '📁',
    };
    return icons[type] || '📋';
  };

  const formatRelativeTime = (timestamp: number): string => {
    if (!timestamp) return '';
    const diff = Date.now() - timestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  };

  const formatPreview = (node: ContentNode): string => {
    const text = sanitizeText(node.content.text || '');
    return text.length > 150 ? text.slice(0, 150) + '...' : text;
  };

  // Computed values
  const activeFilterCount = useMemo(() => {
    return currentView?.catuskotiFilters.filter(f => f.state !== 'neutral').length || 0;
  }, [currentView]);

  const selectedKeywords = useMemo(() => {
    if (!selectedNode?.content.text) return [];
    return extractKeywords(selectedNode.content.text);
  }, [selectedNode]);

  // ============================================================================
  // Render
  // ============================================================================

  if (!currentView) {
    return (
      <div className="unified-archive">
        <div className="unified-archive__loading">Loading...</div>
      </div>
    );
  }

  const displayNodes = currentView.type === 'keyword'
    ? keywordResults.map(r => r.node)
    : nodes;

  return (
    <div className="unified-archive">
      {/* Navigation Bar with Breadcrumbs */}
      <nav className="unified-archive__nav">
        <div className="unified-archive__nav-buttons">
          <button
            type="button"
            className="unified-archive__nav-btn"
            onClick={goBack}
            disabled={!canGoBack}
            aria-label="Go back"
            title="Go back"
          >
            ←
          </button>
          <button
            type="button"
            className="unified-archive__nav-btn"
            onClick={goForward}
            disabled={!canGoForward}
            aria-label="Go forward"
            title="Go forward"
          >
            →
          </button>
        </div>

        <div className="unified-archive__breadcrumbs">
          {navStack.slice(0, navIndex + 1).map((view, index) => (
            <span key={view.id} className="unified-archive__breadcrumb-item">
              {index > 0 && <span className="unified-archive__breadcrumb-sep">›</span>}
              <button
                type="button"
                className={`unified-archive__breadcrumb ${index === navIndex ? 'unified-archive__breadcrumb--active' : ''}`}
                onClick={() => navigateToIndex(index)}
              >
                {view.type === 'keyword' && <span className="unified-archive__breadcrumb-icon">🔑</span>}
                {view.type === 'search' && <span className="unified-archive__breadcrumb-icon">🔍</span>}
                {view.label}
              </button>
            </span>
          ))}
        </div>

        <div className="unified-archive__nav-count">
          {currentView.type === 'keyword'
            ? `${keywordResults.length} matches`
            : stats?.nodeCount !== undefined
              ? `${displayNodes.length} of ${stats.nodeCount.toLocaleString()}`
              : ''
          }
        </div>
      </nav>

      {/* Search Bar / Advanced Query Builder */}
      <header className="unified-archive__header">
        <div className="unified-archive__query-toggle">
          <button
            type="button"
            className={`unified-archive__mode-btn ${!useAdvancedQuery ? 'unified-archive__mode-btn--active' : ''}`}
            onClick={() => setUseAdvancedQuery(false)}
          >
            Simple
          </button>
          <button
            type="button"
            className={`unified-archive__mode-btn ${useAdvancedQuery ? 'unified-archive__mode-btn--active' : ''}`}
            onClick={() => setUseAdvancedQuery(true)}
          >
            Advanced
          </button>
        </div>

        {useAdvancedQuery ? (
          /* Advanced Query Builder */
          <div className="unified-archive__advanced-query">
            <FilterBuilder
              initialQuery={queryString}
              initialFilters={currentView.catuskotiFilters}
              onFilterChange={handleAdvancedFilterChange}
              onSubmit={handleAdvancedQuerySubmit}
              savedStacks={savedStacks}
              availableSources={stats ? Object.keys(stats.sourceTypeCounts) : []}
              compact
            />
            {/* Saved Stacks Quick Access */}
            <SavedStacksInline
              onApply={handleApplySavedStack}
              className="unified-archive__saved-stacks"
            />
          </div>
        ) : (
          /* Simple Search */
          <div className="unified-archive__search-row">
            <input
              type="search"
              placeholder="Search titles and content..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearch(searchInput);
                }
              }}
              className="unified-archive__search"
              aria-label="Search content"
            />
            <div className="unified-archive__sort">
              <select
                value={currentView.sortBy}
                onChange={(e) => {
                  const newSort = e.target.value as SortBy;
                  setNavStack(prev => {
                    const newStack = [...prev];
                    newStack[navIndex] = { ...currentView, sortBy: newSort };
                    return newStack;
                  });
                }}
                className="unified-archive__select"
                aria-label="Sort by"
              >
                <option value="createdAt">Date</option>
                <option value="importedAt">Imported</option>
                <option value="wordCount">Length</option>
                {currentView.type === 'keyword' && (
                  <option value="centrality">Relevance</option>
                )}
              </select>
              <button
                type="button"
                className="unified-archive__sort-btn"
                onClick={() => {
                  setNavStack(prev => {
                    const newStack = [...prev];
                    newStack[navIndex] = {
                      ...currentView,
                      sortDirection: currentView.sortDirection === 'asc' ? 'desc' : 'asc',
                    };
                    return newStack;
                  });
                }}
                aria-label={currentView.sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'}
              >
                {currentView.sortDirection === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          </div>
        )}

        {/* Refinement Breadcrumbs (shown when there's refinement history) */}
        {refinementSteps.length > 1 && (
          <RefinementBreadcrumbs
            steps={refinementSteps}
            currentIndex={refinementHistory.currentIndex}
            onStepClick={(index) => {
              const step = goToRefinementStep(index);
              if (step && step.tree.root) {
                // Apply the tree from that refinement step
                const compiled = compileFilterTree(step.tree);
                setNavStack(prev => {
                  const newStack = [...prev];
                  newStack[navIndex] = {
                    ...currentView,
                    queryString: step.query,
                    filterTree: step.tree,
                    compiledQuery: compiled,
                  };
                  return newStack;
                });
                setQueryString(step.query);
              }
            }}
            onUndo={() => {
              const step = undoRefinement();
              if (step) setQueryString(step.query);
            }}
            onRedo={() => {
              const step = redoRefinement();
              if (step) setQueryString(step.query);
            }}
            canUndo={canUndoRefinement}
            canRedo={canRedoRefinement}
            compact
            className="unified-archive__refinement"
          />
        )}
      </header>

      {/* Catuskoti Filter Bar */}
      {currentView.catuskotiFilters.length > 0 && (
        <CatuskotiFilterBar
          filters={currentView.catuskotiFilters}
          onFilterChange={handleFilterChange}
          onClearAll={handleClearAllFilters}
        />
      )}

      {/* Active Filter Strip */}
      {activeFilterCount > 0 && (
        <CatuskotiActiveStrip
          filters={currentView.catuskotiFilters}
          onFilterChange={handleFilterChange}
          onClearFilter={(id) => handleFilterChange(id, 'neutral')}
          onClearAll={handleClearAllFilters}
        />
      )}

      {/* Error */}
      {error && (
        <div className="unified-archive__error" role="alert">
          {error}
        </div>
      )}

      {/* Content List */}
      <div className="unified-archive__content">
        {displayNodes.length === 0 && !loading ? (
          <div className="unified-archive__empty">
            <p>
              {currentView.type === 'keyword'
                ? `No passages found where "${currentView.keyword}" is central.`
                : 'No content found.'}
            </p>
            {(activeFilterCount > 0 || currentView.searchQuery) && (
              <button
                className="unified-archive__empty-clear"
                onClick={() => {
                  handleClearAllFilters();
                  if (currentView.type !== 'root') {
                    navigateToIndex(0);
                  }
                }}
              >
                Clear filters and go back
              </button>
            )}
          </div>
        ) : (
          <div className="unified-archive__list">
            {currentView.type === 'keyword'
              ? keywordResults.map(({ node, score }) => (
                  <article
                    key={node.id}
                    className={`unified-archive__card ${selectedNode?.id === node.id ? 'unified-archive__card--selected' : ''}`}
                    onClick={() => setSelectedNode(selectedNode?.id === node.id ? null : node)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedNode(selectedNode?.id === node.id ? null : node);
                      }
                    }}
                  >
                    <div className="unified-archive__card-icon">
                      {getSourceIcon(node.source.type)}
                    </div>
                    <div className="unified-archive__card-body">
                      <div className="unified-archive__card-header">
                        <span className="unified-archive__card-title">
                          {node.metadata.title || 'Untitled'}
                        </span>
                        <span className="unified-archive__card-relevance" title="Keyword centrality">
                          {score.occurrences}×
                          {score.titleMatch && <span className="unified-archive__badge">title</span>}
                        </span>
                      </div>
                      <p className="unified-archive__card-preview">
                        {formatPreview(node)}
                      </p>
                      <div className="unified-archive__card-meta">
                        <span className="unified-archive__card-source">
                          {formatSourceLabel(node.source.type)}
                        </span>
                        <span className="unified-archive__card-time">
                          {formatRelativeTime(node.metadata.createdAt)}
                        </span>
                      </div>
                    </div>
                  </article>
                ))
              : nodes.map((node) => (
                  <article
                    key={node.id}
                    className={`unified-archive__card ${selectedNode?.id === node.id ? 'unified-archive__card--selected' : ''}`}
                    onClick={() => setSelectedNode(selectedNode?.id === node.id ? null : node)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedNode(selectedNode?.id === node.id ? null : node);
                      }
                    }}
                  >
                    <div className="unified-archive__card-icon">
                      {getSourceIcon(node.source.type)}
                    </div>
                    <div className="unified-archive__card-body">
                      <div className="unified-archive__card-header">
                        <span className="unified-archive__card-title">
                          {node.metadata.title || 'Untitled'}
                        </span>
                        <span className="unified-archive__card-time">
                          {formatRelativeTime(node.metadata.createdAt)}
                        </span>
                      </div>
                      <p className="unified-archive__card-preview">
                        {formatPreview(node)}
                      </p>
                      <div className="unified-archive__card-meta">
                        <span className="unified-archive__card-source">
                          {formatSourceLabel(node.source.type)}
                        </span>
                        <span className="unified-archive__card-words">
                          {node.metadata.wordCount.toLocaleString()} words
                        </span>
                      </div>
                    </div>
                  </article>
                ))
            }
          </div>
        )}

        {/* Infinite scroll sentinel */}
        {currentView.type !== 'keyword' && (
          <div
            ref={loadMoreRef}
            className="unified-archive__sentinel"
            aria-hidden="true"
          />
        )}

        {/* Loading indicator */}
        {loading && (
          <div className="unified-archive__loading">
            <span className="unified-archive__spinner" />
            Loading...
          </div>
        )}
      </div>

      {/* Detail Panel */}
      {selectedNode && (
        <aside className="unified-archive__detail">
          <header className="unified-archive__detail-header">
            <button
              type="button"
              className="unified-archive__detail-title"
              onClick={() => handleOpenInWorkspace(selectedNode)}
              title="Open in workspace"
            >
              <h3>{selectedNode.metadata.title || 'Untitled'}</h3>
              <span className="unified-archive__detail-open-hint">Open</span>
            </button>
            <button
              type="button"
              className="unified-archive__detail-close"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedNode(null);
              }}
              aria-label="Close detail panel"
            >
              ×
            </button>
          </header>

          {/* Keywords - click to drill down */}
          {selectedKeywords.length > 0 && (
            <div className="unified-archive__detail-keywords">
              {selectedKeywords.map((keyword, i) => (
                <span
                  key={i}
                  className="unified-archive__keyword"
                  onClick={() => handleKeywordClick(keyword, selectedNode.id)}
                  title={`Find passages where "${keyword}" is central`}
                >
                  {keyword}
                </span>
              ))}
            </div>
          )}

          <div className="unified-archive__detail-meta">
            <span>{formatSourceLabel(selectedNode.source.type)}</span>
            <span>{selectedNode.content.format}</span>
            <span>{new Date(selectedNode.metadata.createdAt).toLocaleDateString()}</span>
            <span>{selectedNode.metadata.wordCount.toLocaleString()} words</span>
          </div>
          <div className="unified-archive__detail-content">
            <MathMarkdown className="unified-archive__markdown">
              {transformMediaUrls(selectedNode.content.text, getArchiveServerUrlSync())}
            </MathMarkdown>
            {selectedNodeMedia.length > 0 && (
              <div className="unified-archive__detail-media">
                <h4 className="unified-archive__media-heading">Media ({selectedNodeMedia.length})</h4>
                <div className="unified-archive__media-grid">
                  {selectedNodeMedia.map((media) => (
                    <div key={media.hash} className="unified-archive__media-item">
                      {media.mimeType?.startsWith('image/') ? (
                        <img
                          src={`${getArchiveServerUrlSync() || ''}${media.url}`}
                          alt={media.altText || media.filename || 'Image'}
                          className="unified-archive__media-image"
                          loading="lazy"
                        />
                      ) : media.mimeType?.startsWith('audio/') ? (
                        <audio
                          src={`${getArchiveServerUrlSync() || ''}${media.url}`}
                          controls
                          className="unified-archive__media-audio"
                        />
                      ) : (
                        <a
                          href={`${getArchiveServerUrlSync() || ''}${media.url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="unified-archive__media-link"
                        >
                          {media.filename || 'Download file'}
                        </a>
                      )}
                      {media.description && (
                        <p className="unified-archive__media-description">{media.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {selectedNode.metadata.tags.length > 0 && (
            <div className="unified-archive__detail-tags">
              {selectedNode.metadata.tags.map(tag => (
                <span key={tag} className="unified-archive__tag">{tag}</span>
              ))}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
