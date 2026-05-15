
import argparse
import re
import sys
import json
import os
from pathlib import Path

# ── Structured error output helper ──────────────────────────────────────────
def _fatal(message, code="PYTHON_ERROR", details=None):
    """Print a structured JSON error to stderr and exit with code 1."""
    payload = {"success": False, "error": {"code": code, "message": message}}
    if details:
        payload["error"]["details"] = details
    print(json.dumps(payload), file=sys.stderr)
    sys.exit(1)

# ── Required: PyMuPDF ────────────────────────────────────────────────────────
try:
    import fitz  # PyMuPDF
except ImportError:
    _fatal(
        "PyMuPDF is not installed. Run: pip install PyMuPDF",
        code="MISSING_DEPENDENCY",
        details={"package": "PyMuPDF", "import_name": "fitz"}
    )

# ── Optional: OpenCV + NumPy (only needed for cleanup/image-processing modes) ─
_CV2_AVAILABLE = False
cv2 = None
np = None
try:
    import cv2 as _cv2
    import numpy as _np
    cv2 = _cv2
    np = _np
    _CV2_AVAILABLE = True
except ImportError:
    # cv2 is only required for --mode cleanup. render/extract/extract-images work without it.
    pass

# Line grouping: max y-distance (points) to treat two spans as same baseline. Scale with font size for tight/loose PDFs.
LINE_THRESHOLD_FACTOR = 0.3   # fraction of font size
LINE_THRESHOLD_MIN_PT = 1.5   # minimum (tight spacing)
LINE_THRESHOLD_MAX_PT = 6.0   # maximum (loose spacing)

def _line_threshold_for_font(font_size):
    """Return line threshold in points so tight/loose PDF line spacing groups correctly."""
    if font_size is None or font_size <= 0:
        font_size = 12
    return max(LINE_THRESHOLD_MIN_PT, min(float(font_size) * LINE_THRESHOLD_FACTOR, LINE_THRESHOLD_MAX_PT))

def render_pages(pdf_path, output_dir, dpi=150, page_from=1, page_to=None):
    """
    Phase 1: Render PDF pages to images.
    Default DPI is 150 — good balance of quality vs. speed/file-size.
    Use 300 only when pixel-perfect accuracy is required.
    page_from / page_to are 1-based inclusive indices; page_to=None renders through last page.
    """
    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        _fatal(f"Cannot open PDF: {e}", code="PDF_OPEN_ERROR", details={"path": pdf_path})

    Path(output_dir).mkdir(parents=True, exist_ok=True)

    total = len(doc)
    pf = max(1, int(page_from or 1))
    if page_to is None:
        pt = total
    else:
        pt = min(total, max(pf, int(page_to)))

    rendered_files = []
    zoom = dpi / 72  # 72 points per inch is standard PDF resolution
    mat = fitz.Matrix(zoom, zoom)

    for page_index in range(pf - 1, pt):
        page = doc[page_index]
        page_num = page_index + 1
        try:
            pix = page.get_pixmap(matrix=mat, alpha=False)
            output_file = Path(output_dir) / f"page_{page_num}.png"
            pix.save(str(output_file))
            rendered_files.append(str(output_file))
            print(f"Rendered page {page_num} to {output_file}", flush=True)
        except Exception as e:
            print(f"Warning: failed to render page {page_num}: {e}", file=sys.stderr, flush=True)

    return rendered_files

def extract_fonts(pdf_path, output_dir):
    """
    Extract embedded fonts from PDF and return a mapping list.
    """
    doc = fitz.open(pdf_path)
    font_dir = Path(output_dir) / "fonts"
    font_dir.mkdir(parents=True, exist_ok=True)
    
    mapping = {}
    
    # Track xrefs to avoid duplicates
    processed_xrefs = set()
    
    for page in doc:
        font_list = page.get_fonts()
        for font in font_list:
            xref = font[0]
            if xref in processed_xrefs:
                continue
            
            try:
                # font[3] is the font name from the PDF
                name, ext, _, content = doc.extract_font(xref)
                if content:
                    # Clean up font name for filename
                    clean_name = name.replace("+", "_").replace(" ", "_").replace("(", "").replace(")", "")
                    font_filename = f"{clean_name}.{ext}"
                    font_path = font_dir / font_filename
                    
                    with open(font_path, "wb") as f:
                        f.write(content)
                    
                    mapping[name] = font_filename
                    processed_xrefs.add(xref)
                    print(f"Extracted font: {name} as {font_filename}")
            except Exception as e:
                print(f"Could not extract font {xref}: {e}")
                
    # Save mapping to file
    mapping_path = Path(output_dir) / "fonts.json"
    with open(mapping_path, "w", encoding="utf-8") as f:
        json.dump(mapping, f, indent=2)
                
    return mapping

def color_to_hex(color_int):
    """
    Convert PyMuPDF color int (sRGB) to CSS hex.
    """
    if color_int is None:
        return "#000000"
    r = (color_int >> 16) & 255
    g = (color_int >> 8) & 255
    b = color_int & 255
    return f"#{r:02x}{g:02x}{b:02x}"

def _merge_bbox(bboxes):
    """Union of bboxes: (min x0, min y0, max x1, max y1)."""
    if not bboxes:
        return (0, 0, 0, 0)
    x0 = min(b[0] for b in bboxes)
    y0 = min(b[1] for b in bboxes)
    x1 = max(b[2] for b in bboxes)
    y1 = max(b[3] for b in bboxes)
    return (x0, y0, x1, y1)


