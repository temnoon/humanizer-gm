/**
 * UserDropdown - User menu with settings and sign out
 *
 * Features:
 * - Click to toggle dropdown menu
 * - Theme settings access
 * - Admin config access (admin users only)
 * - Sign out functionality
 *
 * Extracted from Studio.tsx during modularization
 */

import { useState, useEffect, useRef } from 'react';
import { ThemeSettingsModal } from '../theme/ThemeSettingsModal';
import { AdminConfigPanel } from '../admin';

export interface UserDropdownProps {
  user: { email?: string; name?: string; role?: string } | null;
  onSignOut: () => void;
}

export function UserDropdown({ user, onSignOut }: UserDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdminConfig, setShowAdminConfig] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isAdmin = user?.role === 'admin';

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const displayName = user?.name || user?.email?.split('@')[0] || 'User';

  return (
    <div className="user-dropdown" ref={dropdownRef}>
      <button
        className="studio-topbar__btn studio-topbar__btn--user"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {displayName}
      </button>

      {isOpen && (
        <div className="user-dropdown__menu" role="menu">
          <div className="user-dropdown__header">
            <span className="user-dropdown__email">{user?.email || 'User'}</span>
          </div>
          <button
            className="user-dropdown__item"
            onClick={() => {
              setShowSettings(true);
              setIsOpen(false);
            }}
            role="menuitem"
          >
            Settings
          </button>
          {isAdmin && (
            <button
              className="user-dropdown__item user-dropdown__item--admin"
              onClick={() => {
                setShowAdminConfig(true);
                setIsOpen(false);
              }}
              role="menuitem"
            >
              Admin Config
            </button>
          )}
          <button
            className="user-dropdown__item user-dropdown__item--danger"
            onClick={() => {
              onSignOut();
              setIsOpen(false);
            }}
            role="menuitem"
          >
            Sign Out
          </button>
        </div>
      )}

      {showSettings && (
        <ThemeSettingsModal onClose={() => setShowSettings(false)} />
      )}

      {showAdminConfig && (
        <AdminConfigPanel onClose={() => setShowAdminConfig(false)} />
      )}
    </div>
  );
}
