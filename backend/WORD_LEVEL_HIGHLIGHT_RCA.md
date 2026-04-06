# RCA: Word-Level Highlighting in Kitaboo FXL

## Summary

Word-level highlighting works by: (1) XHTML placing invisible `smil-target` spans plus visible `visible-word` spans, one pair per word; (2) SMIL telling the reader which `#id` to activate at each time range; (3) Thorium adding `-epub-media-overlay-active` to that element; (4) CSS highlighting the **next sibling** `.visible-word` when the preceding `.smil-target` has that class. The chain is correct when zones, TTS word order, and IDs align.

---

## 1. Data flow (where word IDs and boxes come from)

| Stage | Source | Output |
|-------|--------|--------|
| **Zones** | `KitabooFxlService.assembleFxlEpub` uses `page.zones` from `pagesData`. Zones come from the Kitaboo process or "Draw at selected level" (proportional or AI). | Each zone has `id`, `content`, `x,y,w,h`, `readingOrder`. Word-level: either one zone per word (`id` = e.g. `p1_z2_w0`) or multi-word zones (`id` = `p1_z2`, words from `content.split(/\s+/)` → `id_w0`, `id_w1`, …). |
| **XHTML** | `EpubGenerator.generateFxlPage(pageData, page.zones, { syncLevel })` | For `syncLevel === 'word'`: per zone, if one word → one pair `<span id="zone.id" class="smil-target">` + `<span class="visible-word">…</span>`. If many words → one pair per word with `id="${zone.id}_w${idx}"`. Order = zones sorted by `readingOrder`. |
| **SMIL** | `KitabooFxlService.assembleFxlEpub` builds `smilFragments` from TTS timings and zones. | `pageText = textZones.map(z => z.content).join(' ')` → TTS → `ttsResult.timings[]`. For word-level: iterate zones in order; for each zone, if 1 word push `{ id: zone.id, startTime, endTime }`, else push `{ id: zone.id_w0, … }`, … consuming `timingIndex` in the same order as words in `pageText`. |
| **OPF** | Same assembly. | Spine item for the page has `properties="svg media-overlay"` and `media-overlay="smilN"`. Manifest has `<meta property="media:active-class">-epub-media-overlay-active</meta>`. |

**Critical contract:** The same `page.zones` (and same sort) are used for XHTML and for SMIL. Word order in `pageText` must match zone order and per-zone word order, so `timingIndex` lines up with the IDs emitted in XHTML.

---

## 2. XHTML structure (what Thorium sees)

From `epubGenerator.js` `generateFxlPage`:

- Each word produces two **sibling** spans:
  1. `<span id="…" class="smil-target" style="position:absolute; …" aria-hidden="true"></span>`
  2. `<span class="visible-word" style="…">word text</span>`

- They sit inside `.page-container` (no `.kitaboo-atomic-wrap` wrapper in current output). Order is deterministic: all zones sorted by `readingOrder`, then per zone either one pair (single word) or N pairs for N words with ids `zone.id_w0` … `zone.id_wN-1`.

- The reader activates the element with `id` equal to the SMIL `<text src="pageN.xhtml#id"/>` fragment. So the element that gets `-epub-media-overlay-active` is always a `.smil-target` with that `id`.

---

## 3. CSS (how the yellow box appears)

From `epubGenerator.js` `generateFxlCss()`:

1. **Reset:** `:root { -epub-media-overlay-active-color: transparent !important }` so Thorium’s default overlay styling does not show on our elements.
2. **Target stays invisible:**  
   `.smil-target.-epub-media-overlay-active, .smil-target.smilActive, .smil-target.readium-smil-active { background: transparent !important; … }`  
   So the span that gets the active class never draws a highlight itself.
3. **Highlight on the next span:**  
   `.smil-target.-epub-media-overlay-active + .visible-word, … { background-color: #FFF59D !important; mix-blend-mode: multiply !important; color: transparent !important; -webkit-text-fill-color: transparent !important; opacity: 1 !important; … }`  
   So the **immediately following** `.visible-word` gets the yellow box. Because we always emit `smil-target` then `visible-word`, that next sibling is the right word.

