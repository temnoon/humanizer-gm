/**
 * Theme Settings Modal - Configure appearance
 */

import { createPortal } from 'react-dom';
import { useTheme } from '../../lib/theme/ThemeContext';
import type { ThemeMode, ThemeSettings } from '../../lib/theme';

interface ThemeSettingsModalProps {
  onClose: () => void;
}

export function ThemeSettingsModal({ onClose }: ThemeSettingsModalProps) {
  const { settings, setMode, setFontFamily, setFontSize, setLineHeight, setColorAccent, setEditorWidth } = useTheme();

  const themeOptions: { mode: ThemeMode; icon: string; label: string }[] = [
    { mode: 'system', icon: '🖥', label: 'System' },
    { mode: 'sepia', icon: '📜', label: 'Sepia' },
    { mode: 'light', icon: '☀️', label: 'Light' },
    { mode: 'dark', icon: '🌙', label: 'Dark' },
  ];

  const fontOptions: { family: ThemeSettings['fontFamily']; icon: string; label: string }[] = [
    { family: 'serif', icon: 'Aa', label: 'Serif' },
    { family: 'sans-serif', icon: 'Aa', label: 'Sans' },
    { family: 'mono', icon: '</>', label: 'Mono' },
  ];

  const sizeOptions: { size: ThemeSettings['fontSize']; icon: string; label: string }[] = [
    { size: 'small', icon: 'A', label: 'Small' },
    { size: 'medium', icon: 'A', label: 'Medium' },
    { size: 'large', icon: 'A', label: 'Large' },
  ];

  const spacingOptions: { height: ThemeSettings['lineHeight']; icon: string; label: string }[] = [
    { height: 'tight', icon: '≡', label: 'Tight' },
    { height: 'normal', icon: '☰', label: 'Normal' },
    { height: 'relaxed', icon: '⋮', label: 'Relaxed' },
  ];

  const colorOptions: { accent: ThemeSettings['colorAccent']; label: string }[] = [
    { accent: 'amber', label: 'Amber' },
    { accent: 'blue', label: 'Blue' },
    { accent: 'green', label: 'Green' },
    { accent: 'purple', label: 'Purple' },
  ];

  const widthOptions: { width: ThemeSettings['editorWidth']; icon: string; label: string }[] = [
    { width: 'narrow', icon: '⊏⊐', label: 'Narrow' },
    { width: 'medium', icon: '⊏ ⊐', label: 'Medium' },
    { width: 'wide', icon: '⊏  ⊐', label: 'Wide' },
  ];

  const modalContent = (
    <div
      className="theme-modal"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="theme-modal-title"
    >
      <div className="theme-modal__content" onClick={e => e.stopPropagation()}>
        <div className="theme-modal__header">
          <h2 id="theme-modal-title" className="theme-modal__title">Appearance</h2>
          <button
            className="theme-modal__close"
            onClick={onClose}
            aria-label="Close theme settings"
            autoFocus
          >
            ×
          </button>
        </div>

        {/* Theme Mode */}
        <div className="theme-modal__section">
          <label className="theme-modal__label">Theme</label>
          <div className="theme-modal__options">
            {themeOptions.map(opt => (
              <button
                key={opt.mode}
                className={`theme-modal__option ${settings.mode === opt.mode ? 'theme-modal__option--active' : ''}`}
                onClick={() => setMode(opt.mode)}
                aria-pressed={settings.mode === opt.mode}
                aria-label={`${opt.label} theme`}
              >
                <span className="theme-modal__option-icon" aria-hidden="true">{opt.icon}</span>
                <span className="theme-modal__option-label">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Font Family */}
        <div className="theme-modal__section">
          <label className="theme-modal__label">Font</label>
          <div className="theme-modal__options">
            {fontOptions.map(opt => (
              <button
                key={opt.family}
                className={`theme-modal__option ${settings.fontFamily === opt.family ? 'theme-modal__option--active' : ''}`}
                onClick={() => setFontFamily(opt.family)}
                style={{ fontFamily: opt.family === 'mono' ? 'monospace' : opt.family }}
                aria-pressed={settings.fontFamily === opt.family}
                aria-label={`${opt.label} font`}
              >
                <span className="theme-modal__option-icon" aria-hidden="true">{opt.icon}</span>
                <span className="theme-modal__option-label">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Font Size */}
        <div className="theme-modal__section">
          <label className="theme-modal__label">Size</label>
          <div className="theme-modal__options">
            {sizeOptions.map(opt => (
              <button
                key={opt.size}
                className={`theme-modal__option ${settings.fontSize === opt.size ? 'theme-modal__option--active' : ''}`}
                onClick={() => setFontSize(opt.size)}
                style={{ fontSize: opt.size === 'small' ? '0.8rem' : opt.size === 'large' ? '1.2rem' : '1rem' }}
                aria-pressed={settings.fontSize === opt.size}
                aria-label={`${opt.label} font size`}
              >
                <span className="theme-modal__option-icon" aria-hidden="true">{opt.icon}</span>
                <span className="theme-modal__option-label">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Line Height */}
        <div className="theme-modal__section">
          <label className="theme-modal__label">Line Spacing</label>
          <div className="theme-modal__options">
            {spacingOptions.map(opt => (
              <button
                key={opt.height}
                className={`theme-modal__option ${settings.lineHeight === opt.height ? 'theme-modal__option--active' : ''}`}
                onClick={() => setLineHeight(opt.height)}
                aria-pressed={settings.lineHeight === opt.height}
                aria-label={`${opt.label} line spacing`}
              >
                <span className="theme-modal__option-icon" aria-hidden="true">{opt.icon}</span>
                <span className="theme-modal__option-label">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Accent Color */}
        <div className="theme-modal__section">
          <label className="theme-modal__label">Accent Color</label>
          <div className="theme-modal__options theme-modal__options--4">
            {colorOptions.map(opt => (
              <button
                key={opt.accent}
                className={`theme-modal__option ${settings.colorAccent === opt.accent ? 'theme-modal__option--active' : ''}`}
                onClick={() => setColorAccent(opt.accent)}
                aria-pressed={settings.colorAccent === opt.accent}
                aria-label={`${opt.label} accent color`}
              >
                <span className={`theme-modal__swatch theme-modal__swatch--${opt.accent}`} aria-hidden="true" />
                <span className="theme-modal__option-label">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Editor Width */}
        <div className="theme-modal__section">
          <label className="theme-modal__label">Editor Width</label>
          <div className="theme-modal__options">
            {widthOptions.map(opt => (
              <button
                key={opt.width}
                className={`theme-modal__option ${settings.editorWidth === opt.width ? 'theme-modal__option--active' : ''}`}
                onClick={() => setEditorWidth(opt.width)}
                aria-pressed={settings.editorWidth === opt.width}
                aria-label={`${opt.label} editor width`}
              >
                <span className="theme-modal__option-icon" aria-hidden="true">{opt.icon}</span>
                <span className="theme-modal__option-label">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // Render at document body level to avoid stacking context issues
  return createPortal(modalContent, document.body);
}
