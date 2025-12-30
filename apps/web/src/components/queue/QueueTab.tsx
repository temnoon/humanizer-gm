/**
 * QueueTab - Main container for batch queue operations
 *
 * Features:
 * - Batch job submission form
 * - Active job progress cards
 * - Job history list
 * - Queue controls (pause/resume)
 */

import { useState, useEffect } from 'react';
import { useQueue, type QueueJob } from '../../lib/queue';
import { BatchJobForm } from './BatchJobForm';
import { JobProgressCard } from './JobProgressCard';
import { JobHistoryList } from './JobHistoryList';
import { AgentProposalCard } from './AgentProposalCard';

export function QueueTab() {
  const {
    isAvailable,
    state,
    activeJobs,
    listJobs,
    cancelJob,
    deleteJob,
    pauseQueue,
    resumeQueue,
    refresh,
  } = useQueue();

  const [completedJobs, setCompletedJobs] = useState<QueueJob[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Load completed jobs on mount and when active jobs change
  useEffect(() => {
    if (!isAvailable) return;

    const loadCompletedJobs = async () => {
      const jobs = await listJobs({ status: ['completed', 'failed', 'cancelled'], limit: 20 });
      setCompletedJobs(jobs);
    };

    loadCompletedJobs();
  }, [isAvailable, activeJobs.length, listJobs]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  };

  const handlePauseResume = async () => {
    if (state?.isPaused) {
      await resumeQueue();
    } else {
      await pauseQueue();
    }
    await refresh();
  };

  const handleCancelJob = async (jobId: string) => {
    await cancelJob(jobId);
    await refresh();
  };

  const handleDeleteJob = async (jobId: string) => {
    await deleteJob(jobId);
    // Refresh completed jobs list
    const jobs = await listJobs({ status: ['completed', 'failed', 'cancelled'], limit: 20 });
    setCompletedJobs(jobs);
  };

  // Not available in browser mode
  if (!isAvailable) {
    return (
      <div className="queue-tab queue-tab--unavailable">
        <div className="queue-tab__message">
          <h3>Queue Not Available</h3>
          <p>Batch processing is only available in the desktop app.</p>
        </div>
      </div>
    );
  }

  // Separate active jobs into processing and pending
  const processingJobs = activeJobs.filter(j => j.status === 'processing');
  const pendingJobs = activeJobs.filter(j => j.status === 'pending' || j.status === 'paused');

  return (
    <div className="queue-tab">
      {/* Queue Status Bar */}
      <div className="queue-tab__status-bar">
        <div className="queue-tab__status-info">
          <span className="queue-tab__status-item">
            <span className="queue-tab__status-label">Active:</span>
            <span className="queue-tab__status-value">{state?.processingCount || 0}</span>
          </span>
          <span className="queue-tab__status-item">
            <span className="queue-tab__status-label">Pending:</span>
            <span className="queue-tab__status-value">{state?.pendingCount || 0}</span>
          </span>
          <span className="queue-tab__status-item">
            <span className="queue-tab__status-label">Workers:</span>
            <span className="queue-tab__status-value">
              {state?.activeConcurrency || 0}/{state?.maxConcurrency || 0}
            </span>
          </span>
        </div>
        <div className="queue-tab__controls">
          <button
            className="queue-tab__control-btn"
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label="Refresh queue status"
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            className={`queue-tab__control-btn ${state?.isPaused ? 'queue-tab__control-btn--resume' : ''}`}
            onClick={handlePauseResume}
            aria-label={state?.isPaused ? 'Resume queue' : 'Pause queue'}
          >
            {state?.isPaused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>

      {/* Batch Job Form */}
      <BatchJobForm onJobCreated={refresh} />

      {/* Agent Proposals */}
      <AgentProposalCard />

      {/* Active Jobs */}
      {(processingJobs.length > 0 || pendingJobs.length > 0) && (
        <section className="queue-tab__section" aria-labelledby="active-jobs-heading">
          <h3 id="active-jobs-heading" className="queue-tab__section-title">
            Active Jobs ({processingJobs.length + pendingJobs.length})
          </h3>
          <div className="queue-tab__jobs-list">
            {processingJobs.map(job => (
              <JobProgressCard
                key={job.id}
                job={job}
                onCancel={() => handleCancelJob(job.id)}
              />
            ))}
            {pendingJobs.map(job => (
              <JobProgressCard
                key={job.id}
                job={job}
                onCancel={() => handleCancelJob(job.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Job History */}
      {completedJobs.length > 0 && (
        <section className="queue-tab__section" aria-labelledby="history-heading">
          <h3 id="history-heading" className="queue-tab__section-title">
            Recent Jobs
          </h3>
          <JobHistoryList
            jobs={completedJobs}
            onDelete={handleDeleteJob}
          />
        </section>
      )}

      {/* Empty State */}
      {activeJobs.length === 0 && completedJobs.length === 0 && (
        <div className="queue-tab__empty">
          <p>No jobs yet. Create a batch job above to get started.</p>
        </div>
      )}
    </div>
  );
}