Thorium uses the class name from `media:active-class` (`-epub-media-overlay-active`). The “+” selector is what makes the highlight follow the SMIL target without painting on the target span.

---

## 4. SMIL → reader behavior

- SMIL has `<par><text src="pageN.xhtml#p1_z1_w0"/><audio … clipBegin="0.000s" clipEnd="0.300s"/></par>` etc.
- The reader resolves `pageN.xhtml#p1_z1_w0`, finds the element with `id="p1_z1_w0"`, and applies the active class when that `<par>` is active (based on audio timing).
- So **word-level highlighting works** when:
  - Every SMIL fragment `#id` exists in the XHTML.
  - Each such `id` is on a `.smil-target` that is immediately followed by a `.visible-word` (no other elements in between).

---

## 5. TTS timing (potential bug)

**Google Cloud TTS** with `enableTimePointing: ['WORD']` returns one **start** timestamp per word (`timeSeconds`). There is no per-word end time in the API.

In `TtsService.js`, the Google path currently sets:

```js
startTimeSec: parseFloat((tp.timeSeconds || tp.time || 0).toFixed(3)),
endTimeSec: parseFloat((tp.timeSeconds || tp.time || 0).toFixed(3)) // same as start
```

So **every word gets `startTimeSec === endTimeSec`**. That makes SMIL clips like `clipBegin="0.5s" clipEnd="0.5s"` (zero duration). The fix is to set `endTimeSec[i] = startTimeSec[i+1]` for all but the last word, and for the last word use the next word’s start if available or an estimated end (e.g. `startTimeSec + 0.35`). This has been fixed in code so word-level SMIL clips have non-zero duration when using Google TTS.

**gTTS/free path:** `estimateWordTimings()` already distributes time and sets distinct start/end per word, so that path is fine.

---

## 6. Observed ID gaps (e.g. p1_z2_w3 missing)

In some outputs, XHTML and SMIL share the same **gaps** (e.g. `p1_z2_w0`, `p1_z2_w1`, `p1_z2_w2`, `p1_z2_w4`, `p1_z2_w5` with no `p1_z2_w3`). That means the **zone set** for that line never contained a zone for the 4th word (e.g. “a” in “If You Were a Horse 4”). So the source data (zoning / “Draw at selected level”) has one word missing, not the EPUB generator. As long as `pageText` and zones are built from the same set, SMIL and XHTML stay in sync. If you need every word highlighted, zoning must produce a zone for every word.

---

## 7. End-to-end chain (checklist)

| Step | Location | Check |
|------|----------|--------|
| 1. Same zones for XHTML and SMIL | `KitabooFxlService.assembleFxlEpub` | `generateFxlPage(…, page.zones, { syncLevel })` and `smilFragments` both use `textZones` from `page.zones` (filtered/sorted the same). |
| 2. Word order = timing order | Same | `pageText` = `textZones.map(z => z.content).join(' ')`; TTS returns timings in that word order; we consume `timingIndex` in zone order and per-zone word order. |
| 3. IDs match | XHTML vs SMIL | XHTML emits `zone.id` or `zone.id_w0`…; SMIL uses the same `id` in `<text src="…#id"/>`. |
| 4. Sibling structure | XHTML | Each `id` is on a `.smil-target` whose next sibling is a `.visible-word`. No wrapper or other node between them. |
| 5. OPF media overlay | `content.opf` | Page item has `media-overlay="smilN"`; metadata has `media:active-class` = `-epub-media-overlay-active`. |
| 6. TTS end times | `TtsService` | For Google, `endTimeSec` is derived from the next word’s start (or estimated for the last word), not copied from `timeSeconds`. |

When all of the above hold, word-level highlighting in Thorium (and other readers that follow EPUB Media Overlays + `media:active-class`) works as intended.