def _bboxes_overlap(a, b, margin=2.0):
    """True if two bboxes (x0,y0,x1,y1) overlap or are within margin."""
    if not a or not b or len(a) < 4 or len(b) < 4:
        return False
    return not (a[2] + margin < b[0] or b[2] + margin < a[0] or
                a[3] + margin < b[1] or b[3] + margin < a[1])


def _bbox_overlap_fraction(a, b):
    """Overlap area as fraction of the smaller bbox's area. 0 = no overlap, 1 = full containment."""
    if not a or not b or len(a) < 4 or len(b) < 4:
        return 0.0
    x0 = max(a[0], b[0])
    y0 = max(a[1], b[1])
    x1 = min(a[2], b[2])
    y1 = min(a[3], b[3])
    if x1 <= x0 or y1 <= y0:
        return 0.0
    overlap = (x1 - x0) * (y1 - y0)
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    if area_a <= 0 or area_b <= 0:
        return 0.0
    return overlap / min(area_a, area_b)


def _deduplicate_glyph_words(extracted_items):
    """
    Remove duplicate words from glyph extraction (e.g. PDF outline + fill layers both emitting
    "Horses", "Up", "Close"). Same text + overlapping bbox => keep one word. Renumber word_id to 1,2,3,...
    """
    if not extracted_items:
        return extracted_items
    # Group by word_id (only items that have word_id)
    by_word = {}
    for it in extracted_items:
        wid = it.get("word_id")
        if wid is None:
            continue
        if wid not in by_word:
            by_word[wid] = []
        by_word[wid].append(it)
    if not by_word:
        return extracted_items
    # Per-word: text (joined), bbox (union), and position for reading order (y, x of first glyph)
    word_info = {}
    for wid, glyphs in by_word.items():
        text = "".join(g.get("text", "") for g in glyphs).strip()
        bboxes = [g.get("bbox") for g in glyphs if g.get("bbox") and len(g.get("bbox")) >= 4]
        if not bboxes:
            word_info[wid] = {"text": text, "bbox": None, "y": 0, "x": 0}
            continue
        union = _merge_bbox(bboxes)
        first_bbox = glyphs[0].get("bbox") or [0, 0, 0, 0]
        word_info[wid] = {"text": text, "bbox": union, "y": first_bbox[1], "x": first_bbox[0]}
    # Reading order: sort word_ids by (y, x)
    ordered_wids = sorted(by_word.keys(), key=lambda w: (word_info[w]["y"], word_info[w]["x"]))
    # Mark word_ids to keep: same text + high overlap => drop the later one in reading order
    OVERLAP_THRESHOLD = 0.5  # same text and >50% bbox overlap => duplicate (outline+fill)
    keep_wids = set()
    for wid in ordered_wids:
        info = word_info[wid]
        text = (info["text"] or "").strip()
        bbox = info["bbox"]
        if not text:
            keep_wids.add(wid)
            continue
        is_dup = False
        for kept in keep_wids:
            kinfo = word_info[kept]
            if (kinfo["text"] or "").strip() != text:
                continue
            if bbox and kinfo["bbox"] and _bbox_overlap_fraction(bbox, kinfo["bbox"]) > OVERLAP_THRESHOLD:
                is_dup = True
                break
        if not is_dup:
            keep_wids.add(wid)
    # Filter items to kept word_ids only
    filtered = [it for it in extracted_items if it.get("word_id") in keep_wids]
    # Renumber word_id to 1,2,3,... in reading order
    ordered_kept = [w for w in ordered_wids if w in keep_wids]
    old_to_new = {old: i for i, old in enumerate(ordered_kept, 1)}
    for it in filtered:
        if "word_id" in it:
            it["word_id"] = old_to_new[it["word_id"]]
    return filtered


def _infer_align(line_bbox, page_width, margin_pt=25):
    """
    Infer text alignment from line bbox relative to page width.
    Returns "left", "right", or "center".
    """
    if not line_bbox or page_width <= 0:
        return "left"
    x0, x1 = line_bbox[0], line_bbox[2]
    left_gap = x0
    right_gap = page_width - x1
    if right_gap <= margin_pt and left_gap > margin_pt:
        return "right"
    if left_gap <= margin_pt:
        return "left"
    return "center"


def _is_sentence_end(text):
    """True if text ends with a sentence terminator (. ? !)."""
    t = (text or "").strip()
    return len(t) > 0 and t[-1] in ".?!"


def _split_into_sentences(text):
    """Split text into list of sentences (split after . ? !). Returns list of non-empty strings.
    Runs of leader dots (e.g. ...............) are kept with the preceding segment so TOC lines
    like 'If You Were a Horse ............... 4' are not split into many one-dot 'sentences'.
    """
    if not (text or "").strip():
        return []
    parts = re.split(r"(?<=[.?!])\s*", text)
    out = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        # Merge runs of only dots (and optional spaces) with previous segment — preserves TOC leader dots
        if re.match(r"^[.\s]+$", p) and out:
            # Append dots/spaces directly (no extra space) so "Horse " + "......." stays correct
            out[-1] = out[-1] + p
        else:
            out.append(p)
    return out


def _looks_like_label(text, page_width, bbox):
    """
    Heuristic for diagram/glossary labels when running glyph extraction:
    - Single word (no spaces)
    - Short (<= 16 chars)
    - No sentence punctuation
    - Narrow compared to page width
    """
    t = (text or "").strip()
    if not t:
        return False
    if " " in t:
        return False
    if len(t) > 16:
        return False
    if any(ch in ".?!" for ch in t):
        return False
    try:
        x0, _, x1, _ = bbox
        span_width = abs(x1 - x0)
    except Exception:
        span_width = None
    if span_width is not None and page_width:
        # Labels are typically narrow, e.g. < 25% of page width
        if span_width > page_width * 0.25:
            return False
    return True


