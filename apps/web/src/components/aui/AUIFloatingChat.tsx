/**
 * AUI Floating Chat Component
 *
 * A draggable floating chat bubble for the AUI (Agentic User Interface) assistant.
 * Features:
 * - Draggable positioning
 * - Minimize/expand toggle
 * - LLM-powered responses via Ollama or cloud API
 * - Tool execution with teaching feedback
 * - Fallback static responses when backend unavailable
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useBookshelf, type SourcePassage } from '../../lib/bookshelf';
import { executeAllTools, AUI_BOOK_SYSTEM_PROMPT, type AUIContext, type WorkspaceState } from '../../lib/aui';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const AUI_SYSTEM_PROMPT = `You are AUI, the AI assistant for humanizer.com Studio.

Your role is to help users understand and use the Studio interface effectively.

Key features of the Studio:
- **Archive Panel** (left): Browse 1,800+ ChatGPT conversations, search by title, filter by media
- **Workspace** (center): View and edit imported content, with LaTeX rendering
- **Tools Panel** (right): Transform content with Humanize, Persona, Style, and analysis tools
- **Navigation**: When viewing a conversation message, use ⇤←→⇥ to navigate between messages
- **Books Tab**: Create and manage book projects with chapters and version control

Quick tips:
- Hover left edge or click "Archive" to browse conversations
- Hover right edge or click "Tools" to access transformation tools
- Use the search bar to find conversations by title
- "Hide empty" filter removes conversations with no messages
- Settings tab lets you show/hide tools you don't use

Be concise and helpful. Use markdown formatting.

${AUI_BOOK_SYSTEM_PROMPT}`;

export interface AUIFloatingChatProps {
  workspace?: WorkspaceState;
}

export function AUIFloatingChat({ workspace }: AUIFloatingChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Hi! I\'m AUI, your Studio assistant. I can help you navigate the interface and manage your book projects. How can I help?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // Bookshelf context for tool execution (BookContext deprecated)
  const bookshelf = useBookshelf();

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle drag start
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (!chatRef.current) return;
    e.preventDefault();

    const rect = chatRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setIsDragging(true);
  }, []);

  // Handle drag
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;

      // Keep within viewport bounds
      const maxX = window.innerWidth - 360; // 360 = chat width
      const maxY = window.innerHeight - (isMinimized ? 48 : 500); // height depends on state

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, dragOffset, isMinimized]);

  // Reset position when closed
  useEffect(() => {
    if (!isOpen) {
      setPosition({ x: 0, y: 0 });
      setIsMinimized(false);
    }
  }, [isOpen]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      // Try local Ollama first, then fall back to cloud API
      const apiUrl = import.meta.env.VITE_CHAT_API_URL || 'http://localhost:11434/api/chat';
      const isOllama = apiUrl.includes('11434');

      // Create AUI context for tool execution (using bookshelf simple methods)
      const auiContext: AUIContext = {
        activeProject: bookshelf.activeBook,
        updateChapter: (chapterId, content, changes) => {
          void bookshelf.updateChapterSimple(chapterId, content, changes);
        },
        createChapter: (title, content) => {
          void bookshelf.createChapterSimple(title, content);
          // Return placeholder for sync interface - actual chapter created async
          return {
            id: `ch-${Date.now()}`,
            number: 1,
            title,
            content: content || `# ${title}\n\n`,
            wordCount: 0,
            version: 1,
            versions: [],
            status: 'outline' as const,
            sections: [],
            marginalia: [],
            metadata: { lastEditedBy: 'aui' as const, lastEditedAt: Date.now(), notes: [], auiSuggestions: [] },
            passageRefs: [],
          };
        },
        deleteChapter: (chapterId) => {
          void bookshelf.deleteChapterSimple(chapterId);
        },
        renderBook: () => bookshelf.renderActiveBook(),
        getChapter: (chapterId) => bookshelf.getChapterSimple(chapterId) || null,
        // Passage operations
        addPassage: (passage) => {
          void bookshelf.addPassageSimple(passage);
          return { id: `p-${Date.now()}`, text: passage.content, wordCount: passage.content.split(/\s+/).length } as SourcePassage;
        },
        updatePassage: (passageId, updates) => {
          void bookshelf.updatePassageSimple(passageId, updates);
        },
        getPassages: () => bookshelf.getPassagesSimple(),
        // Workspace state for context-aware tools
        workspace,
      };

      let assistantContent: string;

      if (isOllama) {
        // Ollama API format
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama3.2',
            messages: [
              { role: 'system', content: AUI_SYSTEM_PROMPT },
              ...messages.map(m => ({ role: m.role, content: m.content })),
              { role: 'user', content: userMessage }
            ],
            stream: false,
          }),
        });

        if (!response.ok) throw new Error('Ollama not available');
        const data = await response.json();
        assistantContent = data.message?.content || 'Sorry, I couldn\'t process that.';
      } else {
        // Cloud API format
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: AUI_SYSTEM_PROMPT },
              ...messages.map(m => ({ role: m.role, content: m.content })),
              { role: 'user', content: userMessage }
            ],
          }),
        });

        if (!response.ok) throw new Error('Chat API not available');
        const data = await response.json();
        assistantContent = data.response || 'Sorry, I couldn\'t process that.';
      }

      // Display the response
      setMessages(prev => [...prev, { role: 'assistant', content: assistantContent }]);

      // Execute any tools found in the response
      const { results, hasTools } = await executeAllTools(assistantContent, auiContext);

      if (hasTools && results.length > 0) {
        // Add tool execution results with teaching info to the chat
        const toolResults = results.map(r => {
          if (r.success) {
            let result = `✓ ${r.message || 'Action completed'}`;

            // Add teaching information if available (Teach By Doing pattern)
            if (r.teaching) {
              result += `\n\n📖 **What happened:** ${r.teaching.whatHappened}`;

              if (r.teaching.guiPath && r.teaching.guiPath.length > 0) {
                result += `\n\n**To do this yourself:**\n${r.teaching.guiPath.map((step, i) => `${i + 1}. ${step}`).join('\n')}`;
              }

              if (r.teaching.shortcut) {
                result += `\n\n⌨️ **Shortcut:** ${r.teaching.shortcut}`;
              }

              if (r.teaching.why) {
                result += `\n\n💡 **Why:** ${r.teaching.why}`;
              }
            }

            return result;
          } else {
            return `✗ ${r.error || 'Action failed'}`;
          }
        }).join('\n\n---\n\n');

        setMessages(prev => [...prev, { role: 'assistant', content: `**Tool Results:**\n\n${toolResults}` }]);
      }
    } catch (err) {
      // Fallback to static responses
      const fallbackResponses: Record<string, string> = {
        'archive': 'The **Archive panel** is on the left side. Hover over the left edge or click "Archive" in the top bar to open it. You can search conversations by title and filter by media type.',
        'tools': 'The **Tools panel** is on the right side. Hover over the right edge or click "Tools ⚙" to open it. You\'ll find transformation tools like Humanize, Persona, and Style.',
        'navigate': 'When viewing a message from a conversation, use the navigation bar: **⇤** (first), **←** (previous), **→** (next), **⇥** (last) to move through messages.',
        'search': 'Use the **search bar** at the top of the Archive panel to filter conversations by title. The search works across all 1,800+ conversations.',
        'filter': 'Use the **filter dropdowns** to sort by message count, length, or date. The "Hide empty" checkbox filters out conversations with no messages.',
      };

      const lowerInput = userMessage.toLowerCase();
      let response = 'I\'m having trouble connecting to my backend. Here\'s what I can tell you:\n\n';

      if (lowerInput.includes('archive') || lowerInput.includes('conversation')) {
        response += fallbackResponses['archive'];
      } else if (lowerInput.includes('tool')) {
        response += fallbackResponses['tools'];
      } else if (lowerInput.includes('navigate') || lowerInput.includes('arrow') || lowerInput.includes('message')) {
        response += fallbackResponses['navigate'];
      } else if (lowerInput.includes('search') || lowerInput.includes('find')) {
        response += fallbackResponses['search'];
      } else if (lowerInput.includes('filter') || lowerInput.includes('sort')) {
        response += fallbackResponses['filter'];
      } else {
        response = 'I can help you with:\n- **Archive**: Browse and search conversations\n- **Tools**: Transform content\n- **Navigation**: Move between messages\n- **Filters**: Sort and filter the archive\n\nWhat would you like to know more about?';
      }

      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Compute style for positioning
  const chatStyle: React.CSSProperties = position.x !== 0 || position.y !== 0
    ? {
        position: 'fixed',
        left: position.x,
        top: position.y,
        right: 'auto',
        bottom: 'auto',
      }
    : {};

  return (
    <>
      {/* Chat Panel */}
      {isOpen && (
        <div
          ref={chatRef}
          className={`aui-chat ${isMinimized ? 'aui-chat--minimized' : ''} ${isDragging ? 'aui-chat--dragging' : ''}`}
          style={chatStyle}
        >
          <div
            className="aui-chat__header"
            onMouseDown={handleDragStart}
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          >
            <span className="aui-chat__title">AUI Assistant</span>
            <div className="aui-chat__header-actions">
              <button
                className="aui-chat__minimize"
                onClick={() => setIsMinimized(!isMinimized)}
                title={isMinimized ? 'Expand' : 'Minimize'}
              >
                {isMinimized ? '□' : '−'}
              </button>
              <button className="aui-chat__close" onClick={() => setIsOpen(false)}>×</button>
            </div>
          </div>
          {!isMinimized && (
            <>
              <div className="aui-chat__messages">
                {messages.map((msg, i) => (
                  <div key={i} className={`aui-chat__message aui-chat__message--${msg.role}`}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ))}
                {loading && (
                  <div className="aui-chat__message aui-chat__message--assistant aui-chat__message--loading">
                    <span>···</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="aui-chat__input-area">
                <input
                  type="text"
                  className="aui-chat__input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about the Studio..."
                  disabled={loading}
                />
                <button
                  className="aui-chat__send"
                  onClick={sendMessage}
                  disabled={!input.trim() || loading}
                >
                  →
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Floating Chat Button */}
      <button
        className={`aui-fab ${isOpen ? 'aui-fab--open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="AUI Assistant"
      >
        {isOpen ? '×' : '?'}
      </button>
    </>
  );
}
