# How We Extract Text and Send One Continuous String to the TTS API

This document traces the flow from your XHTML (e.g. `page_6.xhtml` with word spans) to the single string sent to the TTS API.

---

## 1. XHTML source (your file)

Example structure in `html_intermediate/job_183_html/page_6.xhtml`:

```html
<span class="sync-sentence" id="chapter3_page6_p1_s1" data-read-aloud="true">
  <span class="sync-word" id="chapter3_page6_p1_s1_w1">Have</span>
  <span class="sync-word" id="chapter3_page6_p1_s1_w2">you</span>
  <span class="sync-word" id="chapter3_page6_p1_s1_w3">ever</span>
  ...
</span>
```

---

## 2. Frontend: load sections and parse XHTML into elements

**Where:** `frontend/src/pages/SyncStudio.jsx`

When Sync Studio loads, it fetches sections (each section has `xhtml`). Then it parses every section’s XHTML and builds a flat list of elements (sentences and words).

### 2a. Sections come from API

- `getSyncStudio(jobId)` or `getEpubSections(jobId)` returns `sections[]`, each with `section.xhtml`.

### 2b. Parse each section’s XHTML → `parsedElements`

**Function:** `parseXhtmlElements(xhtml, sectionId, pageNumber)` (lines ~192–296)

- Uses `DOMParser` to parse the XHTML string.
- Selects all nodes with `data-read-aloud="true"`:
  - `doc.querySelectorAll('[data-read-aloud="true"]')`
- For each such element:
  - **Text:** `el.textContent?.trim()` → full text of that element (including all nested spans).
  - **ID:** `el.getAttribute('id')`.
  - **Type:** from class/id: `sync-word` / `_w` → word, `sync-sentence` / `_s` → sentence, else paragraph.
- Then, for each non-word element, it also finds **nested words**:
  - `el.querySelectorAll('.sync-word[id], span[id*="_w"]')`
  - For each word span: `wordText = wordEl.textContent?.trim()` (a single word).

So from your XHTML we get two kinds of entries:

- **Sentence-level:** e.g. `{ id: 'chapter3_page6_p1_s1', text: 'Have you ever wished you were a horse?', type: 'sentence', ... }`
- **Word-level:** e.g. `{ id: 'chapter3_page6_p1_s1_w1', text: 'Have', type: 'word', ... }`, `{ id: '..._w2', text: 'you', ... }`, etc.

All of these are pushed into one array and stored in state as **`parsedElements`** (see load flow around 1321–1331: `parseXhtmlElements(section.xhtml, ...)` and `setParsedElements(allElements)`).

So **extraction here = DOM parse + `textContent` per element**. No single “continuous string” yet; we have a list of elements, each with its own `text`.

---

## 3. Frontend: build `textBlocks` and send to backend

**Where:** `frontend/src/pages/SyncStudio.jsx` → `handleGenerateAudio` (lines ~1717–1775)

When the user clicks **Generate TTS**:

1. **Filter by Export Level (granularity)**  
   - Word: keep only elements with `type === 'word'` or `id.includes('_w')`.  
   - Sentence: keep only sentence-level.  
   - Paragraph: keep only paragraph-level.

2. **Filter out unspoken**  
   - Exclude blocks whose id/text match TOC, nav, footer, etc.

3. **Build the payload**  
   - `textBlocks = parsedElements.filter(...).map(el => ({ id: el.id, pageNumber: el.pageNumber, text: el.text }))`

So with **Export Level = word**, `textBlocks` looks like:

```js
[
  { id: 'chapter3_h1_s1_w1', pageNumber: 6, text: 'If' },
  { id: 'chapter3_h1_s1_w2', pageNumber: 6, text: 'You' },
  { id: 'chapter3_h1_s1_w3', pageNumber: 6, text: 'Were' },
  ...
  { id: 'chapter3_page6_p1_s1_w1', pageNumber: 6, text: 'Have' },
  { id: 'chapter3_page6_p1_s1_w2', pageNumber: 6, text: 'you' },
  ...
]
```

4. **Send to backend**  
   - `audioSyncService.generateAudio(pdfId, jobId, selectedVoice, textBlocks, level, ttsSpeakingRate)`  
   - Which calls `POST /api/audio-sync/generate` with body: `{ pdfId, jobId, voice, textBlocks, granularity, speakingRate }`.

So the **backend receives an array of chunks**, each with `id`, `pageNumber`, and **`text`** (one word or one sentence depending on granularity). Still no single string at this point.

---

## 4. Backend: receive `textBlocks` and build one string for TTS

**Where:** `backend/src/routes/audioSyncRoutes.js` and `backend/src/services/audioSyncService.js`

### 4a. Route (audioSyncRoutes.js, ~440–468)

- Reads `textBlocks` from `req.body`.
- Maps them to `textChunks`: `{ id, pageNumber, text }` (and optional sectionId/sectionTitle).
- Calls `AudioSyncService.generateCompleteAudio(textChunks, voice, pdfId, jobId, { speakingRate })`.

### 4b. One continuous string (audioSyncService.js)

**Natural TTS path (Google Cloud):** `_generateNaturalCompleteAudio` (lines ~269–341)

- **Extraction of the single string:**
  ```js
  const fullText = textChunks.map(c => (c.text || '').trim()).filter(Boolean).join(' ');
  ```
- So we take every chunk’s **`text`**, trim it, drop empty, and **join with a space**.  
  Example:  
  `['If','You','Were','a','Horse','Have','you','ever',...]` →  
  `"If You Were a Horse Have you ever wished you were a horse? ..."`

**Natural gtts path:** `_generateNaturalCompleteAudioWithGtts` (lines ~347–349)

- Same line:
  ```js
  const fullText = textChunks.map(c => (c.text || '').trim()).filter(Boolean).join(' ');
  ```

That **`fullText`** is the one continuous string sent to the TTS API (or to gtts). So:

- **Extraction on the backend** = take the `text` field from each item in `textChunks` (which came from the frontend `textBlocks`) and **join with spaces**. No re-parsing of XHTML on the server; we only use the text already extracted on the frontend.

---

## 5. Summary diagram

```
XHTML (page_6.xhtml)
  → Frontend: DOMParser + querySelectorAll('[data-read-aloud="true"]')
  → For each element: text = el.textContent (and nested .sync-word → one element per word)
  → parsedElements = [ { id, text: "If", type: "word" }, { id, text: "You", type: "word" }, ... ]

User clicks "Generate TTS" (Export Level = word)
  → textBlocks = filter(parsedElements by granularity) → [ { id, pageNumber, text: "If" }, { id, pageNumber, text: "You" }, ... ]
  → POST /api/audio-sync/generate { textBlocks, granularity, ... }

Backend
  → textChunks = textBlocks (with id, pageNumber, text)
  → fullText = textChunks.map(c => c.text).filter(Boolean).join(' ')
  → "If You Were a Horse Have you ever wished you were a horse? ..."
  → TtsService.synthesizePageAudio({ text: fullText, ... })   // one TTS call with one string
```

So: **we extract text in the frontend from the XHTML (via DOM + `textContent`), send chunks to the backend, then the backend builds the single continuous string by joining each chunk’s `text` with spaces and sends that one string to the TTS API.**