def _span_multiple_sentences_to_items(span_text, span_bbox, words_list, span_info, page_width=612):
    """
    When a span contains multiple sentences, use word bboxes to build one item per sentence
    with correct bbox/origin/lines so rendering matches the PDF (no missing words or wrong wrap).
    words_list: list of (x0, y0, x1, y1, "word", block_no, line_no, word_no)
    page_width: used to infer text align (left/right/center).
    Returns list of item dicts (same shape as flush_sentence items).
    """
    sb = span_bbox
    sx0, sy0, sx1, sy1 = sb
    # Words whose center falls inside the span bbox
    in_span = []
    for w in words_list:
        x0, y0, x1, y1, word_text, _, _, _ = w
        if not (word_text or word_text.strip()):
            continue
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        if sx0 <= mx <= sx1 and sy0 <= my <= sy1:
            in_span.append(w)
    if not in_span:
        return None
    # Sort by y then x (reading order)
    in_span.sort(key=lambda w: (round(w[1], 1), w[0]))
    # Build character ranges: map span_text to word positions
    pos = 0
    word_ranges = []  # ( (x0,y0,x1,y1), start_char, end_char )
    for w in in_span:
        word_text = w[4]
        idx = span_text.find(word_text, pos)
        if idx < 0:
            idx = pos
        word_ranges.append(((w[0], w[1], w[2], w[3]), idx, idx + len(word_text)))
        pos = idx + len(word_text)
    # Sentence boundaries in span_text (character end index per sentence)
    sentences = _split_into_sentences(span_text)
    if len(sentences) <= 1:
        return None
    acc = 0
    sent_end_indices = []
    for s in sentences:
        acc += len(s)
        sent_end_indices.append(acc)
        while acc < len(span_text) and span_text[acc:acc + 1].isspace():
            acc += 1
    # Assign each word to a sentence by its character range
    items_out = []
    for j, sent in enumerate(sentences):
        sent_start = 0 if j == 0 else sent_end_indices[j - 1]
        sent_end = sent_end_indices[j]
        words_j = [wr for wr in word_ranges if wr[1] < sent_end and wr[2] > sent_start]
        if not words_j:
            continue
        bboxes_j = [wr[0] for wr in words_j]
        x0_j = min(b[0] for b in bboxes_j)
        y0_j = min(b[1] for b in bboxes_j)
        x1_j = max(b[2] for b in bboxes_j)
        y1_j = max(b[3] for b in bboxes_j)
        origin = (x0_j, y0_j)
        merged_bbox = (x0_j, y0_j, x1_j, y1_j)
        # Group parts by line (same y) so we can render each line at correct position
        line_threshold = _line_threshold_for_font(span_info.get("size"))
        line_groups = []
        for wr in words_j:
            bbox_w = wr[0]
            y = bbox_w[1]
            if not line_groups or abs(y - line_groups[-1]["y"]) > line_threshold:
                line_groups.append({"y": y, "words": [wr]})
            else:
                line_groups[-1]["words"].append(wr)
        lines = []
        for g in line_groups:
            wds = g["words"]
            line_text = " ".join(span_text[wr[1]:wr[2]] for wr in wds)
            line_bboxes = [wr[0] for wr in wds]
            line_origin = (line_bboxes[0][0], line_bboxes[0][1])
            line_bbox_merged = _merge_bbox(line_bboxes)
            lines.append({
                "text": line_text,
                "bbox": list(line_bbox_merged),
                "origin": list(line_origin),
                "align": _infer_align(line_bbox_merged, page_width)
            })
        first_align = lines[0]["align"] if lines else "left"
        item = {
            "text": sent,
            "bbox": list(merged_bbox),
            "origin": list(origin),
            "align": first_align,
            "font": span_info["font"],
            "font_file": span_info["font_file"],
            "size": span_info["size"],
            "color": span_info["color"],
            "ascender": span_info.get("ascender", 0.8),
            "descender": span_info.get("descender", -0.2),
            "flags": span_info["flags"],
            "rotation": span_info["rotation"]
        }
        if len(lines) > 1:
            item["lines"] = lines
        items_out.append(item)
    return items_out if len(items_out) > 1 else None


def _join_sentence_text(parts_texts):
    """Join span texts into one string, inserting a single space only where needed.
    Strips every segment and normalizes all whitespace so PDF span trailing/leading spaces never produce ghost or double spaces."""
    if not parts_texts:
        return ""
    # Aggressive join: split on any whitespace, rejoin with single space, then collapse any \s+ (handles spans that already contain spaces).
    combined = " ".join((t or "").strip() for t in parts_texts if (t or "").strip())
    return re.sub(r"\s+", " ", combined).strip()


