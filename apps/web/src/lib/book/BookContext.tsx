/**
 * BookContext - React context for book project state management
 *
 * Features:
 * - Wraps BookProjectService with React state
 * - Provides useBook() hook
 * - Debounced auto-save
 * - Active project management
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';

import type {
  BookProject,
  DraftChapter,
  SourcePassage,
} from '../../components/archive/book-project/types';

import { bookProjectService } from './BookProjectService';

// ═══════════════════════════════════════════════════════════════════
// CONTEXT TYPE
// ═══════════════════════════════════════════════════════════════════

interface BookContextType {
  // State
  projects: BookProject[];
  activeProject: BookProject | null;
  isDirty: boolean;
  isSaving: boolean;
  lastSaved: Date | null;

  // Project management
  loadProjects: () => void;
  loadProject: (id: string) => void;
  setActiveProject: (project: BookProject | null) => void;
  createProject: (name: string, subtitle?: string) => BookProject;
  deleteProject: (id: string) => void;

  // Chapter operations
  updateChapter: (chapterId: string, content: string, changes?: string) => void;
  createChapter: (title: string, content?: string) => DraftChapter | null;
  deleteChapter: (chapterId: string) => void;

  // Version operations
  revertToVersion: (chapterId: string, version: number) => void;
  getChapter: (chapterId: string) => DraftChapter | null;

  // Passage operations
  addPassage: (passageData: {
    content: string;
    conversationId?: string;
    conversationTitle: string;
    role?: 'user' | 'assistant';
    tags?: string[];
  }) => SourcePassage | null;
  updatePassage: (passageId: string, updates: Partial<SourcePassage>) => void;
  getPassages: () => SourcePassage[];
  deletePassage: (passageId: string) => void;

  // Rendering
  renderBook: () => string;

  // Persistence
  save: () => void;
  forceSave: () => void;
}

const BookContext = createContext<BookContextType | null>(null);

// ═══════════════════════════════════════════════════════════════════
// PROVIDER
// ═══════════════════════════════════════════════════════════════════

const AUTO_SAVE_DELAY = 2000; // 2 seconds

interface BookProviderProps {
  children: ReactNode;
}

export function BookProvider({ children }: BookProviderProps) {
  // State
  const [projects, setProjects] = useState<BookProject[]>([]);
  const [activeProject, setActiveProjectState] = useState<BookProject | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Refs for debouncing
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ─────────────────────────────────────────────────────────────────
  // PROJECT MANAGEMENT
  // ─────────────────────────────────────────────────────────────────

  const loadProjects = useCallback(() => {
    const loaded = bookProjectService.loadAll();
    setProjects(loaded);
  }, []);

  const loadProject = useCallback((id: string) => {
    const project = bookProjectService.load(id);
    if (project) {
      setActiveProjectState(project);
      setIsDirty(false);
      setLastSaved(new Date(project.updatedAt));
    }
  }, []);

  const setActiveProject = useCallback((project: BookProject | null) => {
    // Save current project if dirty
    if (activeProject && isDirty) {
      bookProjectService.save(activeProject);
    }
    setActiveProjectState(project);
    setIsDirty(false);
    if (project) {
      setLastSaved(new Date(project.updatedAt));
    }
  }, [activeProject, isDirty]);

  const createProject = useCallback((name: string, subtitle?: string): BookProject => {
    const project = bookProjectService.createProject(name, subtitle);
    setProjects(prev => [...prev, project]);
    setActiveProjectState(project);
    setIsDirty(false);
    setLastSaved(new Date());
    return project;
  }, []);

  const deleteProject = useCallback((id: string) => {
    bookProjectService.delete(id);
    setProjects(prev => prev.filter(p => p.id !== id));
    if (activeProject?.id === id) {
      setActiveProjectState(null);
    }
  }, [activeProject]);

  // ─────────────────────────────────────────────────────────────────
  // CHAPTER OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  const updateChapter = useCallback((
    chapterId: string,
    content: string,
    changes?: string
  ) => {
    if (!activeProject) return;

    try {
      const { project: updatedProject } = bookProjectService.updateChapter(
        activeProject,
        chapterId,
        content,
        changes
      );

      setActiveProjectState(updatedProject);
      setProjects(prev =>
        prev.map(p => p.id === updatedProject.id ? updatedProject : p)
      );
      setIsDirty(false);
      setLastSaved(new Date());
    } catch (e) {
      console.error('Failed to update chapter:', e);
    }
  }, [activeProject]);

  const createChapter = useCallback((
    title: string,
    content?: string
  ): DraftChapter | null => {
    if (!activeProject) return null;

    try {
      const { project: updatedProject, chapter } = bookProjectService.createChapter(
        activeProject,
        title,
        content
      );

      setActiveProjectState(updatedProject);
      setProjects(prev =>
        prev.map(p => p.id === updatedProject.id ? updatedProject : p)
      );
      setLastSaved(new Date());
      return chapter;
    } catch (e) {
      console.error('Failed to create chapter:', e);
      return null;
    }
  }, [activeProject]);

  const deleteChapter = useCallback((chapterId: string) => {
    if (!activeProject) return;

    try {
      const updatedProject = bookProjectService.deleteChapter(
        activeProject,
        chapterId
      );

      setActiveProjectState(updatedProject);
      setProjects(prev =>
        prev.map(p => p.id === updatedProject.id ? updatedProject : p)
      );
      setLastSaved(new Date());
    } catch (e) {
      console.error('Failed to delete chapter:', e);
    }
  }, [activeProject]);

  // ─────────────────────────────────────────────────────────────────
  // VERSION OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  const revertToVersion = useCallback((chapterId: string, version: number) => {
    if (!activeProject) return;

    try {
      const { project: updatedProject } = bookProjectService.revertToVersion(
        activeProject,
        chapterId,
        version
      );

      setActiveProjectState(updatedProject);
      setProjects(prev =>
        prev.map(p => p.id === updatedProject.id ? updatedProject : p)
      );
      setLastSaved(new Date());
    } catch (e) {
      console.error('Failed to revert to version:', e);
    }
  }, [activeProject]);

  const getChapter = useCallback((chapterId: string): DraftChapter | null => {
    if (!activeProject) return null;
    return bookProjectService.getChapter(activeProject, chapterId);
  }, [activeProject]);

  // ─────────────────────────────────────────────────────────────────
  // PASSAGE OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  const addPassage = useCallback((passageData: {
    content: string;
    conversationId?: string;
    conversationTitle: string;
    role?: 'user' | 'assistant';
    tags?: string[];
  }): SourcePassage | null => {
    if (!activeProject) return null;

    try {
      const { project: updatedProject, passage } = bookProjectService.addPassage(
        activeProject,
        passageData
      );

      setActiveProjectState(updatedProject);
      setProjects(prev =>
        prev.map(p => p.id === updatedProject.id ? updatedProject : p)
      );
      setLastSaved(new Date());
      return passage;
    } catch (e) {
      console.error('Failed to add passage:', e);
      return null;
    }
  }, [activeProject]);

  const updatePassage = useCallback((
    passageId: string,
    updates: Partial<SourcePassage>
  ) => {
    if (!activeProject) return;

    try {
      const { project: updatedProject } = bookProjectService.updatePassage(
        activeProject,
        passageId,
        updates
      );

      setActiveProjectState(updatedProject);
      setProjects(prev =>
        prev.map(p => p.id === updatedProject.id ? updatedProject : p)
      );
      setLastSaved(new Date());
    } catch (e) {
      console.error('Failed to update passage:', e);
    }
  }, [activeProject]);

  const getPassages = useCallback((): SourcePassage[] => {
    if (!activeProject) return [];
    return bookProjectService.getPassages(activeProject);
  }, [activeProject]);

  const deletePassage = useCallback((passageId: string) => {
    if (!activeProject) return;

    try {
      const updatedProject = bookProjectService.deletePassage(
        activeProject,
        passageId
      );

      setActiveProjectState(updatedProject);
      setProjects(prev =>
        prev.map(p => p.id === updatedProject.id ? updatedProject : p)
      );
      setLastSaved(new Date());
    } catch (e) {
      console.error('Failed to delete passage:', e);
    }
  }, [activeProject]);

  // ─────────────────────────────────────────────────────────────────
  // RENDERING
  // ─────────────────────────────────────────────────────────────────

  const renderBook = useCallback((): string => {
    if (!activeProject) return '';
    return bookProjectService.renderBook(activeProject);
  }, [activeProject]);

  // ─────────────────────────────────────────────────────────────────
  // PERSISTENCE
  // ─────────────────────────────────────────────────────────────────

  const save = useCallback(() => {
    if (!activeProject) return;

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounced save
    saveTimeoutRef.current = setTimeout(() => {
      setIsSaving(true);
      try {
        bookProjectService.save(activeProject);
        setIsDirty(false);
        setLastSaved(new Date());
      } catch (e) {
        console.error('Failed to save project:', e);
      } finally {
        setIsSaving(false);
      }
    }, AUTO_SAVE_DELAY);
  }, [activeProject]);

  const forceSave = useCallback(() => {
    if (!activeProject) return;

    // Clear any pending debounced save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    setIsSaving(true);
    try {
      bookProjectService.save(activeProject);
      setIsDirty(false);
      setLastSaved(new Date());
    } catch (e) {
      console.error('Failed to save project:', e);
    } finally {
      setIsSaving(false);
    }
  }, [activeProject]);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // CONTEXT VALUE
  // ─────────────────────────────────────────────────────────────────

  const value: BookContextType = {
    // State
    projects,
    activeProject,
    isDirty,
    isSaving,
    lastSaved,

    // Project management
    loadProjects,
    loadProject,
    setActiveProject,
    createProject,
    deleteProject,

    // Chapter operations
    updateChapter,
    createChapter,
    deleteChapter,

    // Version operations
    revertToVersion,
    getChapter,

    // Passage operations
    addPassage,
    updatePassage,
    getPassages,
    deletePassage,

    // Rendering
    renderBook,

    // Persistence
    save,
    forceSave,
  };

  return (
    <BookContext.Provider value={value}>
      {children}
    </BookContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════

export function useBook(): BookContextType {
  const context = useContext(BookContext);
  if (!context) {
    throw new Error('useBook must be used within a BookProvider');
  }
  return context;
}

// Optional hook for components that may be outside book context
export function useBookOptional(): BookContextType | null {
  return useContext(BookContext);
}
