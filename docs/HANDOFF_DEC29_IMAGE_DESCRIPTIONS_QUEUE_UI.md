# Handoff: Image Descriptions + Batch Queue Pipeline UI

**Date**: December 29, 2025
**Branch**: `feature/subjective-intentional-constraint`
**Status**: ALL PHASES COMPLETE

---

## Summary

Two features fully implemented:
1. **Display image descriptions in gallery lightbox** - COMPLETE
2. **Batch Queue Pipeline UI** with job submission, progress, and history - COMPLETE
3. **Job Handlers** for PDF, audio, humanization - COMPLETE
4. **Agent Proposal Display** - COMPLETE

---

## Work Completed (This Session)

### Phase 1: Foundation
1. **Database method**: Added `getImageAnalysisById(id)` to EmbeddingDatabase
2. **Route order fix**: Moved parameterized `/analysis/:id` after specific routes
3. **SQL fix**: `getImageAnalysisStats` no longer references non-existent `media_files` table
4. **Queue manager fix**: Now calls `/api/gallery/analysis/batch` (correct endpoint)

### Phase 2: Lightbox Enhancement
- **File**: `apps/web/src/components/archive/GalleryView.tsx`
- ARIA roles (`role="dialog"`, `aria-modal`, `aria-labelledby`)
- Keyboard navigation (Escape, Left/Right arrows)
- Description panel fetching analysis from API
- Navigation buttons with 48px touch targets
- CSS: ~190 lines added to index.css

### Phase 3: Queue Tab UI
Created 4 components in `apps/web/src/components/queue/`:

| Component | Purpose | Lines |
|-----------|---------|-------|
| `QueueTab.tsx` | Main container with status bar, sections | ~180 |
| `BatchJobForm.tsx` | Job submission with file selection, model picker | ~220 |
| `JobProgressCard.tsx` | Active job progress display | ~140 |
| `JobHistoryList.tsx` | Completed/failed job history | ~175 |
| `index.ts` | Exports | ~10 |

**Integration**:
- Added `'queue'` to `ArchiveTabId` type
- Added queue tab to `ARCHIVE_TABS` array (icon: ⚙️)
- Added `QueueTab` import and case to `ArchiveTabs.tsx`

**CSS**: ~620 lines for queue components

### Phase 4: Job Handlers
Created handlers in `electron/queue/handlers/`:

| File | Purpose |
|------|---------|
| `pdf.ts` | PDF extraction using pdf-parse |
| `audio.ts` | Audio transcription using whisper manager |
| `humanize.ts` | Batch humanization via NPE API |
| `pdf-parse.d.ts` | Type declarations for pdf-parse |
| `index.ts` | Re-exports all handlers |

**Types added to `queue/types.ts`**:
- `PdfExtractionResult`
- `AudioTranscriptionResult`
- `HumanizationResult`

**Manager updated**: `processFile` switch now handles `extract`, `transform`, `summarize` job types

### Phase 5: Agent Proposal Display
Created `apps/web/src/components/queue/AgentProposalCard.tsx`:
- Fetches pending proposals from Electron IPC
- Displays with urgency indicators (low/normal/high/critical)
- Expandable details with action type, project, description
- Approve/Reject buttons with 44px touch targets
- Auto-refresh every 5 seconds
- Gracefully hidden when not in Electron

**CSS**: ~220 lines for proposal styling

---

## All Files Modified/Created

### Created
| File | Purpose |
|------|---------|
| `apps/web/src/components/queue/QueueTab.tsx` | Queue tab container |
| `apps/web/src/components/queue/BatchJobForm.tsx` | Job submission form |
| `apps/web/src/components/queue/JobProgressCard.tsx` | Progress display |
| `apps/web/src/components/queue/JobHistoryList.tsx` | Job history |
| `apps/web/src/components/queue/AgentProposalCard.tsx` | Agent proposals |
| `apps/web/src/components/queue/index.ts` | Exports |
| `electron/queue/handlers/pdf.ts` | PDF extraction |
| `electron/queue/handlers/audio.ts` | Audio transcription |
| `electron/queue/handlers/humanize.ts` | Batch humanization |
| `electron/queue/handlers/pdf-parse.d.ts` | Type declarations |
| `electron/queue/handlers/index.ts` | Handler exports |

### Modified
| File | Changes |
|------|---------|
| `apps/web/src/components/archive/GalleryView.tsx` | Enhanced lightbox |
| `apps/web/src/components/archive/ArchiveTabs.tsx` | Added Queue tab |
| `apps/web/src/components/archive/types.ts` | Added 'queue' to ArchiveTabId |
| `apps/web/src/index.css` | Lightbox + Queue + Proposals CSS (~1030 lines total) |
| `electron/archive-server/routes/gallery.ts` | Fixed route order |
| `electron/archive-server/services/embeddings/EmbeddingDatabase.ts` | Added `getImageAnalysisById`, fixed stats |
| `electron/queue/manager.ts` | Fixed batch sync endpoint, added handler imports |
| `electron/queue/types.ts` | Added result types |
| `apps/web/src/lib/aui/tools.ts` | Tool parsing regex fix |

---

## Testing

```bash
# Start the app
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# Test endpoints
curl http://localhost:3002/api/gallery/analysis/stats
curl "http://localhost:3002/api/gallery/analysis/search?q=nature"
```

In the app:
1. Click Queue tab (⚙️ icon)
2. Select job type, model, concurrency
3. Drag/drop files
4. Click "Start Batch Job"
5. Watch progress in Active Jobs section
6. See completed jobs in Recent Jobs section
7. Agent proposals appear automatically when agents submit them

---

## WCAG Accessibility

| Feature | Implementation |
|---------|----------------|
| Touch targets | 44px+ on all buttons |
| Keyboard nav | Escape, arrows in lightbox |
| ARIA roles | dialog, modal, progressbar, live regions |
| Focus management | Ref-based focus in lightbox |
| Labels | All form inputs have labels |
| Urgency indicators | Visual + accessible labels |

---

## Known Issues

1. **Pre-existing TypeScript error** in `apps/web/src/lib/archive/service.ts:313` - Type mismatch with `ContainerMessage[]`. Unrelated to this work.

2. **pdf-parse not installed** - Run `npm install pdf-parse` to enable PDF extraction jobs.

3. **Whisper not available** - The app logs "Whisper module not installed" on startup. Audio transcription will fail until `@kutalia/whisper-node-addon` is installed.

---

## Plan File

Full plan at: `/Users/tem/.claude/plans/nested-humming-tulip.md`

---

**End of Handoff**