def extract_coords(pdf_path, output_json, extraction_level="sentence", font_list=None):
    """
    Phase 2: Extract text coordinates at sentence, word or glyph level.
    - sentence: proper sentences — only end at . ? ! (not at every capital, so "Horses Up" stays one segment until . ? !).
    - word:     one item per word using PyMuPDF word bboxes.
    - glyph:    one item per PDF character (span["chars"]) so Absolute HTML can replay glyph-level layout exactly.
    """
    import math
    doc = fitz.open(pdf_path)
    pages_data = []
    font_map = font_list or {}

    for page_num, page in enumerate(doc):
        width = page.rect.width
        height = page.rect.height
        # Use "rawdict" so we get character-level "chars" per span — preserves leader dots and exact PDF text as-is.
        # With "dict", span["text"] can be merged/collapsed; "rawdict" gives span["chars"] so we reconstruct exactly.
        raw = page.get_text("rawdict")
        raw_blocks = raw.get("blocks") or []
        blocks = raw_blocks
        # Build a parallel "dict"-like structure with span text from chars (preserve every character)
        blocks_for_dict = []
        for block in blocks:
            if block.get("type") != 0 or "lines" not in block:
                blocks_for_dict.append(block)
                continue
            new_lines = []
            for line in block["lines"]:
                new_spans = []
                for span in line["spans"]:
                    if "chars" in span:
                        span_text = "".join(c.get("c", "") for c in span["chars"])
                    else:
                        span_text = span.get("text", "")
                    new_span = {**span, "text": span_text}
                    if "chars" in new_span:
                        del new_span["chars"]
                    new_spans.append(new_span)
                new_lines.append({**line, "spans": new_spans})
            blocks_for_dict.append({**block, "lines": new_lines})
        blocks = blocks_for_dict
        words_list = page.get_text("words")  # (x0, y0, x1, y1, "word", block_no, line_no, word_no)

        if extraction_level == "glyph":
            # Glyph-level: one item per character using span["chars"] so we can replay glyph layout exactly.
            # word_id and sentence_id: in reading order across the whole page (do NOT reset per line).
            # Reset per page only (this loop is for page_num, page); so page 1 has 1,2,3..., page 2 has 1,2,3...
            extracted_items = []
            word_id = 0
            sentence_id = 0
            in_word = False
            prev_line_bottom = None
            prev_line_max_size = None
            for block in raw_blocks:
                if block.get("type") != 0 or "lines" not in block:
                    continue
                for line in block["lines"]:
                    in_word = False  # Break word at line boundary (PDFs often omit space between lines → avoid "wind.You", "mane.6")
                    direction = line.get("dir", (1, 0))
                    rotation = round(math.atan2(direction[1], direction[0]) * 180 / math.pi, 2)
                    # Precompute full line text so we can distinguish true single-word labels
                    line_chars = []
                    line_sizes = []
                    line_y0 = None
                    line_y1 = None
                    for _span in line["spans"]:
                        sz = _span.get("size", 12)
                        if sz:
                            line_sizes.append(sz)
                        sb = _span.get("bbox")
                        if sb and len(sb) >= 4:
                            line_y0 = sb[1] if line_y0 is None else min(line_y0, sb[1])
                            line_y1 = sb[3] if line_y1 is None else max(line_y1, sb[3])
                        for ch in _span.get("chars", []):
                            line_chars.append(ch.get("c", ""))
                            cb = ch.get("bbox")
                            if cb and len(cb) >= 4:
                                line_y0 = cb[1] if line_y0 is None else min(line_y0, cb[1])
                                line_y1 = cb[3] if line_y1 is None else max(line_y1, cb[3])
                    full_line_text = "".join(line_chars)
                    full_line_word_count = len(full_line_text.strip().split())
                    line_max_size = max(line_sizes) if line_sizes else 12
                    # New sentence when a line is far below the previous (image / layout gap) or font size jumps (heading vs body).
                    if prev_line_bottom is not None and line_y0 is not None and full_line_text.strip():
                        gap = line_y0 - prev_line_bottom
                        gap_thresh = max(prev_line_max_size or 12, line_max_size, 12) * 1.05
                        if gap > gap_thresh:
                            sentence_id += 1
                        elif prev_line_max_size and line_max_size:
                            ratio = line_max_size / prev_line_max_size
                            if ratio >= 1.22 or ratio <= 0.82:
                                sentence_id += 1

                    for span in line["spans"]:
                        font_name = span.get("font", "")
                        size = span.get("size", 12)
                        color = color_to_hex(span.get("color"))
                        flags = span.get("flags", 0)
                        low_font = font_name.lower()
                        if not (flags & 2) and any(k in low_font for k in ("bold", "black", "heavy")):
                            flags |= 2
                        if not (flags & 1) and any(k in low_font for k in ("italic", "oblique")):
                            flags |= 1
                        chars = span.get("chars", [])
                        # Standalone digit span (e.g. page number "8") gets its own sentence so title and page number are not concatenated.
                        span_text = "".join(c.get("c", "") for c in chars).strip()
                        is_page_number_span = bool(re.match(r"^\d+$", span_text))
                        # Diagram / glossary labels: short single-word spans on a line by themselves
                        # (e.g. "ear", "mane", "tail") should be their own sentence so sentence-level
                        # grouping produces one zone per label. Do NOT treat words inside normal
                        # sentences (multiple words on the same line) as labels.
                        is_label_span = (
                            full_line_word_count == 1
                            and _looks_like_label(span_text, width, span.get("bbox") or (0, 0, 0, 0))
                        )
                        # On the front cover, decorative badge text like "U P   C L O S E" can appear
                        # as spaced-out all-caps glyphs separated by spaces. Treat the whole sequence
                        # as ONE word so zoning can build a single "Close" zone instead of C L O S E.
                        is_cover_badge_span = (
                            page_num == 0
                            and bool(re.fullmatch(r"[A-Z](\s+[A-Z]){1,7}", span_text or ""))
                        )

                        if is_page_number_span or is_label_span:
                            sentence_id += 1
                        badge_word_id = None
                        if is_cover_badge_span:
                            # Reserve a single word_id for the whole spaced-out badge word.
                            word_id += 1
                            badge_word_id = word_id
                            in_word = True
                        for ch in chars:
                            c = ch.get("c", "")
                            if not c:
                                continue
                            if is_cover_badge_span:
                                # Skip spaces entirely; they should not break the badge word.
                                if c.isspace():
                                    continue
                                current_word_id = badge_word_id
                            else:
                                # Whitespace breaks current word but does not increment id itself
                                if c.isspace():
                                    in_word = False
                                    continue
                                # New word starts on first non-space after a gap
                                if not in_word:
                                    word_id += 1
                                    in_word = True
                                current_word_id = word_id
                            # This glyph belongs to the current sentence; punctuation ends it AFTER this glyph
                            current_sentence_id = sentence_id
                            bbox = ch.get("bbox") or span.get("bbox")
                            origin = ch.get("origin") or (bbox[0], bbox[1])
                            extracted_items.append({
                                "text": c,
                                "bbox": list(bbox),
                                "origin": list(origin),
                                "font": font_name,
                                "font_file": font_map.get(font_name),
                                "size": size,
                                "color": color,
                                "ascender": span.get("ascender", 0.8),
                                "descender": span.get("descender", -0.2),
                                "flags": flags,
                                "rotation": rotation,
                                "word_id": current_word_id,
                                "sentence_id": current_sentence_id,
                            })
                            if c in ".?!":
                                sentence_id += 1
                        if is_page_number_span or is_label_span:
                            sentence_id += 1
                    if line_y1 is not None:
                        prev_line_bottom = line_y1
                        prev_line_max_size = line_max_size
        elif extraction_level == "word":
            # Word-level: use get_text("words") and attach font/size from overlapping span in dict
            extracted_items = []
            for w in words_list:
                x0, y0, x1, y1, word_text, _, _, _ = w
                if not (word_text or word_text.strip()):
                    continue
                bbox = (x0, y0, x1, y1)
                font_name = ""
                font_file = None
                size = 10
                color = "#000000"
                flags = 0
                rotation = 0
                for block in blocks:
                    if "lines" not in block:
                        continue
                    for line in block["lines"]:
                        for span in line["spans"]:
                            if not span["text"]:
                                continue
                            sb = span["bbox"]
                            # overlap: word center inside span bbox
                            wx = (x0 + x1) / 2
                            wy = (y0 + y1) / 2
                            if sb[0] <= wx <= sb[2] and sb[1] <= wy <= sb[3]:
                                font_name = span.get("font", "")
                                size = span["size"]
                                color = color_to_hex(span.get("color"))
                                flags = span.get("flags", 0)
                                low_font = font_name.lower()
                                if not (flags & 2) and ("bold" in low_font or "black" in low_font or "heavy" in low_font):
                                    flags |= 2
                                if not (flags & 1) and ("italic" in low_font or "oblique" in low_font):
                                    flags |= 1
                                direction = line.get("dir", (1, 0))
                                rotation = round(math.atan2(direction[1], direction[0]) * 180 / math.pi, 2)
                                break
                    else:
                        continue
                    break
                extracted_items.append({
                    "text": word_text,
                    "bbox": list(bbox),
                    "origin": (x0, y0),
                    "font": font_name,
                    "font_file": font_map.get(font_name),
                    "size": size,
                    "color": color,
                    "ascender": 0.8,
                    "descender": -0.2,
                    "flags": flags,
                    "rotation": rotation
                })
        else:
            # Sentence-level: one block per sentence. Flush at . ? ! and when new line starts with capital → 2 blocks: "Horses... muscles." and "A horse... back."
            extracted_items = []
            sentence_parts = []  # list of (text, bbox, span_info)

            def flush_sentence():
                if not sentence_parts:
                    return
                texts = [p[0] for p in sentence_parts]
                bboxes = [p[1] for p in sentence_parts]
                info = sentence_parts[0][2]
                combined_text = _join_sentence_text(texts)
                merged_bbox = list(_merge_bbox(bboxes))
                first_origin = (bboxes[0][0], bboxes[0][1]) if bboxes else (0, 0)
                # Group parts by line (same y) so we can render each line at correct position
                line_threshold = _line_threshold_for_font(info.get("size"))
                line_groups = []
                for p in sentence_parts:
                    text, bbox, _ = p
                    y = bbox[1]
                    if not line_groups or abs(y - line_groups[-1]["y"]) > line_threshold:
                        line_groups.append({"y": y, "parts": [p]})
                    else:
                        line_groups[-1]["parts"].append(p)
                lines = []
                for g in line_groups:
                    parts = g["parts"]
                    line_texts = [p[0] for p in parts]
                    line_bboxes = [p[1] for p in parts]
                    line_text = _join_sentence_text(line_texts)
                    line_bbox_merged = _merge_bbox(line_bboxes)
                    # Preserve exact PDF position: use first span's bbox for this line's origin.
                    line_origin = (line_bboxes[0][0], line_bboxes[0][1]) if line_bboxes else (0, 0)
                    line_align = _infer_align(line_bbox_merged, width)
                    lines.append({
                        "text": line_text,
                        "bbox": list(line_bbox_merged),
                        "origin": list(line_origin),
                        "align": line_align
                    })
                first_align = lines[0]["align"] if lines else "left"
                item = {
                    "text": combined_text,
                    "bbox": merged_bbox,
                    "origin": list(first_origin),
                    "align": first_align,
                    "font": info["font"],
                    "font_file": info["font_file"],
                    "size": info["size"],
                    "color": info["color"],
                    "ascender": info.get("ascender", 0.8),
                    "descender": info.get("descender", -0.2),
                    "flags": info["flags"],
                    "rotation": info["rotation"]
                }
                if len(lines) > 1:
                    item["lines"] = lines
                # Skip exact duplicate items (same text + same bbox) so "C l o s e" etc. don't appear twice in coords.
                if extracted_items:
                    last = extracted_items[-1]
                    if (last.get("text") == combined_text and
                            _bboxes_overlap(last.get("bbox", []), merged_bbox)):
                        sentence_parts.clear()
                        return
                extracted_items.append(item)
                sentence_parts.clear()

            for block in blocks:
                if "lines" not in block:
                    continue
                for line in block["lines"]:
                    direction = line.get("dir", (1, 0))
                    rotation = round(math.atan2(direction[1], direction[0]) * 180 / math.pi, 2)
                    for span in line["spans"]:
                        if not span["text"]:
                            continue
                        text = span["text"]
                        bbox = span["bbox"]
                        font_name = span.get("font", "")
                        flags = span.get("flags", 0)
                        low_font = font_name.lower()
                        if not (flags & 2) and ("bold" in low_font or "black" in low_font or "heavy" in low_font):
                            flags |= 2
                        if not (flags & 1) and ("italic" in low_font or "oblique" in low_font):
                            flags |= 1
                        span_info = {
                            "font": font_name,
                            "font_file": font_map.get(font_name),
                            "size": span["size"],
                            "color": color_to_hex(span.get("color")),
                            "ascender": span.get("ascender", 0.8),
                            "descender": span.get("descender", -0.2),
                            "flags": flags,
                            "rotation": rotation,
                        }
                        # If this single span contains multiple sentences, use word bboxes so each sentence has correct position and lines.
                        multi = _span_multiple_sentences_to_items(text, bbox, words_list, span_info, width)
                        if multi:
                            flush_sentence()
                            extracted_items.extend(multi)
                            continue
                        # Page number: flush before and after so title and page number are separate zones (prevents elongated zone).
                        if re.match(r"^\d+$", (text or "").strip()):
                            flush_sentence()
                            sentence_parts.append((text, bbox, span_info))
                            flush_sentence()
                            continue
                        # Flush on significant vertical gap (new line) so each PDF line keeps exact position and style.
                        # Use a realistic line threshold (pts) so "Teacher Created Materials", "5301 Oceanus Drive", "ISBN..." stay separate.
                        line_threshold_pts = 5.0
                        if sentence_parts:
                            last_y = sentence_parts[-1][1][1]
                            if bbox[1] - last_y > line_threshold_pts:
                                flush_sentence()
                        # Also flush when new line starts with capital (new sentence)
                        line_threshold = _line_threshold_for_font(span_info.get("size"))
                        if sentence_parts:
                            last_y = sentence_parts[-1][1][1]
                            if abs(bbox[1] - last_y) > line_threshold:
                                first_char = (text or "").strip()[:1]
                                if first_char and first_char.isupper():
                                    flush_sentence()
                        # Same horizontal line but period/cap boundary: "Sentence1. Sentence2" → two zones so they can be separate (e.g. zone 9 and 10).
                        if sentence_parts:
                            last_text, last_bbox, _ = sentence_parts[-1]
                            last_y = last_bbox[1]
                            if abs(bbox[1] - last_y) <= line_threshold and (last_text or "").strip().endswith((".", "?", "!")):
                                first_char = (text or "").strip()[:1]
                                if first_char and first_char.isupper():
                                    flush_sentence()
                        # Skip duplicate PDF layer (e.g. cover: outline + fill both "Horses") so we don't output "Horses Horses".
                        # Only skip when overlap is significant (>0.5) so side-by-side "Up" "Up" in "Up Up Close" is kept.
                        if sentence_parts:
                            last_text, last_bbox, _ = sentence_parts[-1]
                            if (text or "").strip() == (last_text or "").strip() and _bbox_overlap_fraction(last_bbox, bbox) > 0.5:
                                continue
                        sentence_parts.append((text, bbox, span_info))
                        if _is_sentence_end(text):
                            flush_sentence()
            flush_sentence()

        # Glyph extraction: drop duplicate words (e.g. outline + fill layers → one "Horses", one "Up", one "Close")
        if extraction_level == "glyph" and extracted_items:
            extracted_items = _deduplicate_glyph_words(extracted_items)

        pages_data.append({
            "page": page_num + 1,
            "width": width,
            "height": height,
            "items": extracted_items
        })

    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(pages_data, f, indent=2, ensure_ascii=False)
    print(f"Extracted coordinates to {output_json} (level={extraction_level})")
    return pages_data

