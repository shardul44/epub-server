# Root Cause: Reflowable TTS Speaking "All ... about ... horses ..." (Staccato)

## Symptom

Reflowable Sync Studio TTS sounds robotic: **"All .. about ... horses ... a ... person... on ... its ....."** — one word at a time with pauses, instead of natural flowing sentences.

---

## Root Cause (Chain of Events)

### 1. Frontend sends one block per word when Export Level = "word"

**Where:** `frontend/src/pages/SyncStudio.jsx`

- **`parseXhtmlElements`** (lines ~192–296) parses XHTML and builds two kinds of elements:
  - **Sentence/paragraph** elements: `[data-read-aloud="true"]` with `id` like `chapter3_page6_p1_s1`, `text` = full sentence.
  - **Word** elements: nested `.sync-word[id]` or `span[id*="_w"]` with `id` like `chapter3_page6_p1_s1_w1`, **`text` = single word** (e.g. `"All"`, `"about"`, `"horses"`).

- On **"Generate TTS"**, `handleGenerateAudio` filters `parsedElements` by **granularity** (`matchesGranularity`):
  - **word**: only elements with `type === 'word'` or `id.includes('_w')`.
  - So when Export Level is **"word"**, `textBlocks` = array of blocks where **each block has `text` = one word**.

**Result:** Backend receives e.g.:

```js
textBlocks = [
  { id: 'chapter3_page6_p1_s1_w1', pageNumber: 6, text: 'All' },
  { id: 'chapter3_page6_p1_s1_w2', pageNumber: 6, text: 'about' },
  { id: 'chapter3_page6_p1_s1_w3', pageNumber: 6, text: 'horses' },
  ...
]
```

So **granularity = "word"** ⇒ **one chunk per word** sent to the API.

---

### 2. Backend path selection (before fix)

**Where:** `backend/src/services/audioSyncService.js` → `generateCompleteAudio`

**TtsService.getClient()** (`backend/src/services/TtsService.js`):

- If `FORCE_FREE_TTS === 'true'` (default) or no `GOOGLE_APPLICATION_CREDENTIALS` ⇒ returns **string** `'free-tts'`, not an object.
- So `client && typeof client === 'object'` is **false** when using free gtts ⇒ **Google Cloud “natural” path is never used** in the typical setup.

**Path 1 – Google Cloud natural (one TTS for full text):**  
Runs only when `getClient()` returns a real `TextToSpeechClient` (object). Then `_generateNaturalCompleteAudio` builds `fullText = textChunks.map(c => c.text).join(' ')`, one TTS call, word timings mapped back to blocks ⇒ **natural flow**.

**Path 2 – Per-chunk (before “natural gtts” was added):**  
When Path 1 is skipped, the code used to go **straight to the per-chunk loop**:

- For **each** `chunk` in `textChunks` it called `generateAudioForText(chunk.text, ...)`.
- With word-level chunks, `chunk.text` is **one word** ⇒ **one TTS call per word**.
- Each call produced one short clip (e.g. "All", "about", "horses").
- These clips were **concatenated** with ffmpeg into `combined_audio_${jobId}.mp3`.

**Result:** One tiny clip per word, then concat ⇒ **"All ... about ... horses ... a ... person ... on ... its ....."** (staccato).

So the **root cause** is: **per-chunk TTS generation + word-level chunks = one TTS call per word → concatenation → staccato.**

---

### 3. Why FXL (Kitaboo) sounds natural

**Where:** `backend/src/services/KitabooFxlService.js` (e.g. ~2116–2127)

- FXL generates TTS **per page**: it builds **one** `pageText` (or `pageTextFromGroups`) for the **entire page**.
- **One** call to `TtsService.synthesizePageAudio({ text: pageText, ... })` ⇒ one continuous utterance per page.
- Word timings from that single response are then mapped to zones/fragments.

So FXL never does “one TTS per word”; it always does “one TTS per page (full text)” ⇒ natural flow.

---

### 4. Contributing factors

| Factor | Effect |
|--------|--------|
| **Export Level = "word"** | Frontend sends one block per word ⇒ backend gets many chunks with single-word `text`. |
| **FORCE_FREE_TTS=true or no GCP credentials** | Google Cloud natural path is skipped; backend relies on gtts/per-chunk path. |
| **Per-chunk design** | When each chunk is one word, “per chunk” = “per word” ⇒ one clip per word. |
| **Natural gtts path required AiConfig** | If AI config was missing, `_generateNaturalCompleteAudioWithGtts` returned null ⇒ fallback to per-chunk ⇒ staccato even with gtts available. |

---

## Fixes Applied

1. **Natural path for Google Cloud**  
   When `getClient()` is a real client: one `synthesizePageAudio` call with **full text**; map word timings back to blocks. No per-chunk TTS.

2. **Natural path for gtts**  
   `_generateNaturalCompleteAudioWithGtts`: build `fullText` from all chunks → **one** gtts call → one MP3 → assign block start/end by word proportion. No per-word clips.

3. **Per-chunk only as last resort**  
   Per-chunk + concat is used only when both natural paths are unavailable or fail.

4. **Natural gtts without AiConfig**  
   gtts does not need an API key; natural gtts path no longer requires AiConfig, so it runs whenever gtts is available and avoids staccato even when AI config is not set.

---

## Verification

- **Export Level = "word"** with **Google Cloud TTS** configured ⇒ one TTS call for full text ⇒ natural.
- **Export Level = "word"** with **free gtts** only ⇒ one gtts call for full text ⇒ natural.
- **Export Level = "sentence"** or **"paragraph"** ⇒ fewer, longer chunks; natural path still uses full text in one call ⇒ natural.
- Only when both natural paths fail (e.g. no gtts, no GCP) does per-chunk run ⇒ staccato possible only in that edge case.

---

## Summary

| Item | Detail |
|------|--------|
| **Root cause** | Per-chunk TTS generation with **word-level chunks** → one TTS call per word → concatenation → staccato. |
| **Trigger** | Export Level "word" in Sync Studio + backend using free gtts (or missing natural path). |
| **Fix** | Always prefer **one continuous TTS** for the full text (Google Cloud or gtts), then map timings to blocks; per-chunk only as fallback. |
