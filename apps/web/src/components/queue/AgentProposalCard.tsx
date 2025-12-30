/**
 * Agent Proposal Card
 *
 * Displays pending proposals from House Agents that require user approval.
 * Allows approve/reject actions directly from the Queue UI.
 */

import { useState, useEffect, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface AgentProposal {
  id: string;
  agentId: string;
  agentName: string;
  actionType: string;
  title: string;
  description?: string;
  payload?: unknown;
  urgency: 'low' | 'normal' | 'high' | 'critical';
  projectId?: string;
  createdAt: number;
  expiresAt?: number;
  status: string;
}

interface AgentAPI {
  getPendingProposals: (projectId?: string) => Promise<AgentProposal[]>;
  approveProposal: (proposalId: string) => Promise<{ success: boolean; error?: string }>;
  rejectProposal: (proposalId: string, reason?: string) => Promise<{ success: boolean; error?: string }>;
}

// Get agent API from window (exposed by Electron preload)
function getAgentAPI(): AgentAPI | null {
  const win = window as unknown as { electron?: { agents?: AgentAPI } };
  return win.electron?.agents || null;
}

// ═══════════════════════════════════════════════════════════════════
// URGENCY STYLES
// ═══════════════════════════════════════════════════════════════════

const URGENCY_STYLES: Record<string, { icon: string; label: string }> = {
  low: { icon: '○', label: 'Low' },
  normal: { icon: '●', label: 'Normal' },
  high: { icon: '◆', label: 'High' },
  critical: { icon: '!', label: 'Critical' },
};

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════

export function AgentProposalCard() {
  const [proposals, setProposals] = useState<AgentProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Load proposals
  const loadProposals = useCallback(async () => {
    // Check if electron API is available
    const api = getAgentAPI();
    if (!api) {
      setLoading(false);
      return;
    }

    try {
      const result = await api.getPendingProposals();
      setProposals(result || []);
    } catch (err) {
      console.error('[AgentProposalCard] Failed to load proposals:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount and set up refresh interval
  useEffect(() => {
    loadProposals();
    const interval = setInterval(loadProposals, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, [loadProposals]);

  // Handle approve
  const handleApprove = async (proposalId: string) => {
    const api = getAgentAPI();
    if (!api) return;

    setProcessingId(proposalId);
    try {
      const result = await api.approveProposal(proposalId);
      if (result.success) {
        // Remove from local state
        setProposals(prev => prev.filter(p => p.id !== proposalId));
      } else {
        console.error('[AgentProposalCard] Approve failed:', result.error);
      }
    } catch (err) {
      console.error('[AgentProposalCard] Approve error:', err);
    } finally {
      setProcessingId(null);
    }
  };

  // Handle reject
  const handleReject = async (proposalId: string) => {
    const api = getAgentAPI();
    if (!api) return;

    setProcessingId(proposalId);
    try {
      const result = await api.rejectProposal(proposalId);
      if (result.success) {
        // Remove from local state
        setProposals(prev => prev.filter(p => p.id !== proposalId));
      } else {
        console.error('[AgentProposalCard] Reject failed:', result.error);
      }
    } catch (err) {
      console.error('[AgentProposalCard] Reject error:', err);
    } finally {
      setProcessingId(null);
    }
  };

  // Toggle expanded state
  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Format time ago
  const formatTimeAgo = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  // If no API available, show notice
  if (!getAgentAPI()) {
    return null; // Hide if not in Electron
  }

  // Loading state
  if (loading) {
    return (
      <section className="queue-proposals" aria-labelledby="proposals-heading">
        <h3 id="proposals-heading" className="queue-proposals__title">
          Agent Proposals
        </h3>
        <div className="queue-proposals__loading">Loading...</div>
      </section>
    );
  }

  // No proposals
  if (proposals.length === 0) {
    return (
      <section className="queue-proposals" aria-labelledby="proposals-heading">
        <h3 id="proposals-heading" className="queue-proposals__title">
          Agent Proposals
        </h3>
        <div className="queue-proposals__empty">
          No pending proposals from agents
        </div>
      </section>
    );
  }

  return (
    <section className="queue-proposals" aria-labelledby="proposals-heading">
      <h3 id="proposals-heading" className="queue-proposals__title">
        Agent Proposals
        <span className="queue-proposals__count">{proposals.length}</span>
      </h3>

      <ul className="queue-proposals__list" role="list">
        {proposals.map(proposal => {
          const urgency = URGENCY_STYLES[proposal.urgency] || URGENCY_STYLES.normal;
          const isExpanded = expanded.has(proposal.id);
          const isProcessing = processingId === proposal.id;

          return (
            <li
              key={proposal.id}
              className={`queue-proposal ${isProcessing ? 'queue-proposal--processing' : ''}`}
              data-urgency={proposal.urgency}
            >
              <div className="queue-proposal__header">
                <span
                  className="queue-proposal__urgency"
                  title={`${urgency.label} urgency`}
                  aria-label={`${urgency.label} urgency`}
                >
                  {urgency.icon}
                </span>

                <div className="queue-proposal__info">
                  <button
                    className="queue-proposal__title-btn"
                    onClick={() => toggleExpanded(proposal.id)}
                    aria-expanded={isExpanded}
                    aria-controls={`proposal-details-${proposal.id}`}
                  >
                    {proposal.title}
                    <span className="queue-proposal__expand-icon">
                      {isExpanded ? '−' : '+'}
                    </span>
                  </button>
                  <div className="queue-proposal__meta">
                    <span className="queue-proposal__agent">{proposal.agentName}</span>
                    <span className="queue-proposal__time">{formatTimeAgo(proposal.createdAt)}</span>
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div
                  id={`proposal-details-${proposal.id}`}
                  className="queue-proposal__details"
                >
                  {proposal.description && (
                    <p className="queue-proposal__description">{proposal.description}</p>
                  )}
                  {proposal.actionType && (
                    <div className="queue-proposal__action-type">
                      Action: <code>{proposal.actionType}</code>
                    </div>
                  )}
                  {proposal.projectId && (
                    <div className="queue-proposal__project">
                      Project: {proposal.projectId}
                    </div>
                  )}
                </div>
              )}

              <div className="queue-proposal__actions">
                <button
                  className="queue-proposal__btn queue-proposal__btn--approve"
                  onClick={() => handleApprove(proposal.id)}
                  disabled={isProcessing}
                  aria-label={`Approve proposal: ${proposal.title}`}
                >
                  {isProcessing ? '...' : 'Approve'}
                </button>
                <button
                  className="queue-proposal__btn queue-proposal__btn--reject"
                  onClick={() => handleReject(proposal.id)}
                  disabled={isProcessing}
                  aria-label={`Reject proposal: ${proposal.title}`}
                >
                  {isProcessing ? '...' : 'Reject'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