def get_dominant_color(img, x0, y0, x1, y1):
    """
    Sample pixels VERY close to the bbox to find the local background.
    Requires OpenCV (cv2). Returns white if cv2 is unavailable.
    """
    if not _CV2_AVAILABLE:
        return (255, 255, 255)
    h, w = img.shape[:2]
    samples = []
    # Tight 10px border to avoid hitting distant banners/graphics
    border = 10
    for x in range(max(0, x0-border), min(w, x1+border)):
        if y0 > border: samples.append(img[y0-border, x])
        if y1 < h-border: samples.append(img[min(h-1, y1+border), x])
    for y in range(max(0, y0-border), min(h, y1+border)):
        if x0 > border: samples.append(img[y, x0-border])
        if x1 < w-border: samples.append(img[y, min(w-1, x1+border)])
        
    if not samples:
        return (255, 255, 255)
        
    samples = np.array(samples)
    return [int(c) for c in np.median(samples, axis=0)]


def _build_contour_bubble_mask(roi, bg_color_bgr, threshold=10, dilate_size=5, min_contour_area=15):
    """
    Build a mask that follows the shape of text (contour-based) and dilates it
    into a smooth "bubble" for solid fill. Uses elliptical kernel so the result
    is not rectangular.
    - roi: BGR image region (numpy array)
    - bg_color_bgr: (B, G, R) tuple for background
    - threshold: color difference threshold; lower = tighter mask around letters
    - dilate_size: kernel size for dilation (smooth bubble); larger = more expansion
    - min_contour_area: ignore tiny contours (noise) below this many pixels
    Returns: binary mask (uint8, 255 where to fill) same shape as roi.
    """
    diff = cv2.absdiff(roi, np.array(bg_color_bgr, dtype=np.uint8))
    diff_gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
    _, text_mask = cv2.threshold(diff_gray, threshold, 255, cv2.THRESH_BINARY)
    if np.sum(text_mask == 255) == 0:
        return text_mask

    # Contour-based: find connected components of text, drop noise, then dilate
    contours, _ = cv2.findContours(
        text_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    contour_mask = np.zeros_like(text_mask)
    for c in contours:
        if cv2.contourArea(c) < min_contour_area:
            continue
        cv2.drawContours(contour_mask, [c], -1, 255, -1)

    # If no contours passed the area filter, fall back to original text mask
    if np.sum(contour_mask == 255) == 0:
        contour_mask = text_mask.copy()

    # Dilate with elliptical kernel for a smooth "bubble" around each letter
    # (avoids rectangular/boxy artifacts from a square kernel)
    k = max(3, int(dilate_size))
    if k % 2 == 0:
        k += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    bubble_mask = cv2.dilate(contour_mask, kernel, iterations=1)
    return bubble_mask


def build_text_mask_from_coords(image, page_data):
    """
    Build mask from coords.json only. No morphology, no thresholding, no edge
    detection. Removes exactly the PDF text bounding boxes so graphics (banner,
    horse, magnifying glass) stay intact.
    """
    h, w = image.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)

    if not page_data or "items" not in page_data:
        return mask

    pw = page_data.get("width") or w
    ph = page_data.get("height") or h
    scale_x = w / pw
    scale_y = h / ph

    for item in page_data["items"]:
        bbox = item.get("bbox")
        if not bbox or len(bbox) < 4:
            continue
        x1 = max(0, int(bbox[0] * scale_x))
        y1 = max(0, int(bbox[1] * scale_y))
        x2 = min(w, int(bbox[2] * scale_x))
        y2 = min(h, int(bbox[3] * scale_y))
        if x2 > x1 and y2 > y1:
            cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)

    # Small dilation to fully cover glyph edges
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)
    return mask


