# Handoff: Whisper Transcription Integration

**Date**: January 10, 2025
**Status**: Backend complete, UI pending

---

## Completed This Session

### 1. Whisper Model Downloaded
- Downloaded `ggml-tiny.en.bin` (75MB) for testing
- Stored in `~/Library/Application Support/Humanizer/whisper-models/`
- Works with Metal GPU acceleration on Apple Silicon

### 2. Audio Converter Service
**New File**: `electron/archive-server/services/video/AudioConverter.ts`
- Converts MP4/M4A/any media to 16kHz mono WAV (whisper format)
- Uses ffmpeg-static (bundled)
- Caches converted files in `.audio-cache/` directory
- Deduplication for concurrent requests

### 3. Transcription API Endpoints
**Modified**: `electron/archive-server/routes/facebook.ts`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/facebook/transcription/status` | GET | Whisper + transcription stats |
| `/api/facebook/transcription/models` | GET | List available models |
| `/api/facebook/transcription/models/download` | POST | Download a model |
| `/api/facebook/transcription/transcribe` | POST | Transcribe media file |
| `/api/facebook/transcription/:mediaId` | GET | Get transcript for item |
| `/api/facebook/transcription/search` | GET | Search transcripts |
| `/api/facebook/transcription/pending` | GET | List untranscribed media |

### 4. Database Schema Updates
**Modified**: `electron/archive-server/services/facebook/MediaItemsDatabase.ts`

New columns in `facebook_media` table:
- `transcript TEXT` - Full transcript text
- `transcription_status TEXT` - 'pending'|'processing'|'completed'|'failed'

New methods:
- `updateTranscript(id, transcript, status)`
- `getTranscript(id)`
- `getUntranscribedMedia(limit)`
- `getTranscriptionStats()`
- `searchTranscripts(query, limit)`

### 5. Whisper Result Parsing Fixed
**Modified**: `electron/whisper/whisper-manager.ts`

The @kutalia/whisper-node-addon returns format:
```json
{"transcription":[["00:00:00.000","00:00:10.320"," [Music]"]]}
```

Updated `transcribeAudio()` to parse this into segments with start/end times.

---

## Testing Commands

```bash
# Test whisper directly (requires app restart for new endpoints)
npx ts-node scripts/test-whisper.ts <video_path>

# After app restart, these endpoints will work:
curl http://localhost:3002/api/facebook/transcription/status

# Transcribe a file
curl -X POST http://localhost:3002/api/facebook/transcription/transcribe \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/video.mp4", "model": "ggml-tiny.en.bin"}'

# Search transcripts
curl "http://localhost:3002/api/facebook/transcription/search?q=music"
```

---

## Available Whisper Models

| Model | Size | Quality | Speed |
|-------|------|---------|-------|
| ggml-tiny.en.bin | 75 MB | Basic | Very fast |
| ggml-base.en.bin | 142 MB | Good | Fast |
| ggml-small.en.bin | 466 MB | Better | Medium |
| ggml-medium.en.bin | 1.5 GB | Very good | Slow |
| ggml-large-v3-turbo.bin | 1.6 GB | Best | Slowest |

Models are downloaded on-demand from HuggingFace.

---

## Files Added/Modified

### New Files
| File | Purpose |
|------|---------|
| `electron/archive-server/services/video/AudioConverter.ts` | Convert media to WAV |
| `scripts/test-whisper.ts` | Test script for whisper |

### Modified Files
| File | Changes |
|------|---------|
| `electron/archive-server/routes/facebook.ts` | Added transcription endpoints |
| `electron/archive-server/services/facebook/MediaItemsDatabase.ts` | Added transcript storage |
| `electron/archive-server/services/video/index.ts` | Export AudioConverter |
| `electron/whisper/whisper-manager.ts` | Fixed result parsing |

---

## Next Steps

### 1. UI: Transcribe Button
Add a transcribe button to the video player or gallery item:
- `apps/web/src/components/media/VideoPlayer.tsx` - Add button
- Show loading state during transcription
- Display transcript below video

### 2. Batch Transcription
Add endpoint to transcribe multiple files in background:
- Queue-based processing
- Progress events via IPC

### 3. Search Integration
Include transcripts in unified search:
- Add to `searchUnified()` in embeddings routes
- Full-text search across transcripts

---

## Technical Notes

### GPU Acceleration
- Metal backend works on Apple Silicon
- Logs show: `ggml_metal_init: GPU name: Apple M1 Pro`
- ~3-5x faster than CPU inference

### Audio Format Requirements
- Whisper requires 16kHz mono WAV
- ffmpeg handles conversion automatically
- Cached to avoid re-conversion

### Memory Usage
- Tiny model: ~200MB during inference
- Base model: ~350MB during inference
- Models loaded on first use, unloaded after

---

## Handoff from Previous Session

The previous session completed:
1. Video thumbnails with lazy generation
2. HTTP Range support for video seeking
3. VideoProbeService for detecting audio-only MP4s
4. Facebook timestamp migration (605 items)
5. Whisper module installation with rpath fix

This session added the transcription infrastructure on top of that work.
