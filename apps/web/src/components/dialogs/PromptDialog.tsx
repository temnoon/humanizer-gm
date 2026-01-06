/**
 * PromptDialog - Simple text input dialog to replace window.prompt()
 *
 * Works in Electron where window.prompt() is not supported.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import './PromptDialog.css';

export interface PromptDialogProps {
  isOpen: boolean;
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  isOpen,
  title,
  message,
  defaultValue = '',
  placeholder = '',
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset and focus when opening
  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      // Focus after a brief delay to ensure dialog is rendered
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, defaultValue]);

  // Handle keyboard
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleConfirm();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, value, onCancel]);

  const handleConfirm = useCallback(() => {
    onConfirm(value);
  }, [value, onConfirm]);

  if (!isOpen) return null;

  return (
    <div className="prompt-dialog__overlay" onClick={onCancel}>
      <div
        className="prompt-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-dialog-title"
      >
        <header className="prompt-dialog__header">
          <h3 id="prompt-dialog-title">{title}</h3>
        </header>

        <div className="prompt-dialog__content">
          {message && <p className="prompt-dialog__message">{message}</p>}
          <input
            ref={inputRef}
            type="text"
            className="prompt-dialog__input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
          />
        </div>

        <footer className="prompt-dialog__footer">
          <button className="prompt-dialog__btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="prompt-dialog__btn prompt-dialog__btn--primary"
            onClick={handleConfirm}
          >
            OK
          </button>
        </footer>
      </div>
    </div>
  );
}

// Hook for easier usage - mimics window.prompt() async pattern
export function usePromptDialog() {
  const [state, setState] = useState<{
    isOpen: boolean;
    title: string;
    message?: string;
    defaultValue?: string;
    placeholder?: string;
    resolve?: (value: string | null) => void;
  }>({
    isOpen: false,
    title: '',
  });

  const prompt = useCallback((
    title: string,
    options?: {
      message?: string;
      defaultValue?: string;
      placeholder?: string;
    }
  ): Promise<string | null> => {
    return new Promise((resolve) => {
      setState({
        isOpen: true,
        title,
        message: options?.message,
        defaultValue: options?.defaultValue || '',
        placeholder: options?.placeholder,
        resolve,
      });
    });
  }, []);

  const handleConfirm = useCallback((value: string) => {
    state.resolve?.(value);
    setState((prev) => ({ ...prev, isOpen: false }));
  }, [state.resolve]);

  const handleCancel = useCallback(() => {
    state.resolve?.(null);
    setState((prev) => ({ ...prev, isOpen: false }));
  }, [state.resolve]);

  const dialogProps: PromptDialogProps = {
    isOpen: state.isOpen,
    title: state.title,
    message: state.message,
    defaultValue: state.defaultValue,
    placeholder: state.placeholder,
    onConfirm: handleConfirm,
    onCancel: handleCancel,
  };

  return { prompt, dialogProps, PromptDialog };
}

export default PromptDialog;