def banner_gradient_fill(img, mask):
    """
    Per region: wide banner (>40% page width) -> copy gradient from clean
    vertical column; small text over image -> inpaint. Works for cover + body.
    """
    result = img.copy()
    h, w = img.shape[:2]
    num_labels, labels = cv2.connectedComponents(mask)

    for label in range(1, num_labels):
        region_mask = (labels == label).astype(np.uint8) * 255
        ys, xs = np.where(region_mask == 255)
        if len(xs) == 0:
            continue

        x1, x2 = int(xs.min()), int(xs.max())
        y1, y2 = int(ys.min()), int(ys.max())

        if (x2 - x1) > w * 0.4:
            sample_x = max(0, x1 - 10)
            for i in range(y1, y2 + 1):
                color = img[i, sample_x]
                row_slice = result[i, x1:x2 + 1]
                row_mask = region_mask[i, x1:x2 + 1]
                row_slice[row_mask == 255] = color
        else:
            result = cv2.inpaint(result, region_mask, 5, cv2.INPAINT_TELEA)

    return result


def cleanup_images(image_dir, coords_json, output_dir=None, cleanup_threshold=10, cleanup_dilate=5):
    """
    Remove only coords.json text boxes. Page 1 (cover) is never cleaned — original
    kept intact, text overlaid in FXL. Other pages: wide banners use gradient copy,
    small regions use inpaint.
    Requires OpenCV (cv2). Skips cleanup gracefully if cv2 is unavailable.
    """
    if not _CV2_AVAILABLE:
        print(
            "Warning: OpenCV (cv2) is not installed — image cleanup skipped. "
            "Install with: pip install opencv-python-headless",
            file=sys.stderr, flush=True
        )
        return
    if not output_dir:
        output_dir = image_dir
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    with open(coords_json, "r", encoding="utf-8") as f:
        pages_data = json.load(f)

    for page_data in pages_data:
        page_num = page_data["page"]
        image_path = Path(image_dir) / f"page_{page_num}.png"
        if not image_path.exists():
            continue

        img = cv2.imread(str(image_path))
        if img is None:
            continue

        out_path = Path(output_dir) / f"page_{page_num}_clean.png"
        if out_path.exists():
            print(f"Page {page_num}: keeping existing clean image (user-provided).")
            continue

        # Cover (page 1): keep original intact; FXL overlays text layer on top
        if page_num == 1:
            cv2.imwrite(str(out_path), img)
            print(f"Page 1 (cover): keeping original image intact (text overlay in FXL).")
            continue

        work_img = img.copy()
        blend_mask = build_text_mask_from_coords(work_img, page_data)
        mask_pixels = np.sum(blend_mask == 255)

        if mask_pixels < 10:
            print(f"Page {page_num}: no coords boxes ({mask_pixels}px), writing original.")
            cv2.imwrite(str(out_path), work_img)
            continue

        print(f"Cleaning page {page_num} (coords-only mask, {mask_pixels}px)...")
        try:
            cleaned_img = banner_gradient_fill(work_img, blend_mask)
            cv2.imwrite(str(out_path), cleaned_img)
            print(f"Cleanup saved to {out_path} ({mask_pixels}px)")
        except Exception as e:
            print(f"Cleanup error page {page_num}: {e}")
            cv2.imwrite(str(out_path), work_img)

