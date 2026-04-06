# Full Kitaboo Stack

This document describes the full Kitaboo-style stack and how to enable it via environment variables and dependencies.

## 1. Silero VAD (Voice Activity Detection)

**Purpose:** Pre-process audio to get millisecond-level silence; SMIL is forbidden from starting a highlight inside a silence zone (no flicker during narrator's breath).

**Enable:** `USE_SILERO_VAD=1`

**Setup:**
- Python 3.x with torch and torchaudio
- Silero VAD via PyTorch Hub (no extra pip package; script loads `snakers4/silero-vad`)

```bash
pip install torch torchaudio
# Script: backend/scripts/silero_vad.py
```

**Node:** `sileroVadService.getSilencePeriods(audioPath)` returns `{ silence_periods, speech_periods }`. When generating SMIL, `silencePeriods` is passed in `smilOptions` so `normalizeFragmentsForSmil` clamps clipBegin out of silence.

---

## 2. Whisper-X (Human Narration)

**Purpose:** Transcription + wav2vec2 phonemic alignment for human voice (accents, dramatic pauses); reduces timestamp drift vs plain Whisper.

**Enable:** `USE_WHISPERX=1` (and keep `USE_WHISPER_ALIGNMENT=1` for global alignment)

**Setup:**
- Python 3.10+ with whisperx

```bash
pip install whisperx
# Script: backend/scripts/whisperx_transcribe.py
```

**Node:** `whisperAlignmentService.transcribeWithTimestamps()` uses Whisper-X script when `USE_WHISPERX=1` or `options.useWhisperX`. Same output shape as Faster-Whisper (segments with start, end, text, words).

---

## 3. Montreal Forced Aligner (MFA)

**Purpose:** Kaldi-based acoustic modeling for millisecond-level alignment; avoids "Fallback Score -1.00" when used with a custom dictionary + G2P for OOV words.

**Enable:** `USE_MFA=1` and set:
- `MFA_DICTIONARY_PATH` — path to MFA-format dictionary (word TAB phonemes)
- `MFA_ACOUSTIC_MODEL_PATH` — path to MFA acoustic model (e.g. `english_mfa.zip`)

**Setup:**
- Install Montreal Forced Aligner (pip or conda)
- Download acoustic model and dictionary, or use G2P service to generate dictionary from text

```bash
pip install montreal-forced-aligner
# Download model/dict: https://mfa-models.readthedocs.io/
```

**Node:** `mfaService.alignPlainSegments(audioPath, segments, options)` creates temp corpus (one .wav + one .lab), runs `mfa align`, parses JSON output, returns `[{ id, startTime, endTime }]`.

---

## 4. G2P / Phonetic Dictionary

**Purpose:** Custom dictionary + OOV fallback (espeak-ng) so MFA doesn’t fail on unique names (e.g. "Zog").

**Setup:**
- Optional custom dictionary file: one line per word, `word\tphonemes`
- For OOV: espeak-ng (or espeak) for `getPhonemes(word)` and `generateMfaDictionary(words, language)`

**Node:** `g2pService.loadDictionary(path)`, `g2pService.getPhonemes(word, language)`, `g2pService.generateMfaDictionary(words, language)`. Use when building MFA dictionary or for OOV during alignment.

---

## Environment Summary

| Variable | Effect |
|----------|--------|
| `USE_SILERO_VAD=1` | Run Silero VAD on global audio; pass silence periods to SMIL so clipBegin never starts in silence |
| `USE_WHISPERX=1` | Use Whisper-X (transcribe + align) instead of Faster-Whisper when `USE_WHISPER_ALIGNMENT=1` |
| `USE_WHISPER_ALIGNMENT=1` | Prefer Whisper (or Whisper-X) over Aeneas for global alignment |
| `USE_MFA=1` | Prefer MFA for global alignment when `MFA_DICTIONARY_PATH` and `MFA_ACOUSTIC_MODEL_PATH` are set |
| `MFA_DICTIONARY_PATH` | Path to MFA dictionary file |
| `MFA_ACOUSTIC_MODEL_PATH` | Path to MFA acoustic model (e.g. .zip) |
| `SMIL_ANTICIPATORY_OFFSET_MS` | Highlight lead time in ms (default 50) |

---

## Alignment Order (Global Audio)

When one long audio is used for the whole book:

1. **MFA** — if `USE_MFA=1` and MFA is available and dictionary/model paths set
2. **Whisper / Whisper-X** — if `USE_WHISPER_ALIGNMENT=1` and Whisper (or Whisper-X if `USE_WHISPERX=1`) is available
3. **Aeneas** — fallback

After alignment, refinement (e.g. `refinePlainSegmentResults` with silence snapping) is applied when available.

---

## SMIL Generation (Full Kitaboo)

- **Monotonic clipBegin** — always increases
- **Min duration 200 ms** — no flicker
- **Anticipatory offset** — highlight starts 50–100 ms before audio (configurable)
- **Silero VAD** — when `USE_SILERO_VAD=1`, clipBegin is clamped so it never falls inside a silence zone
