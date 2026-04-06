# Kitaboo TTS: Word vs Sentence Level

## Overview

Kitaboo FXL uses **one TTS call per page** and always gets **word-level timings** from the TTS engine. It then maps those timings to either word-level or sentence-level SMIL fragments depending on `syncLevel`.

---

## 1. Text sent to TTS (same for word and sentence)

- **Source**: All text zones on the page, in **reading order**, joined with spaces.
- **Built from**: `allZoneGroups` → each group is either a single zone or a line-fragment group; content is joined so TTS receives one continuous string per page.
- **API**: `TtsService.synthesizePageAudio({ text: pageTextFromGroups || pageText, audioOutPath, voice, durationScaleFactor })`
- **Result**: One MP3 per page + `timings` array: one entry per **word** (from Google Cloud `enableTimePointing: ['WORD']`, or from gTTS `estimateWordTimings`).

So **word vs sentence does not change what text is sent or how many TTS calls are made**. It only changes how the same word-level timings are grouped when building SMIL.

---

## 2. Word level (`syncLevel === 'word'`)

- **Zones**: Each zone can be a single word (e.g. `p1_z1_w0`) or multiple words (e.g. a line).
- **Mapping**: For each zone, the code iterates over **each word** in `zone.content` and consumes **one TTS timing** per word:
  - `zoneWords.forEach((word, wordIdx) => { timing = ttsResult.timings[timingIndex]; smilFragments.push({ id: zone.id + "_w" + wordIdx, startTime, endTime }); timingIndex++; })`
- **SMIL**: One `<par>` fragment per word; IDs like `p1_z1_w0`, `p1_z1_w1`, …

So **word level = use each word timing as its own highlight span**.

---

## 3. Sentence level (`syncLevel === 'sentence'`)

- **Zones**: Each zone is typically a sentence (or line-fragment group representing a sentence).
- **Mapping**: For each zone, the code uses the **first** and **last** TTS timing for that zone’s word range:
  - `firstTiming = ttsResult.timings[timingIndex]`
  - `timingIndex += zoneWords.length`
  - `lastTiming = ttsResult.timings[timingIndex - 1]`
  - `smilFragments.push({ id: zone.id, startTime: firstTiming.startTimeSec, endTime: lastTiming.endTimeSec })`
- **SMIL**: One `<par>` fragment per zone (sentence); ID is the zone id (e.g. `p1_z1_s0`).

So **sentence level = one highlight span per zone, from first word’s start to last word’s end**.

---

## 4. TTS engine (TtsService)

| Path              | When used                    | Word timings |
|-------------------|------------------------------|--------------|
| Google Cloud TTS  | `GOOGLE_APPLICATION_CREDENTIALS` set | Real word timepoints from API |
| Free gTTS         | No credentials / `FORCE_FREE_TTS`   | `estimateWordTimings(text, duration)` (even distribution) |

- **Kitaboo** always calls `TtsService.synthesizePageAudio` (no direct gtts in KitabooFxlService).
- **Reflowable** uses `AudioSyncService.generateCompleteAudio`, which prefers Google Cloud (one call, word timings) then gtts (sentence-chunked to avoid 100-char staccato).

---

## 5. Summary

| Aspect           | Word level              | Sentence level                |
|-----------------|-------------------------|--------------------------------|
| TTS input       | Same (full page text)   | Same (full page text)          |
| TTS output      | Word-level timings      | Same word-level timings       |
| SMIL fragments  | One per word            | One per zone (sentence)       |
| Fragment times  | Each word’s start–end   | First word start → last word end |

So Kitaboo TTS is the same for both: **one natural TTS stream per page** with word timings; the only difference is how those timings are grouped into SMIL (per word vs per sentence).