def extract_embedded_images(pdf_path, output_dir):
    """
    Extract embedded images per page using PyMuPDF.
    Saves files as: page_{page_num}_image_{idx}.png
    Also writes embedded_images.json into output_dir for downstream indexing.
    """
    doc = fitz.open(pdf_path)
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    pages_map = {}  # page_num -> list of {index, fileName, width, height}

    for page_num, page in enumerate(doc, start=1):
        try:
            images = page.get_images(full=True)  # tuple list, first element is xref
        except Exception:
            images = []

        if not images:
            continue

        # Deduplicate same xref on the same page.
        seen_xrefs = set()
        page_list = []

        for idx, img in enumerate(images, start=1):
            try:
                xref = img[0]
                if xref in seen_xrefs:
                    continue
                seen_xrefs.add(xref)

                # Convert the underlying image object to PNG.
                pix = fitz.Pixmap(doc, xref)
                file_name = f"page_{page_num}_image_{idx}.png"
                file_path = out / file_name
                # Pixmap.save infers the format from the filename extension.
                pix.save(str(file_path))

                page_list.append({
                    "index": idx,
                    "fileName": file_name,
                    "width": int(pix.width),
                    "height": int(pix.height)
                })
            except Exception:
                continue

        if page_list:
            pages_map[page_num] = page_list

    result = {
        "totalPages": doc.page_count,
        "pages": pages_map
    }
    with open(out / "embedded_images.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print(json.dumps(result))
    return result


def main():
    parser = argparse.ArgumentParser(description="PDF Processor using PyMuPDF and OpenCV")
    parser.add_argument("--pdf", required=True, help="Path to PDF file")
    parser.add_argument("--output-dir", required=True, help="Output directory")
    parser.add_argument("--mode", choices=["render", "extract", "cleanup", "extract-images", "all"], default="all")
    parser.add_argument("--dpi", type=int, default=150, help="DPI for rendering (default: 150)")
    parser.add_argument("--page-from", type=int, default=1, help="1-based first page to render (inclusive, default: 1)")
    parser.add_argument("--page-to", type=int, default=None, help="1-based last page to render (inclusive); omit for all pages")
    parser.add_argument("--coords-json", help="Path to JSON file for coordinates (required for cleanup)")
    parser.add_argument("--extraction-level", choices=["sentence", "word", "glyph"], default="sentence",
                        help="Coordinate extraction level: sentence (end at .?!), word, or glyph (one item per character)")
    parser.add_argument("--cleanup-threshold", type=int, default=10,
                        help="Color difference threshold for text mask; lower = tighter mask (default 10)")
    parser.add_argument("--cleanup-dilate", type=int, default=5,
                        help="Dilation kernel size for contour bubble; larger = more expansion (default 5)")

    args = parser.parse_args()

    # Validate cleanup mode requires cv2
    if args.mode in ["cleanup", "all"] and not _CV2_AVAILABLE:
        print(
            "Warning: OpenCV (cv2) not installed — cleanup step will be skipped. "
            "To enable: pip install opencv-python-headless",
            file=sys.stderr, flush=True
        )

    pdf_path = args.pdf

    # Validate PDF exists
    if not Path(pdf_path).exists():
        _fatal(f"PDF file not found: {pdf_path}", code="FILE_NOT_FOUND", details={"path": pdf_path})

    output_dir = args.output_dir

    try:
        if args.mode in ["render", "all"]:
            print("Starting Render Phase...", flush=True)
            render_pages(
                pdf_path,
                output_dir,
                args.dpi,
                page_from=args.page_from,
                page_to=args.page_to,
            )

        if args.mode in ["extract", "all"]:
            print("Starting Extraction Phase...", flush=True)
            json_path = args.coords_json or str(Path(output_dir) / "coords.json")
            font_mapping = extract_fonts(pdf_path, output_dir)
            level = getattr(args, "extraction_level", "sentence") or "sentence"
            extract_coords(pdf_path, json_path, extraction_level=level, font_list=font_mapping)
            # If running 'all', pass this json to next step
            args.coords_json = json_path

        if args.mode in ["cleanup", "all"]:
            print("Starting Cleanup Phase...", flush=True)
            if not args.coords_json:
                args.coords_json = str(Path(output_dir) / "coords.json")
                if not Path(args.coords_json).exists():
                    print("Warning: Coordinates JSON not found. Skipping cleanup.", file=sys.stderr, flush=True)
                else:
                    cleanup_images(
                        output_dir,
                        args.coords_json,
                        cleanup_threshold=getattr(args, "cleanup_threshold", 10),
                        cleanup_dilate=getattr(args, "cleanup_dilate", 5),
                    )
            else:
                cleanup_images(
                    output_dir,
                    args.coords_json,
                    cleanup_threshold=getattr(args, "cleanup_threshold", 10),
                    cleanup_dilate=getattr(args, "cleanup_dilate", 5),
                )

        if args.mode in ["extract-images"]:
            print("Starting Embedded Images Extraction Phase...", flush=True)
            extract_embedded_images(pdf_path, output_dir)

    except SystemExit:
        raise
    except Exception as e:
        _fatal(str(e), code="PROCESSING_ERROR", details={"mode": args.mode, "pdf": pdf_path})
if __name__ == "__main__":
    main()
