/**
 * JobProgressCard - Displays progress for an active queue job
 *
 * Features:
 * - Progress bar with percentage
 * - Current file being processed
 * - Time elapsed and estimated remaining
 * - Success/error counts
 * - Cancel button
 * - ARIA live region for screen readers
 */

import { useId } from 'react';
import type { QueueJob } from '../../lib/queue';

interface JobProgressCardProps {
  job: QueueJob;
  onCancel: () => void;
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

const STATUS_LABELS: Record<string, string> = {
  'pending': 'Waiting',
  'processing': 'Processing',
  'paused': 'Paused',
  'completed': 'Completed',
  'failed': 'Failed',
  'cancelled': 'Cancelled',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return '< 1s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function JobProgressCard({ job, onCancel }: JobProgressCardProps) {
  const progressId = useId();
  const { progress, spec, status } = job;

  const isActive = status === 'processing' || status === 'pending' || status === 'paused';
  const isPaused = status === 'paused';
  const isPending = status === 'pending';

  return (
    <div
      className={`job-progress-card job-progress-card--${status}`}
      role="region"
      aria-labelledby={`${progressId}-title`}
    >
      {/* Header */}
      <div className="job-progress-card__header">
        <h4 id={`${progressId}-title`} className="job-progress-card__title">
          {JOB_TYPE_LABELS[spec.type] || spec.type}
        </h4>
        <span className={`job-progress-card__status job-progress-card__status--${status}`}>
          {STATUS_LABELS[status] || status}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="job-progress-card__progress-wrapper">
        <div
          className="job-progress-card__progress-bar"
          role="progressbar"
          aria-valuenow={progress.percentComplete}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${progress.percentComplete}% complete`}
        >
          <div
            className="job-progress-card__progress-fill"
            style={{ width: `${progress.percentComplete}%` }}
          />
        </div>
        <span className="job-progress-card__progress-text" aria-live="polite">
          {progress.processed}/{progress.total} ({progress.percentComplete}%)
        </span>
      </div>

      {/* Current File */}
      {progress.currentFile && status === 'processing' && (
        <div className="job-progress-card__current-file">
          <span className="job-progress-card__label">Processing:</span>
          <span className="job-progress-card__value" title={progress.currentFile}>
            {progress.currentFile.split('/').pop()}
          </span>
        </div>
      )}

      {/* Stats Row */}
      <div className="job-progress-card__stats">
        <div className="job-progress-card__stat">
          <span className="job-progress-card__stat-label">Elapsed:</span>
          <span className="job-progress-card__stat-value">
            {formatDuration(progress.elapsedMs)}
          </span>
        </div>
        {progress.estimatedRemainingMs > 0 && status === 'processing' && (
          <div className="job-progress-card__stat">
            <span className="job-progress-card__stat-label">Remaining:</span>
            <span className="job-progress-card__stat-value">
              ~{formatDuration(progress.estimatedRemainingMs)}
            </span>
          </div>
        )}
        <div className="job-progress-card__stat job-progress-card__stat--success">
          <span className="job-progress-card__stat-label">Success:</span>
          <span className="job-progress-card__stat-value">{progress.successCount}</span>
        </div>
        {progress.errorCount > 0 && (
          <div className="job-progress-card__stat job-progress-card__stat--error">
            <span className="job-progress-card__stat-label">Errors:</span>
            <span className="job-progress-card__stat-value">{progress.errorCount}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      {isActive && (
        <div className="job-progress-card__actions">
          <button
            className="job-progress-card__cancel-btn"
            onClick={onCancel}
            aria-label={`Cancel ${JOB_TYPE_LABELS[spec.type] || spec.type} job`}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Pending/Paused message */}
      {isPending && (
        <p className="job-progress-card__pending-msg">
          Waiting for available worker...
        </p>
      )}
      {isPaused && (
        <p className="job-progress-card__paused-msg">
          Queue is paused. Resume to continue processing.
        </p>
      )}
    </div>
  );
}
