/**
 * BatchJobForm - Form for submitting batch processing jobs
 *
 * Features:
 * - File selection (folder or multiple files)
 * - Job type selection
 * - Model selection for AI jobs
 * - Concurrency configuration
 * - WCAG accessible with proper labels
 */

import { useState, useRef, useId } from 'react';
import { useQueue, type QueueJobType, type QueueFileItem } from '../../lib/queue';

interface BatchJobFormProps {
  onJobCreated?: () => void;
}

const JOB_TYPES: Array<{ value: QueueJobType; label: string; description: string }> = [
  { value: 'image-analysis', label: 'Image Analysis', description: 'Analyze images with vision AI' },
  { value: 'image-embedding', label: 'Image Embedding', description: 'Generate embeddings for similarity search' },
  { value: 'extract', label: 'PDF Extraction', description: 'Extract text from PDF files' },
  { value: 'summarize', label: 'Audio Transcription', description: 'Transcribe audio with Whisper' },
  { value: 'transform', label: 'Batch Humanize', description: 'Humanize multiple text files' },
];

const VISION_MODELS = [
  { value: 'llava:13b', label: 'LLaVA 13B (Recommended)' },
  { value: 'llava:7b', label: 'LLaVA 7B (Faster)' },
  { value: 'bakllava', label: 'BakLLaVA (Experimental)' },
];

export function BatchJobForm({ onJobCreated }: BatchJobFormProps) {
  const { createJob, isAvailable } = useQueue();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate unique IDs for accessibility
  const formId = useId();
  const typeId = `${formId}-type`;
  const modelId = `${formId}-model`;
  const concurrencyId = `${formId}-concurrency`;
  const filesId = `${formId}-files`;

  const [jobType, setJobType] = useState<QueueJobType>('image-analysis');
  const [model, setModel] = useState('llava:13b');
  const [concurrency, setConcurrency] = useState(2);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Determine accepted file types based on job type
  const getAcceptedTypes = () => {
    switch (jobType) {
      case 'image-analysis':
      case 'image-embedding':
        return 'image/*';
      case 'extract':
        return '.pdf';
      case 'summarize':
        return 'audio/*,.mp3,.wav,.m4a,.ogg,.flac';
      case 'transform':
        return '.txt,.md,.html';
      default:
        return '*/*';
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(files);
    setError(null);
    setSuccess(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    setSelectedFiles(files);
    setError(null);
    setSuccess(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (selectedFiles.length === 0) {
      setError('Please select at least one file');
      return;
    }

    setIsSubmitting(true);

    try {
      // Convert File objects to QueueFileItem
      // Note: In Electron, we have access to file.path
      const fileItems: QueueFileItem[] = selectedFiles.map(file => ({
        path: (file as File & { path?: string }).path || file.name,
        size: file.size,
        id: crypto.randomUUID(),
      }));

      const result = await createJob({
        type: jobType,
        files: fileItems,
        options: {
          model: jobType === 'image-analysis' ? model : undefined,
        },
        concurrency,
      });

      if (result.success) {
        setSuccess(`Job created: ${result.jobId}`);
        setSelectedFiles([]);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        onJobCreated?.();
      } else {
        setError(result.error || 'Failed to create job');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const clearFiles = () => {
    setSelectedFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setError(null);
    setSuccess(null);
  };

  // Calculate total size
  const totalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!isAvailable) return null;

  return (
    <form className="batch-job-form" onSubmit={handleSubmit}>
      <h3 className="batch-job-form__title">New Batch Job</h3>

      {/* Job Type */}
      <div className="batch-job-form__field">
        <label htmlFor={typeId} className="batch-job-form__label">
          Job Type
        </label>
        <select
          id={typeId}
          className="batch-job-form__select"
          value={jobType}
          onChange={(e) => setJobType(e.target.value as QueueJobType)}
        >
          {JOB_TYPES.map(type => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
        <p className="batch-job-form__hint" id={`${typeId}-desc`}>
          {JOB_TYPES.find(t => t.value === jobType)?.description}
        </p>
      </div>

      {/* Model Selection (for image analysis) */}
      {jobType === 'image-analysis' && (
        <div className="batch-job-form__field">
          <label htmlFor={modelId} className="batch-job-form__label">
            Vision Model
          </label>
          <select
            id={modelId}
            className="batch-job-form__select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {VISION_MODELS.map(m => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Concurrency */}
      <div className="batch-job-form__field">
        <label htmlFor={concurrencyId} className="batch-job-form__label">
          Concurrency
        </label>
        <div className="batch-job-form__range-wrapper">
          <input
            type="range"
            id={concurrencyId}
            className="batch-job-form__range"
            min="1"
            max="8"
            value={concurrency}
            onChange={(e) => setConcurrency(parseInt(e.target.value))}
            aria-describedby={`${concurrencyId}-value`}
          />
          <span id={`${concurrencyId}-value`} className="batch-job-form__range-value">
            {concurrency} worker{concurrency > 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* File Selection */}
      <div className="batch-job-form__field">
        <label htmlFor={filesId} className="batch-job-form__label">
          Files
        </label>
        <div
          className="batch-job-form__dropzone"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <input
            ref={fileInputRef}
            type="file"
            id={filesId}
            className="batch-job-form__file-input"
            accept={getAcceptedTypes()}
            multiple
            onChange={handleFileSelect}
            aria-describedby={`${filesId}-status`}
          />
          <label htmlFor={filesId} className="batch-job-form__dropzone-label">
            {selectedFiles.length === 0 ? (
              <>
                <span className="batch-job-form__dropzone-icon">+</span>
                <span>Click or drag files here</span>
              </>
            ) : (
              <span id={`${filesId}-status`}>
                {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected ({formatSize(totalSize)})
              </span>
            )}
          </label>
        </div>
        {selectedFiles.length > 0 && (
          <button
            type="button"
            className="batch-job-form__clear-btn"
            onClick={clearFiles}
          >
            Clear selection
          </button>
        )}
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="batch-job-form__message batch-job-form__message--error" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="batch-job-form__message batch-job-form__message--success" role="status">
          {success}
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        className="batch-job-form__submit"
        disabled={isSubmitting || selectedFiles.length === 0}
      >
        {isSubmitting ? 'Creating Job...' : 'Start Batch Job'}
      </button>
    </form>
  );
}
