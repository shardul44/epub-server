# Whisper-Based Alignment (Alternative to Aeneas)

Kitaboo-style sync can use **Whisper** (transcription + fuzzy match) instead of Aeneas (forced alignment). Whisper handles accents, noise, and dramatic narration better because it "listens" to meaning rather than matching frequencies.

## How It Works

1. **Transcription**: Whisper transcribes the full narration with timestamps (segment-level via CLI, or word-level via Python script).
2. **Text normalization**: XHTML text and Whisper output are lowercased and punctuation stripped for comparison.
3. **Sliding-window fuzzy match**: For each expected segment (e.g. `p1_z1_s0` = "Time for Kids"), we search a *run* of Whisper segments (1–15) that best matches. We assign the start of the first and end of the last in that run. The search for the next segment starts only after the previous match (prevents "jumping" to the wrong page).
4. **Missing segment**: If match confidence &lt; 85%, we assign a virtual timestamp (previous_end + 50ms) so the highlight still moves.
5. **Refinement**: The same silence snapping used for Aeneas is applied to Whisper timestamps (`aeneasService.refinePlainSegmentResults`).

## Enabling Whisper Alignment

- **Environment**: Set `USE_WHISPER_ALIGNMENT=1` before starting the backend. Global alignment (single long audio for all pages) will try Whisper first, then fall back to Aeneas if Whisper fails or is not installed.
- **API**: When publishing FXL EPUB, send `useWhisperAlignment: true` in the request body:
  ```json
  POST /api/kitaboo/publish/:jobId
  { "syncLevel": "sentence", "voice": { ... }, "useWhisperAlignment": true }
  ```

## Requirements

- **Whisper CLI**: `pip install openai-whisper` and `whisper` on PATH (used by default for segment-level transcription).
- **FFmpeg**: For audio handling.
- Optional **word-level**: Use `scripts/whisper_transcribe_wordlevel.py` with `faster-whisper` (`pip install faster-whisper`) for word-level timestamps; the Node service can be extended to call this script and map word IDs.

## Comparison

| Feature | Aeneas | Whisper |
|--------|--------|--------|
| Method | Forced alignment (DTW) | Transcribe + fuzzy match |
| "If You Were a Horse" not found | Fails (punctuation/noise) | Matches from actual speech |
| Zero-duration segments | Can occur at end | Real durations from transcript |
| Fallback score -1.00 | Text–audio match fails | Text–text match (easier) |
