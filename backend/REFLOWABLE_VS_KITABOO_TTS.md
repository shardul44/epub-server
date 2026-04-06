# Reflowable vs Kitaboo TTS — What’s Different, What Was Wrong, What’s Fixed

## Short answer

- **With Google Cloud TTS**: Reflowable does the **same** as Kitaboo (one stream, word timings, map to blocks). No mistake.
- **With gtts only**: We **fixed** the mistake (staccato) by chunking at sentence boundaries instead of letting gtts split every 100 chars. The only remaining limitation is that gtts gives no real word timings, so we use proportional timings (same idea as Kitaboo’s free-TTS path).

---

## 1. Kitaboo (FXL)

| Step | What happens |
|------|----------------|
| Text | One string per **page** (zones in reading order, joined with spaces). |
| TTS | **Always** `TtsService.synthesizePageAudio(text, ...)` — one call per page. |
| Engine | Google Cloud → real word timings; if no credentials → gtts (one call per page, but gtts lib splits at 100 chars → staccato on long pages). |
| Mapping | **Word level**: one SMIL fragment per word from `timings[i]`. **Sentence level**: one fragment per zone = first word start → last word end. |

So: same TTS input for word/sentence; only the way timings are grouped into SMIL changes.

---

## 2. Reflowable (Sync Studio)

| Step | What happens |
|------|----------------|
| Text | One string for the **whole job** (all `textChunks` in order, joined with spaces). |
| TTS | **Google Cloud**: `TtsService.synthesizePageAudio(fullText, ...)` — one call for full text. **gtts**: we do **not** call TtsService; we use the gtts library in `AudioSyncService` and control chunking ourselves. |
| Mapping | **Google**: use `ttsResult.timings` and map by word index to each block (same idea as Kitaboo). **gtts**: we have no word timings, so we use proportional: `(duration * blockWordCount / totalWords)` per block. |

So reflowable is “one stream for the whole job” instead of “one stream per page”, but the **mapping idea** (word timings → blocks, or proportional when no timings) is the same.

---

## 3. What was wrong in reflowable (and what we fixed)

**Mistake (now fixed):**  
When using **gtts**, we used to pass the **full text** in one go. The gtts library splits at **100 characters** and makes one TTS request per 100-char chunk, then appends the audio. That caused **staccato** (“like … a … horse …”).

**Fix:**  
We no longer give the whole string to gtts. We:

1. Split at **sentence boundaries** into chunks of at most 100 chars.
2. Generate one gtts file per chunk (each chunk ≤100 chars so gtts doesn’t split again).
3. **Concatenate** those files with ffmpeg into one `combined_audio_<jobId>.mp3`.
4. Map **proportional** timings to blocks from total duration and word counts.

So we are **not** “making a mistake” in reflowable anymore: we avoided the 100-char splitting that caused staccato.

---

## 4. Side‑by‑side

| Aspect | Kitaboo | Reflowable (now) |
|--------|--------|-------------------|
| Scope | Per page | Per job (full book/chapter) |
| Google Cloud | One call per page, word timings | One call for full text, word timings |
| gtts path | Via TtsService → one call per page (still 100‑char split inside gtts on long text) | **Our** sentence‑boundary chunking + concat → **no** mid‑phrase 100‑char split |
| Word timings with gtts | `estimateWordTimings` (even split) | Proportional per block (same idea) |
| Staccato with gtts | Can happen on long pages (gtts 100‑char split) | Avoided by sentence chunking + concat |

---

## 5. Summary

- **Reflowable with Google Cloud**: Same pattern as Kitaboo — one natural stream, word timings, correct mapping. No mistake.
- **Reflowable with gtts**: We **fixed** the mistake (staccato) by not giving long text to gtts in one go; we chunk at sentences and concatenate. The only “difference” is that we don’t use TtsService for this path so we can control chunking; the result is **better** than calling TtsService with one long string (which would still trigger 100‑char splitting inside gtts).
- **Remaining limitation**: With gtts we only have proportional/estimated timings, not real word boundaries — same limitation as Kitaboo when it uses free TTS.

So: the reflowable mistake was the old behaviour (full text → gtts → 100‑char staccato). That’s fixed. What’s left is the inherent limit of gtts (no word-level timings), which we handle the same way as Kitaboo’s free-TTS path (proportional / estimated timings).
