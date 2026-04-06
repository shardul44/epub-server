# 100% Accuracy: Human Narration Auto-Sync for FXL EPUB

This guide explains how to achieve accurate highlight-in-sync for human-narrated audio in Kitaboo FXL EPUB.

---

## Paths to 100% Accuracy

| Path | Accuracy | Effort | When to use |
|------|----------|--------|-------------|
| **1. Manual correction** | 100% | Medium (5–15 min per page) | Works today with current ~30% auto |
| **2. One audio per page** | 90–100% auto | Low (split audio, re-upload) | Best auto accuracy |
| **3. Whisper-X + MFA** | 60–80% auto | Medium (install deps) | Better auto, then manual touch-up |
| **4. Zone text matches transcript** | 80–95% auto | High (edit zones to match speech) | When narration follows book exactly |

### Path 1: Manual Correction (100% — Use Now)

FXL Sync Studio already supports manual correction. After Run alignment (~30%):

1. **Select a zone** in the left panel (click it).
2. **Play** the audio. When the narrator starts that text, press **Space** (marks start). When they finish, press **Space** again (marks end).
3. Or **drag/resize** the region on the waveform to set start/end.
4. Or use **"Set start"** / **"Set end"** buttons with playhead.
5. Repeat for each zone that's off. **Save** when done.

This gives 100% accuracy. Typical: 1–2 min per zone; ~5–15 min per page depending on zone count.

### Path 2: Per-Page Audio (90–100% Auto) — Kitaboo Recommendation

- Record or split audio so each page has its own file: `page_1.mp3`, `page_2.mp3`, …
- Smaller files prevent drift; sync "resets" at every page.
- Auto accuracy jumps from ~30% to 85–95%.

**Option A — Automatic two-pass:** Set `USE_TWO_PASS_ALIGNMENT=1`. First Align runs whole-file (~30%), then auto-splits by timestamps and re-aligns per-page. Second pass usually reaches 85–90%.

**Option B — Manual split:** Run Align once, Save. Then:
```bash
node scripts/split-audio-per-page.cjs ./narration.mp3 ./alignment.json ./page-audio
```
Export alignment from `html_intermediate/kitaboo_<jobId>/alignment.json`. Re-run Align with per-page audio in Zoning Studio.

### Path 3: Whisper-X + MFA (Better Auto)

- Install Whisper-X and optionally MFA (see below).
- Set `USE_WHISPERX=1` and/or `USE_MFA=1` in `.env`.
- Auto accuracy improves to 60–80%; finish with manual correction for 100%.

### Path 4: Zone Text Matches Narration

- Zone `content` must exactly match what is spoken.
- Exclude: page numbers, headers, footers, TOC.
- When zone text = narration, Aeneas/Whisper align much better (80–95% auto).

---

## Terminal Analysis (Current State)

From your logs:

| Issue | Impact | Fix |
|-------|--------|-----|
| `whisperx not installed` | Falls back to Aeneas; Whisper-X gives better human-voice alignment | Install Whisper-X |
| `'mfa' is not recognized` | MFA (Montreal Forced Aligner) not used; best accuracy | Install MFA |
| Ghost segment p4_z13: 53s→201s | One zone stretched 148s; capped to 10s | Exclude unspoken zones from alignment |
| 34 segments at 226.84s (zero duration) | Aeneas ran out of audio; text not in narration | Use 1 audio per page OR ensure zone text matches spoken |
| "no global alignment data" on some pages | Pages get no SMIL/highlights | Zone IDs must match alignment; re-run Align after zone changes |

---

## Recommended Setup for 100% Accuracy

### 1. Install Whisper-X (Best for Human Voice)

```bash
cd backend
pip install whisperx
# Or: pip install -r requirements-kitaboo.txt
```

- Handles accents, dramatic pauses, and natural speech
- Phonemic alignment reduces timestamp drift vs plain Whisper
- Set `USE_WHISPERX=1` in `.env`

**If Whisper-X fails:** Ensure Python 3.10+ and run `pip install torch torchaudio` first.

### 2. Use One Audio File Per Page

**Most reliable approach:** Upload `page_1.mp3`, `page_2.mp3`, … for each page.

- Each page aligns independently
- No "ran out of audio" collapse
- No ghost segments spanning 148s

**How:** In FXL Sync Studio, upload `page_1.mp3` for page 1, `page_2.mp3` for page 2, etc., instead of a single `narration.mp3`.

