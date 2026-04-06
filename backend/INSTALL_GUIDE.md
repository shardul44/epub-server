# What You Need to Install

Quick reference: what to install for basic FXL, Whisper alignment, Aeneas, and the full Kitaboo stack.

---

## One command: install everything (Node + Python deps)

From the **backend** folder:

```bash
npm run install-all
```

This will: `npm install`, create Python `venv` if missing, and `pip install -r requirements-all.txt` (faster-whisper, torch, torchaudio, whisperx, montreal-forced-aligner). On Windows it runs `scripts/install-all.ps1`; on Mac/Linux, `scripts/install-all.sh`.

You still need **FFmpeg** (and optionally **eSpeak NG** for Aeneas/G2P) installed on your system — see below.

---

## Always required (Node + system)

| What | How |
|------|-----|
| **Node.js** (LTS) | [nodejs.org](https://nodejs.org) or `winget install OpenJS.NodeJS.LTS` |
| **npm dependencies** | From project root: `cd backend && npm install` |
| **FFmpeg** | For audio (normalize, silence detect). `winget install Gyan.FFmpeg` or [ffmpeg.org](https://ffmpeg.org/download.html) |

---

## Human narration alignment (pick one or more)

### Option A: Whisper alignment (recommended for long / human narration)

Used when **one long audio** is used for the whole book and `USE_WHISPER_ALIGNMENT=1` in `.env`.

| What | How |
|------|-----|
| **Python 3.9–3.12** | `winget install Python.Python.3.11` (avoid 3.13 for some deps) |
| **Backend venv** | `cd backend && python -m venv venv` then activate: `venv\Scripts\activate` (Windows) or `source venv/bin/activate` (Mac/Linux) |
| **faster-whisper** | `pip install faster-whisper` (inside `backend/venv`) |

Optional for better fuzzy matching (no code change needed):

- `npm install string-similarity` (or it’s in `optionalDependencies`)

---

### Option B: Aeneas alignment (alternative aligner)

Used when Whisper is not used or fails; needs **eSpeak NG** for phonemes.

| What | How |
|------|-----|
| **Python 3.9** (3.11 ok; 3.13 often fails for aeneas) | `winget install Python.Python.3.11` |
| **eSpeak NG** | [eSpeak NG releases](https://github.com/espeak-ng/espeak-ng/releases) — install to e.g. `C:\Program Files\eSpeak NG` (Windows). Backend expects this path or eSpeak NG in `PATH`. |
| **Aeneas** | `pip install numpy` then `pip install aeneas` (use same Python that has eSpeak NG in PATH) |

See **backend/scripts/setup-aeneas.md** for full Aeneas setup.

---

## Full Kitaboo stack (optional)

Enable via `.env` and extra installs below.

### 1. Silero VAD (no highlight start in silence)

**Env:** `USE_SILERO_VAD=1`

| What | How |
|------|-----|
| **torch, torchaudio** | `pip install torch torchaudio` (inside `backend/venv`) |

Script: `backend/scripts/silero_vad.py` (loads Silero from PyTorch Hub; no extra pip package).

---

### 2. Whisper-X (human narration, phonemic alignment)

**Env:** `USE_WHISPERX=1` (and `USE_WHISPER_ALIGNMENT=1`)

| What | How |
|------|-----|
| **Python 3.10+** | Same as Whisper |
| **whisperx** | `pip install whisperx` (pulls in torch, faster-whisper, etc.) |

Script: `backend/scripts/whisperx_transcribe.py`.

---

### 3. Montreal Forced Aligner (MFA)

**Env:** `USE_MFA=1`, `MFA_DICTIONARY_PATH`, `MFA_ACOUSTIC_MODEL_PATH`

| What | How |
|------|-----|
| **Montreal Forced Aligner** | `pip install montreal-forced-aligner` |
| **Acoustic model + dictionary** | Download from [MFA models](https://mfa-models.readthedocs.io/) (e.g. English), set paths in `.env`. |

---

### 4. G2P / custom dictionary (for MFA OOV words)

Optional: better handling of rare/unique words (e.g. “Zog”) when using MFA.

| What | How |
|------|-----|
| **espeak-ng** (or espeak) | [eSpeak NG](https://github.com/espeak-ng/espeak-ng/releases) — same as for Aeneas; used as OOV fallback for phonemes. |

---

## One-line cheat sheet

**Minimal (FXL + TTS only):**  
Node, `npm install`, FFmpeg.

**Whisper alignment (one long audio):**  
Above + Python 3.9–3.12, `backend/venv`, `pip install faster-whisper`.

**Aeneas alignment:**  
Above + eSpeak NG, `pip install numpy aeneas` (see setup-aeneas.md).

**Full Kitaboo:**  
- Silero VAD: `pip install torch torchaudio`, `USE_SILERO_VAD=1`  
- Whisper-X: `pip install whisperx`, `USE_WHISPERX=1`  
- MFA: `pip install montreal-forced-aligner` + model/dict, `USE_MFA=1` + paths in `.env`  
- G2P OOV: install espeak-ng (same as Aeneas).

---

## .env summary

Add to `backend/.env` as needed:

```env
# Prefer Whisper for global (one-file) human narration
USE_WHISPER_ALIGNMENT=1

# Optional: Whisper-X instead of Faster-Whisper (phonemic alignment)
USE_WHISPERX=1

# Optional: Silero VAD — no highlight start in silence
USE_SILERO_VAD=1

# Optional: MFA alignment (set paths to your model + dictionary)
USE_MFA=1
MFA_DICTIONARY_PATH=C:\path\to\english_mfa.dict
MFA_ACOUSTIC_MODEL_PATH=C:\path\to\english_mfa.zip

# Optional: highlight starts 50ms before audio (default 50)
SMIL_ANTICIPATORY_OFFSET_MS=50
```
