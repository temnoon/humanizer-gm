/**
 * JobHistoryList - Shows completed, failed, and cancelled jobs
 *
 * Features:
 * - Compact list view
 * - Status indicators (success/failed/cancelled)
 * - Time since completion
 * - Delete button for cleanup
 * - Expandable details
 */

import { useState } from 'react';
import type { QueueJob } from '../../lib/queue';

interface JobHistoryListProps {
  jobs: QueueJob[];
  onDelete: (jobId: string) => void;
}

const JOB_TYPE_LABELS: Record<string, string> = {
  'image-analysis': 'Image Analysis',
  'image-embedding': 'Image Embedding',
  'extract': 'PDF Extraction',
  'summarize': 'Audio Transcription',
  'transform': 'Batch Humanize',
  'index': 'Indexing',
  'batch-read': 'Batch Read',
};

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return '< 1s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function JobHistoryList({ jobs, onDelete }: JobHistoryListProps) {
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  const toggleExpand = (jobId: string) => {
    setExpandedJobId(prev => prev === jobId ? null : jobId);
  };

  if (jobs.length === 0) {
    return null;
  }

  return (
    <ul className="job-history-list" role="list">
      {jobs.map(job => {
        const isExpanded = expandedJobId === job.id;
        const statusIcon = job.status === 'completed' ? '✓' : job.status === 'failed' ? '✗' : '○';
        const duration = job.completedAt && job.startedAt
          ? job.completedAt - job.startedAt
          : job.progress.elapsedMs;

        return (
          <li key={job.id} className={`job-history-list__item job-history-list__item--${job.status}`}>
            {/* Summary Row */}
            <button
              className="job-history-list__summary"
              onClick={() => toggleExpand(job.id)}
              aria-expanded={isExpanded}
              aria-controls={`job-details-${job.id}`}
            >
              <span className={`job-history-list__icon job-history-list__icon--${job.status}`}>
                {statusIcon}
              </span>
              <span className="job-history-list__type">
                {JOB_TYPE_LABELS[job.spec.type] || job.spec.type}
              </span>
              <span className="job-history-list__count">
                {job.progress.successCount}/{job.progress.total}
              </span>
              <span className="job-history-list__time">
                {formatTimeAgo(job.completedAt || job.createdAt)}
              </span>
              <span className="job-history-list__expand-icon" aria-hidden="true">
                {isExpanded ? '▾' : '▸'}
              </span>
            </button>

            {/* Expanded Details */}
            {isExpanded && (
              <div
                id={`job-details-${job.id}`}
                className="job-history-list__details"
              >
                <div className="job-history-list__detail-row">
                  <span className="job-history-list__detail-label">Duration:</span>
                  <span className="job-history-list__detail-value">
                    {formatDuration(duration)}
                  </span>
                </div>
                <div className="job-history-list__detail-row">
                  <span className="job-history-list__detail-label">Success:</span>
                  <span className="job-history-list__detail-value job-history-list__detail-value--success">
                    {job.progress.successCount}
                  </span>
                </div>
                {job.progress.errorCount > 0 && (
                  <div className="job-history-list__detail-row">
                    <span className="job-history-list__detail-label">Errors:</span>
                    <span className="job-history-list__detail-value job-history-list__detail-value--error">
                      {job.progress.errorCount}
                    </span>
                  </div>
                )}
                {job.error && (
                  <div className="job-history-list__detail-row job-history-list__detail-row--error">
                    <span className="job-history-list__detail-label">Error:</span>
                    <span className="job-history-list__detail-value">{job.error}</span>
                  </div>
                )}

                {/* Show failed files */}
                {job.results.filter(r => !r.success).length > 0 && (
                  <div className="job-history-list__failures">
                    <span className="job-history-list__detail-label">Failed files:</span>
                    <ul className="job-history-list__failure-list">
                      {job.results
                        .filter(r => !r.success)
                        .slice(0, 5)
                        .map((r, i) => (
                          <li key={i} className="job-history-list__failure-item">
                            <span className="job-history-list__failure-file">
                              {r.filePath.split('/').pop()}
                            </span>
                            {r.error && (
                              <span className="job-history-list__failure-error">
                                {r.error}
                              </span>
                            )}
                          </li>
                        ))}
                      {job.results.filter(r => !r.success).length > 5 && (
                        <li className="job-history-list__failure-more">
                          +{job.results.filter(r => !r.success).length - 5} more
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                {/* Actions */}
                <div className="job-history-list__actions">
                  <button
                    className="job-history-list__delete-btn"
                    onClick={() => onDelete(job.id)}
                    aria-label={`Delete ${JOB_TYPE_LABELS[job.spec.type] || job.spec.type} job from history`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