### 3. Install Montreal Forced Aligner (Optional, Highest Accuracy)

```bash
pip install montreal-forced-aligner
# Download model: https://mfa-models.readthedocs.io/
```

Set in `.env`:
```
USE_MFA=1
MFA_DICTIONARY_PATH=path/to/dictionary.txt
MFA_ACOUSTIC_MODEL_PATH=path/to/english_mfa.zip
```

### 4. Zone Text Must Match Spoken Content

- Zone `content` must exactly match what is spoken
- Exclude: page numbers, headers, footers, TOC
- Run Align **after** zoning; if zones change, re-run Align before Publish

### 5. Whisper Model (faster-whisper)

Set `WHISPER_MODEL` in `.env` for transcription accuracy vs speed:

- `base` — fastest, lower accuracy
- `small` — default, balanced
- `medium` — best accuracy, slower

### 6. Workflow

1. **Zoning:** Draw zones, split to sentence/word level
2. **Upload audio:** Either 1 file per page OR 1 narration for whole book
3. **Align:** Click "Align" in Sync Studio (runs Whisper-X → Aeneas)
4. **Publish:** Do not change zones after aligning; Publish uses saved alignment

---

## Code Improvements (Whisper Alignment)

- **Anchor system:** When word-first yields few matches, find unique words (e.g. "Photosynthesis", "Aristotle") in zones, match in Whisper at 0.85 similarity, lock those timestamps, and rubber-band remaining zones between anchors. Improves distribution when narration follows text but fuzzy match fails.
- **MIN_CONFIDENCE 0.6** (lower): Trust segment text when Whisper is unsure. Segment-level matching more permissive.
- **MIN_WORD_SIMILARITY 0.8** (tighter): Only accept confident word matches. Reduces false positives.
- **WHISPER_MODEL=small** (default): Better transcription than base; use for 90%+ sync.

## KITABOO-Style High-Fidelity (90–99%)

1. **Forced alignment first:** Set `USE_AENEAS_FIRST=1` to try Aeneas (phoneme-level forced alignment) before Whisper. Best when zone text closely matches narration.

2. **Dictionary-based correction:** Add `backend/config/zone_text_replacements.json`:
   ```json
   { "replacements": [ { "from": "Blazernan", "to": "Blazeman" }, { "from": "Aristole", "to": "Aristotle" } ] }
   ```
   Or env `ZONE_TEXT_REPLACEMENTS` (JSON array). Fixes OCR errors and proper nouns so the aligner "hears" the right words.

3. **MFA + dictionary:** Use `MFA_DICTIONARY_PATH` with custom pronunciations for technical terms. See g2pService for OOV handling.

## Alignment Order (When Available)

1. **MFA** — if `USE_MFA=1` and paths set
2. **Aeneas** — if `USE_AENEAS_FIRST=1` (forced alignment; falls back if ghost segments)
3. **Whisper** — if `USE_WHISPER_ALIGNMENT=1`
4. **Aeneas** — fallback

---

## Troubleshooting

| Symptom | Cause | Action |
|---------|-------|--------|
| Many "zero duration" segments | Zone text > spoken content; Aeneas runs out of audio | Use 1 audio per page, or remove unspoken zones |
| Ghost segment (e.g. 148s) | One zone matched to huge span | Exclude that zone from alignment; check zone content |
| "no global alignment data" | Zone IDs changed after Align, or alignment empty for page | Re-run Align after zone edits; ensure page has text zones |
| Highlights lag/lead voice | TTS/alignment timing vs playback | Adjust `SMIL_AUDIO_DURATION_FACTOR` (0.90–0.95) |
| Alignment timeout (180s+) | Whisper too slow on CPU | Use `WHISPER_MODEL=base`, `WHISPER_FAST_ALIGNMENT=1`, or `SKIP_SILENCE_SNAPPING=1` |

---

## Performance (Avoid Timeout)

- **WHISPER_MODEL=base** — Fastest (default for alignment). Use `small` or `medium` only if you have GPU.
- **WHISPER_FAST_ALIGNMENT=1** — Forces base model + beam_size=1 for maximum speed.
- **SKIP_SILENCE_SNAPPING=1** — Skips Aeneas refinement after Whisper (saves ~5–15s).
- **WHISPER_USE_CUDA=1** — Use GPU (much faster). Requires CUDA + cuDNN.
- **USE_MFA=0** — Skip MFA check when MFA not installed (saves ~2–3s).
