/**
 * Facebook Advertisers View
 *
 * Displays advertisers who have targeted the user, including data brokers.
 * Extracted from FacebookView for modularization.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AdvertiserItem, AdvertiserStats } from './shared';
import { formatDate } from './shared';
import { getArchiveServerUrl } from '../../../lib/platform';

export interface FacebookAdvertisersViewProps {
  // Currently no callbacks needed, but kept for future use
}

export function FacebookAdvertisersView(_props: FacebookAdvertisersViewProps) {
  // Advertisers state
  const [advertisers, setAdvertisers] = useState<AdvertiserItem[]>([]);
  const [advertisersLoading, setAdvertisersLoading] = useState(false);
  const [advertisersOffset, setAdvertisersOffset] = useState(0);
  const [advertisersHasMore, setAdvertisersHasMore] = useState(true);
  const [advertisersSearch, setAdvertisersSearch] = useState('');
  const [advertiserStats, setAdvertiserStats] = useState<AdvertiserStats | null>(null);
  const [showDataBrokersOnly, setShowDataBrokersOnly] = useState(false);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Ref for infinite scroll
  const advertisersObserverRef = useRef<HTMLDivElement>(null);

  // Load advertiser stats
  const loadAdvertiserStats = async () => {
    try {
      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/facebook/advertisers/stats`);
      if (res.ok) {
        const data = await res.json();
        setAdvertiserStats(data);
      }
    } catch (err) {
      console.error('Failed to load advertiser stats:', err);
    }
  };

  // Load advertisers
  const loadAdvertisers = useCallback(async (reset = false) => {
    if (advertisersLoading) return;
    setAdvertisersLoading(true);

    try {
      const currentOffset = reset ? 0 : advertisersOffset;
      const archiveServer = await getArchiveServerUrl();

      const params = new URLSearchParams({
        limit: '50',
        offset: currentOffset.toString(),
      });

      if (showDataBrokersOnly) {
        params.append('dataBrokersOnly', 'true');
      }

      const res = await fetch(`${archiveServer}/api/facebook/advertisers?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      let loadedAdvertisers: AdvertiserItem[] = data.advertisers || [];

      // Client-side search filter
      if (advertisersSearch.trim()) {
        const q = advertisersSearch.toLowerCase();
        loadedAdvertisers = loadedAdvertisers.filter((a: AdvertiserItem) =>
          a.name?.toLowerCase().includes(q)
        );
      }

      if (reset) {
        setAdvertisers(loadedAdvertisers);
        setAdvertisersOffset(50);
      } else {
        setAdvertisers(prev => [...prev, ...loadedAdvertisers]);
        setAdvertisersOffset(prev => prev + 50);
      }

      setAdvertisersHasMore(data.advertisers?.length === 50);
    } catch (err) {
      console.error('Failed to load advertisers:', err);
      setError(err instanceof Error ? err.message : 'Failed to load advertisers');
    } finally {
      setAdvertisersLoading(false);
    }
  }, [advertisersOffset, advertisersLoading, advertisersSearch, showDataBrokersOnly]);

  // Load on mount
  useEffect(() => {
    loadAdvertisers(true);
    loadAdvertiserStats();
  }, []);

  // Reload advertisers when search or filter changes
  useEffect(() => {
    const debounce = setTimeout(() => {
      setAdvertisers([]);
      setAdvertisersOffset(0);
      setAdvertisersHasMore(true);
      loadAdvertisers(true);
    }, 300);
    return () => clearTimeout(debounce);
  }, [advertisersSearch, showDataBrokersOnly]);

  // Infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && advertisersHasMore && !advertisersLoading) {
          loadAdvertisers();
        }
      },
      { threshold: 0.1 }
    );

    const target = advertisersObserverRef.current;
    if (target) observer.observe(target);
    return () => { if (target) observer.unobserve(target); };
  }, [advertisersHasMore, advertisersLoading, loadAdvertisers]);

  return (
    <div className="facebook-view__advertisers">
      {/* Stats bar */}
      {advertiserStats && (
        <div className="facebook-view__advertiser-stats">
          <div className="facebook-view__advertiser-stat">
            <span className="facebook-view__advertiser-stat-value">{advertiserStats.total.toLocaleString()}</span>
            <span className="facebook-view__advertiser-stat-label">Total</span>
          </div>
          <div className="facebook-view__advertiser-stat facebook-view__advertiser-stat--broker">
            <span className="facebook-view__advertiser-stat-value">{advertiserStats.dataBrokers}</span>
            <span className="facebook-view__advertiser-stat-label">Data Brokers</span>
          </div>
          <div className="facebook-view__advertiser-stat">
            <span className="facebook-view__advertiser-stat-value">
              {((advertiserStats.dataBrokers / advertiserStats.total) * 100).toFixed(1)}%
            </span>
            <span className="facebook-view__advertiser-stat-label">Broker %</span>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="facebook-view__filters">
        <input
          type="text"
          className="facebook-view__search"
          placeholder="Search advertisers..."
          value={advertisersSearch}
          onChange={(e) => setAdvertisersSearch(e.target.value)}
        />
        <label className="facebook-view__checkbox facebook-view__checkbox--broker">
          <input
            type="checkbox"
            checked={showDataBrokersOnly}
            onChange={(e) => setShowDataBrokersOnly(e.target.checked)}
          />
          Data Brokers Only
        </label>
      </div>

      {/* Advertisers list */}
      <div className="facebook-view__advertisers-list">
        {error && <div className="facebook-view__error">{error}</div>}

        {advertisers.length === 0 && !advertisersLoading && (
          <div className="facebook-view__empty">
            <p>No advertisers found</p>
            <span>{showDataBrokersOnly ? 'No data brokers in your archive' : 'Import your Facebook archive to see who tracks you'}</span>
          </div>
        )}

        {advertisers.map((advertiser) => (
          <div
            key={advertiser.id}
            className={`facebook-view__advertiser ${advertiser.isDataBroker ? 'facebook-view__advertiser--broker' : ''}`}
          >
            <div className="facebook-view__advertiser-header">
              <div className="facebook-view__advertiser-name">
                {advertiser.name}
                {advertiser.isDataBroker && (
                  <span className="facebook-view__advertiser-broker-badge">Data Broker</span>
                )}
              </div>
              <div className="facebook-view__advertiser-type">
                {advertiser.targetingType === 'uploaded_list' ? 'Has Your Data' : 'You Interacted'}
              </div>
            </div>
            <div className="facebook-view__advertiser-meta">
              <span className="facebook-view__advertiser-interactions">
                {advertiser.interactionCount} interaction{advertiser.interactionCount !== 1 ? 's' : ''}
              </span>
              <span className="facebook-view__advertiser-timeline">
                {formatDate(advertiser.firstSeen)} — {formatDate(advertiser.lastSeen)}
              </span>
            </div>
          </div>
        ))}

        {advertisersLoading && <div className="facebook-view__loading">Loading advertisers...</div>}
        <div ref={advertisersObserverRef} className="facebook-view__observer-spacer" />
      </div>
    </div>
  );
}
