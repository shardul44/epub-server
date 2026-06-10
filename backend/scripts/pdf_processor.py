import argparse
import re
import fitz  # PyMuPDF
import cv2   # OpenCV
import numpy as np
from pathlib import Path
import json
import os

# Line grouping: max y-distance (points) to treat two spans as same baseline. Scale with font size for tight/loose PDFs.
LINE_THRESHOLD_FACTOR = 0.3   # fraction of font size
LINE_THRESHOLD_MIN_PT = 1.5   # minimum (tight spacing)
LINE_THRESHOLD_MAX_PT = 6.0   # maximum (loose spacing)

# Split after .?! only when followed by a new sentence (capital/quote/paren), skipping common abbreviations.
_SENTENCE_BOUNDARY = re.compile(
    r"(?<!\bMr\.)(?<!\bDr\.)(?<!\bMs\.)(?<!\bMrs\.)(?<!\bCol\.)(?<!\bGen\.)"
    r"(?<!\be\.g\.)(?<!\bi\.e\.)(?<=[.?!])\s+(?=[A-Z\"'\(])"
)

def _line_threshold_for_font(font_size):
    """Return line threshold in points so tight/loose PDF line spacing groups correctly."""
    if font_size is None or font_size <= 0:
        font_size = 12
    return max(LINE_THRESHOLD_MIN_PT, min(float(font_size) * LINE_THRESHOLD_FACTOR, LINE_THRESHOLD_MAX_PT))


def _resolve_page_range(doc, page_from=None, page_to=None):
    total = doc.page_count
    start = 1 if page_from is None else max(1, int(page_from))
    end = total if page_to is None else min(total, int(page_to))
    if start > end or total <= 0:
        return []
    return list(range(start - 1, end))


def render_pages(pdf_path, output_dir, dpi=300, page_from=None, page_to=None):
    doc = fitz.open(pdf_path)
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    rendered_files = []
    zoom = dpi / 72
    mat = fitz.Matrix(zoom, zoom)
    page_indices = _resolve_page_range(doc, page_from, page_to)
    if not page_indices:
        print("Warning: no pages in requested range.")
        doc.close()
        return rendered_files
    if page_from is not None or page_to is not None:
        print(f"Rendering pages {page_indices[0] + 1}–{page_indices[-1] + 1} of {doc.page_count}")
    for page_num in page_indices:
        page = doc[page_num]
        pix = page.get_pixmap(matrix=mat, alpha=False)
        output_file = Path(output_dir) / f"page_{page_num + 1}.png"
        pix.save(str(output_file))
        rendered_files.append(str(output_file))
        print(f"Rendered page {page_num + 1} to {output_file}")
    doc.close()
    return rendered_files

def extract_fonts(pdf_path, output_dir):
    doc = fitz.open(pdf_path)
    font_dir = Path(output_dir) / "fonts"
    font_dir.mkdir(parents=True, exist_ok=True)
    mapping = {}
    processed_xrefs = set()
    for page in doc:
        font_list = page.get_fonts()
        for font in font_list:
            xref = font[0]
            if xref in processed_xrefs:
                continue
            try:
                name, ext, _, content = doc.extract_font(xref)
                if content:
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
    mapping_path = Path(output_dir) / "fonts.json"
    with open(mapping_path, "w", encoding="utf-8") as f:
        json.dump(mapping, f, indent=2)
    return mapping

def color_to_hex(color_int):
    if color_int is None:
        return "#000000"
    r = (color_int >> 16) & 255
    g = (color_int >> 8) & 255
    b = color_int & 255
    return f"#{r:02x}{g:02x}{b:02x}"

def _merge_bbox(bboxes):
    if not bboxes:
        return (0, 0, 0, 0)
    x0 = min(b[0] for b in bboxes)
    y0 = min(b[1] for b in bboxes)
    x1 = max(b[2] for b in bboxes)
    y1 = max(b[3] for b in bboxes)
    return (x0, y0, x1, y1)


def _bboxes_overlap(a, b, margin=2.0):
    if not a or not b or len(a) < 4 or len(b) < 4:
        return False
    return not (a[2] + margin < b[0] or b[2] + margin < a[0] or
                a[3] + margin < b[1] or b[3] + margin < a[1])


def _bbox_overlap_fraction(a, b):
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
    if not extracted_items:
        return extracted_items
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
    wid_first_idx = {}
    for idx, it in enumerate(extracted_items):
        wid = it.get("word_id")
        if wid is not None and wid not in wid_first_idx:
            wid_first_idx[wid] = idx
    word_info = {}
    for wid, glyphs in by_word.items():
        text = "".join(g.get("text", "") for g in glyphs).strip()
        bboxes = [g.get("bbox") for g in glyphs if g.get("bbox") and len(g.get("bbox")) >= 4]
        if not bboxes:
            word_info[wid] = {"text": text, "bbox": None}
            continue
        union = _merge_bbox(bboxes)
        word_info[wid] = {"text": text, "bbox": union}
    ordered_wids = sorted(by_word.keys(), key=lambda w: wid_first_idx.get(w, float("inf")))
    OVERLAP_THRESHOLD = 0.5
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
    filtered = [it for it in extracted_items if it.get("word_id") in keep_wids]
    ordered_kept = [w for w in ordered_wids if w in keep_wids]
    old_to_new = {old: i for i, old in enumerate(ordered_kept, 1)}
    for it in filtered:
        if "word_id" in it:
            it["word_id"] = old_to_new[it["word_id"]]
    return filtered


def _infer_align(line_bbox, page_width, margin_pt=25):
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
    t = (text or "").strip()
    return len(t) > 0 and t[-1] in ".?!"


def _split_into_sentences(text):
    if not (text or "").strip():
        return []
    parts = _SENTENCE_BOUNDARY.split(text)
    out = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if re.match(r"^[.\s]+$", p) and out:
            out[-1] = out[-1] + p
        else:
            out.append(p)
    return out


def _looks_like_label(text, page_width, bbox):
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
        if span_width > page_width * 0.25:
            return False
    return True


def _span_multiple_sentences_to_items(span_text, span_bbox, words_list, span_info, page_width=612):
    sb = span_bbox
    sx0, sy0, sx1, sy1 = sb
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
    in_span.sort(key=lambda w: (round(w[1], 1), w[0]))
    pos = 0
    word_ranges = []
    for w in in_span:
        word_text = w[4]
        idx = span_text.find(word_text, pos)
        if idx < 0:
            idx = pos
        word_ranges.append(((w[0], w[1], w[2], w[3]), idx, idx + len(word_text)))
        pos = idx + len(word_text)
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
    if not parts_texts:
        return ""
    combined = " ".join((t or "").strip() for t in parts_texts if (t or "").strip())
    return re.sub(r"\s+", " ", combined).strip()


# ─────────────────────────────────────────────────────────────────────────────
# READING ORDER / COLUMN DETECTION
# ─────────────────────────────────────────────────────────────────────────────

def _row_x_bounds(row):
    return min(s["bbox"][0] for s in row), max(s["bbox"][2] for s in row)


def _row_is_right_callout(row, page_width):
    if not page_width:
        return False
    min_x, max_x = _row_x_bounds(row)
    return min_x >= page_width * 0.50 and (max_x - min_x) <= page_width * 0.42


def _row_is_left_main(row, page_width):
    if not page_width:
        return False
    min_x, _ = _row_x_bounds(row)
    return min_x <= page_width * 0.38


def _section_has_callout_rows(rows, page_width):
    return any(_row_is_right_callout(r, page_width) for r in rows)


def _segment_spans_into_layout_blocks(spans, page_width=None):
    """
    Group spans into macro layout sections (e.g. a two-column credit box, then a
    full-width paragraph). Rows are clustered first so normal line spacing does
    not split a multi-row column block into one block per line.
    """
    if not spans:
        return []

    if page_width is None:
        page_width = max(s["bbox"][2] for s in spans)

    rows = _cluster_spans_into_rows(spans)
    rows.sort(key=lambda r: min(s["bbox"][1] for s in r))

    heights = [max(s["bbox"][3] - s["bbox"][1] for s in row) for row in rows]
    median_h = sorted(heights)[len(heights) // 2] if heights else 12.0
    section_gap = max(median_h * 1.5, 20.0)

    blocks = []
    current_rows = []
    section_bottom = 0.0

    for row in rows:
        row_top = min(s["bbox"][1] for s in row)
        row_bottom = max(s["bbox"][3] for s in row)

        if not current_rows:
            current_rows.append(row)
            section_bottom = row_bottom
        elif row_top > section_bottom + section_gap:
            blocks.append([s for r in current_rows for s in r])
            current_rows = [row]
            section_bottom = row_bottom
        elif (
            _section_has_callout_rows(current_rows, page_width)
            and _row_is_left_main(row, page_width)
            and row_top > section_bottom + 8.0
        ):
            blocks.append([s for r in current_rows for s in r])
            current_rows = [row]
            section_bottom = row_bottom
        else:
            current_rows.append(row)
            section_bottom = max(section_bottom, row_bottom)

    if current_rows:
        blocks.append([s for r in current_rows for s in r])

    return blocks


def _span_center_x(span):
    return (span["bbox"][0] + span["bbox"][2]) / 2.0


def _block_layout_column(block_spans, page_boundaries):
    """Assign a layout block to a page column via its leftmost span (not center)."""
    if not page_boundaries or not block_spans:
        return 0
    left_x = min(s["bbox"][0] for s in block_spans)
    for i, boundary in enumerate(page_boundaries):
        if left_x < boundary:
            return i
    return len(page_boundaries)


def _is_dense_text_block(block_spans, block_width):
    if len(block_spans) <= 20:
        return False
    avg_w = sum(s["bbox"][2] - s["bbox"][0] for s in block_spans) / len(block_spans)
    return avg_w < block_width * 0.08


def _is_genuine_multi_column_block(block_spans, boundaries, page_width):
    """
    True only when content should be read column-by-column (e.g. credit box),
    not wrapped prose or TOC rows where each line is one logical unit.
    """
    if not boundaries or len(block_spans) < 4:
        return False

    rows = _cluster_spans_into_rows(block_spans)
    if len(rows) < 2:
        return False

    block_min_x = min(s["bbox"][0] for s in block_spans)
    block_max_x = max(s["bbox"][2] for s in block_spans)
    block_w = block_max_x - block_min_x
    if block_w > 0:
        wide = sum(1 for s in block_spans if (s["bbox"][2] - s["bbox"][0]) > block_w * 0.45)
        if wide >= len(block_spans) * 0.5:
            return False

    min_gutter = max(page_width * 0.03, 8.0)
    gutter_mids = []
    both_sides = 0
    stacked_rows = 0
    multi_span_rows = sum(1 for row in rows if len(row) > 1)

    for row in rows:
        left = [s for s in row if _column_index(s, boundaries) == 0]
        right = [s for s in row if _column_index(s, boundaries) > 0]
        if left and right:
            both_sides += 1
            gap = min(s["bbox"][0] for s in right) - max(s["bbox"][2] for s in left)
            if gap >= min_gutter:
                gutter_mids.append(
                    (max(s["bbox"][2] for s in left) + min(s["bbox"][0] for s in right)) / 2.0
                )
        else:
            stacked_rows += 1

    ncols = len(set(_column_index(s, boundaries) for s in block_spans))
    if ncols >= 3 and both_sides >= len(rows) * 0.5:
        return False

    if multi_span_rows >= 2 and stacked_rows >= max(2, len(rows) * 0.30):
        return True

    if len(gutter_mids) >= 2:
        spread = max(gutter_mids) - min(gutter_mids)
        if spread < page_width * 0.10:
            rows = _cluster_spans_into_rows(block_spans)
            gaps = []
            for row in rows:
                left = [s for s in row if _column_index(s, boundaries) == 0]
                right = [s for s in row if _column_index(s, boundaries) > 0]
                if left and right:
                    gap = min(s["bbox"][0] for s in right) - max(s["bbox"][2] for s in left)
                    if gap >= min_gutter:
                        gaps.append(gap)
            avg_gap = sum(gaps) / len(gaps) if gaps else 0.0
            if avg_gap >= page_width * 0.11:
                return True

    return False


def _sort_spans_within_layout_block(block_spans, page_width, page_boundaries=None):
    """
    Sort spans inside one layout block. Multi-column blocks use column-first order;
    single-column / dense blocks use top-to-bottom, left-to-right.
    """
    if not block_spans:
        return []

    block_x_max = max(s["bbox"][2] for s in block_spans)
    if _is_dense_text_block(block_spans, block_x_max):
        return _sort_spans_row_primary(block_spans)

    block_boundaries = _detect_column_boundaries(block_spans, page_width=block_x_max)
    effective_boundaries = block_boundaries
    if not effective_boundaries and page_boundaries:
        block_min_x = min(s["bbox"][0] for s in block_spans)
        block_max_x = max(s["bbox"][2] for s in block_spans)
        block_w = block_max_x - block_min_x
        if block_w < page_width * 0.72:
            effective_boundaries = page_boundaries

    if effective_boundaries:
        effective_boundaries = [
            _refine_column_boundary(block_spans, b, page_width=block_x_max)
            for b in effective_boundaries
        ]

    if effective_boundaries:
        cols = set(_column_index(s, effective_boundaries) for s in block_spans)
        if len(cols) > 1 and _is_genuine_multi_column_block(
            block_spans, effective_boundaries, page_width
        ):
            from collections import defaultdict
            by_col = defaultdict(list)
            for s in block_spans:
                by_col[_column_index(s, effective_boundaries)].append(s)
            out = []
            for col in sorted(by_col.keys()):
                out.extend(_sort_spans_row_primary(by_col[col]))
            return out

    return _sort_spans_row_primary(block_spans)


def _vertical_projection_column_boundaries(spans, page_width, max_cols=6):
    """Detect column gutters from a vertical projection histogram (whitespace valleys)."""
    if len(spans) < 6 or page_width <= 0:
        return None

    num_bins = max(48, int(page_width / 5))
    hist = [0.0] * num_bins
    bin_w = page_width / num_bins
    for s in spans:
        b0 = max(0, int(s["bbox"][0] / bin_w))
        b1 = min(num_bins - 1, max(b0, int(s["bbox"][2] / bin_w) - 1))
        for b in range(b0, b1 + 1):
            hist[b] += 1.0

    peak = max(hist)
    if peak <= 0:
        return None

    threshold = peak * 0.10
    margin_bins = int(num_bins * 0.08)
    valleys = []
    i = margin_bins
    while i < num_bins - margin_bins:
        if hist[i] <= threshold:
            start = i
            while i < num_bins - margin_bins and hist[i] <= threshold:
                i += 1
            mid = ((start + i - 1) / 2.0 + 0.5) * bin_w
            width = (i - start) * bin_w
            if width >= max(page_width * 0.015, 6.0):
                valleys.append(mid)
        else:
            i += 1

    if not valleys:
        return None

    merged = []
    for v in sorted(valleys):
        if merged and abs(v - merged[-1]) < page_width * 0.05:
            continue
        merged.append(v)
    return merged[: max_cols - 1] if merged else None


def analyze_page_layout(spans, page_width=None):
    """
    Hierarchical layout: Page → Columns → Blocks → spans.

    Returns (layout_blocks, page_column_boundaries) where each layout block is:
      { block_id, column, min_y, min_x, column_boundaries, spans }
    Blocks are in reading order: sorted by (column, y, x).
    """
    if not spans:
        return [], None

    if page_width is None:
        page_width = max(s["bbox"][2] for s in spans)

    page_boundaries = _detect_column_boundaries(spans, page_width)
    macro_blocks = _segment_spans_into_layout_blocks(spans, page_width=page_width)

    layout_blocks = []
    for raw_spans in macro_blocks:
        if not raw_spans:
            continue
        block_x_max = max(s["bbox"][2] for s in raw_spans)
        column_boundaries = None
        if not _is_dense_text_block(raw_spans, block_x_max):
            column_boundaries = _detect_column_boundaries(raw_spans, page_width=block_x_max)
            if column_boundaries:
                column_boundaries = [
                    _refine_column_boundary(raw_spans, b, page_width=block_x_max)
                    for b in column_boundaries
                ]

        layout_blocks.append({
            "column": _block_layout_column(raw_spans, page_boundaries),
            "min_y": min(s["bbox"][1] for s in raw_spans),
            "min_x": min(s["bbox"][0] for s in raw_spans),
            "column_boundaries": column_boundaries or [],
            "spans": _sort_spans_within_layout_block(
                raw_spans, page_width=block_x_max, page_boundaries=page_boundaries
            ),
        })

    # Vertical flow first; column only breaks ties for side-by-side blocks at the same height.
    layout_blocks.sort(key=lambda b: (b["min_y"], b["column"], b["min_x"]))
    for i, block in enumerate(layout_blocks):
        block["block_id"] = i + 1

    return layout_blocks, page_boundaries


def sort_reading_order_columns(spans, col_threshold_pts=30.0, page_width=None):
    """Flat span list in hierarchical reading order (blocks → columns → y/x within block)."""
    layout_blocks, _ = analyze_page_layout(spans, page_width)
    return [s for block in layout_blocks for s in block["spans"]]


def _refine_column_boundary(spans, rough_boundary, page_width=0):
    """Adjust boundary when left-column spans extend past a header-row gutter (e.g. Ph.D.)."""
    margin = max((page_width or rough_boundary) * 0.03, 12.0)
    clear_right = [s for s in spans if s["bbox"][0] >= rough_boundary + margin]
    if not clear_right:
        return rough_boundary
    min_right_l = min(s["bbox"][0] for s in clear_right)
    left_spans = [s for s in spans if s["bbox"][0] < min_right_l]
    right_spans = [s for s in spans if s["bbox"][0] >= min_right_l]
    if not left_spans or not right_spans:
        return rough_boundary
    max_left_r = max(s["bbox"][2] for s in left_spans)
    min_right_l = min(s["bbox"][0] for s in right_spans)
    return (max_left_r + min_right_l) / 2.0


def _column_index(span, boundaries):
    """Return 0-based column index for a span given sorted boundary x-positions."""
    if not boundaries:
        return 0
    cx = (span["bbox"][0] + span["bbox"][2]) / 2.0
    for i, boundary in enumerate(boundaries):
        if cx < boundary:
            return i
    return len(boundaries)


def _cluster_spans_into_rows(spans):
    spans = sorted(spans, key=lambda s: (s["bbox"][1], s["bbox"][0]))
    rows = []
    for span in spans:
        span_y = (span["bbox"][1] + span["bbox"][3]) / 2.0
        inserted = False
        for row in rows:
            row_y_center = sum((s["bbox"][1] + s["bbox"][3]) / 2.0 for s in row) / len(row)
            row_height = max(s["bbox"][3] - s["bbox"][1] for s in row)
            if abs(span_y - row_y_center) < (row_height * 0.7):
                row.append(span)
                inserted = True
                break
        if not inserted:
            rows.append([span])
    return rows


def _span_row_sort_key(span):
    """Left-to-right within a row; page numbers sort after other content on the same row."""
    text = span.get("text") or ""
    if not text and span.get("chars"):
        text = "".join(c.get("c", "") for c in span["chars"])
    if re.match(r"^\d+$", (text or "").strip()):
        return (1, span["bbox"][0])
    return (0, span["bbox"][0])


def _sort_spans_row_primary(spans):
    """Reading order: top-to-bottom rows, left-to-right within each row."""
    if not spans:
        return []
    rows = _cluster_spans_into_rows(spans)
    rows.sort(key=lambda r: min(s["bbox"][1] for s in r))
    out = []
    for row in rows:
        out.extend(sorted(row, key=_span_row_sort_key))
    return out


def _merge_boundary_lists(*lists, page_width):
    tolerance = page_width * 0.04
    merged = []
    for boundaries in lists:
        if not boundaries:
            continue
        for b in boundaries:
            if any(abs(b - existing) < tolerance for existing in merged):
                continue
            merged.append(b)
    return sorted(merged) if merged else None


def _validate_column_boundaries(spans, boundaries, page_width):
    if not boundaries or not spans:
        return None

    min_gutter = max(page_width * 0.02, 8.0)
    rows = _cluster_spans_into_rows(spans)
    valid = []

    for boundary in boundaries:
        rows_with_both = 0
        rows_with_gutter = 0

        for row in rows:
            left = [s for s in row if (s["bbox"][0] + s["bbox"][2]) / 2.0 < boundary]
            right = [s for s in row if (s["bbox"][0] + s["bbox"][2]) / 2.0 >= boundary]
            if not left or not right:
                continue
            rows_with_both += 1
            gap = min(s["bbox"][0] for s in right) - max(s["bbox"][2] for s in left)
            if gap >= min_gutter:
                rows_with_gutter += 1

        if rows_with_both >= 2 and rows_with_gutter >= rows_with_both * 0.5:
            valid.append(boundary)
        elif rows_with_both == 1 and rows_with_gutter == 1:
            for row in rows:
                left = [s for s in row if (s["bbox"][0] + s["bbox"][2]) / 2.0 < boundary]
                right = [s for s in row if (s["bbox"][0] + s["bbox"][2]) / 2.0 >= boundary]
                if left and right:
                    gap = min(s["bbox"][0] for s in right) - max(s["bbox"][2] for s in left)
                    if gap >= page_width * 0.06:
                        valid.append(boundary)
                    break

    return sorted(valid) if valid else None


def _detect_callout_boundary(spans, page_width):
    if len(spans) < 4:
        return None
    min_gutter = max(page_width * 0.08, 24.0)
    rows = _cluster_spans_into_rows(spans)
    best_mid = None
    best_gap = 0.0
    for row in rows:
        if len(row) < 2:
            continue
        row_sorted = sorted(row, key=lambda s: s["bbox"][0])
        for i in range(len(row_sorted) - 1):
            right_edge = row_sorted[i]["bbox"][2]
            next_left = row_sorted[i + 1]["bbox"][0]
            gap = next_left - right_edge
            mid = (right_edge + next_left) / 2.0
            if gap >= min_gutter and gap > best_gap and page_width * 0.1 < mid < page_width * 0.9:
                best_gap = gap
                best_mid = mid
    return [best_mid] if best_mid is not None else None


def _detect_column_boundaries_from_x_clusters(spans, page_width=None, max_cols=4):
    if len(spans) < 4:
        return None
    if page_width is None:
        page_width = max(s["bbox"][2] for s in spans)
    min_sep = max(page_width * 0.06, 20.0)
    rows = _cluster_spans_into_rows(spans)
    gap_votes = []
    for row in rows:
        if len(row) < 2:
            continue
        row_sorted = sorted(row, key=lambda s: s["bbox"][0])
        for i in range(len(row_sorted) - 1):
            right_edge = row_sorted[i]["bbox"][2]
            next_left = row_sorted[i + 1]["bbox"][0]
            gap = next_left - right_edge
            if gap < min_sep:
                continue
            mid = (right_edge + next_left) / 2.0
            if mid < page_width * 0.08 or mid > page_width * 0.92:
                continue
            gap_votes.append({"gap": gap, "mid": mid})
    if not gap_votes:
        return None
    gap_votes.sort(key=lambda g: g["gap"], reverse=True)
    boundaries = []
    for item in gap_votes:
        mid = item["mid"]
        if any(abs(mid - b) < page_width * 0.08 for b in boundaries):
            continue
        left = sum(1 for s in spans if (s["bbox"][0] + s["bbox"][2]) / 2.0 < mid)
        right = len(spans) - left
        if left < 2 or right < 2:
            continue
        if left < 3 or right < 3:
            continue
        rows_with_gap = sum(
            1 for row in rows
            if any(
                abs((row_sorted[i]["bbox"][2] + row_sorted[i + 1]["bbox"][0]) / 2 - mid) < page_width * 0.05
                for row_sorted in [sorted(row, key=lambda s: s["bbox"][0])]
                for i in range(len(row_sorted) - 1)
                if row_sorted[i + 1]["bbox"][0] - row_sorted[i]["bbox"][2] >= min_sep
            )
        )
        if rows_with_gap < 2:
            continue
        boundaries.append(mid)
        if len(boundaries) >= max_cols - 1:
            break
    return sorted(boundaries) if boundaries else None


def _detect_column_boundaries_from_rows(spans, page_width=None):
    if len(spans) < 2:
        return None
    if page_width is None:
        page_width = max(s["bbox"][2] for s in spans)
    avg_span_width = sum(s["bbox"][2] - s["bbox"][0] for s in spans) / len(spans)
    if avg_span_width < page_width * 0.08 and len(spans) > 20:
        return None
    min_gap = max(page_width * 0.03, 15.0)
    rows = _cluster_spans_into_rows(spans)
    gap_votes = []
    for row in rows:
        if len(row) < 2:
            continue
        row_sorted = sorted(row, key=lambda s: s["bbox"][0])
        for i in range(len(row_sorted) - 1):
            right_edge = row_sorted[i]["bbox"][2]
            next_left = row_sorted[i + 1]["bbox"][0]
            gap = next_left - right_edge
            if gap < min_gap:
                continue
            gap_center = (right_edge + next_left) / 2.0
            if gap_center < page_width * 0.12 or gap_center > page_width * 0.88:
                continue
            gap_votes.append({"center": gap_center, "gap": gap})
    if not gap_votes:
        return None
    tolerance = page_width * 0.04
    gap_votes.sort(key=lambda v: v["center"])
    clusters = []
    for vote in gap_votes:
        matched = None
        for cluster in clusters:
            if abs(cluster["center"] - vote["center"]) < tolerance:
                matched = cluster
                break
        if matched:
            count = matched["count"]
            matched["center"] = (matched["center"] * count + vote["center"]) / (count + 1)
            matched["count"] = count + 1
            matched["total_gap"] += vote["gap"]
        else:
            clusters.append({"center": vote["center"], "count": 1, "total_gap": vote["gap"]})
    significant = [
        c for c in clusters
        if c["count"] >= 2 or (c["count"] >= 1 and c["total_gap"] / c["count"] >= page_width * 0.05)
    ]
    if not significant:
        return None
    return sorted(c["center"] for c in significant)


def _spans_share_row(s1, s2):
    y1 = (s1["bbox"][1] + s1["bbox"][3]) / 2.0
    y2 = (s2["bbox"][1] + s2["bbox"][3]) / 2.0
    h = max(s1["bbox"][3] - s1["bbox"][1], s2["bbox"][3] - s2["bbox"][1], 1.0)
    return abs(y1 - y2) < h * 0.8


def _detect_column_boundary_two_clusters(spans, page_width):
    """Split spans into left/right x-clusters; boundary sits in the gutter between them."""
    if len(spans) < 4:
        return None

    def _span_cx(s):
        return (s["bbox"][0] + s["bbox"][2]) / 2.0

    tagged = sorted(
        spans,
        key=lambda s: (_span_cx(s), s["bbox"][1], s["bbox"][0]),
    )
    mid_i = len(tagged) // 2
    left = tagged[:mid_i]
    right = tagged[mid_i:]
    if not left or not right:
        return None

    max_left_r = max(s["bbox"][2] for s in left)
    min_right_l = min(s["bbox"][0] for s in right)
    if min_right_l > max_left_r:
        boundary = (max_left_r + min_right_l) / 2.0
    else:
        boundary = (_span_cx(tagged[mid_i - 1]) + _span_cx(tagged[mid_i])) / 2.0

    if boundary < page_width * 0.10 or boundary > page_width * 0.90:
        return None

    left_frac = sum(1 for s in tagged if _span_cx(s) < boundary) / len(tagged)
    if not (0.15 <= left_frac <= 0.85):
        return None
    return [boundary]


def _detect_column_boundary_from_row_gutters(spans, page_width):
    """Vote on horizontal gutters within each text row; returns the dominant gutter x."""
    if len(spans) < 2:
        return None

    min_gutter = max(page_width * 0.04, 10.0)
    rows = _cluster_spans_into_rows(spans)
    mids = []

    for row in rows:
        if len(row) < 2:
            continue
        row_sorted = sorted(row, key=lambda s: s["bbox"][0])
        for i in range(len(row_sorted) - 1):
            right_edge = row_sorted[i]["bbox"][2]
            next_left = row_sorted[i + 1]["bbox"][0]
            gap = next_left - right_edge
            if gap < min_gutter:
                continue
            mid = (right_edge + next_left) / 2.0
            if mid < page_width * 0.10 or mid > page_width * 0.90:
                continue
            mids.append(mid)

    if not mids:
        return None

    tolerance = page_width * 0.05
    mids.sort()
    clusters = []
    for mid in mids:
        matched = None
        for cluster in clusters:
            if abs(cluster["center"] - mid) < tolerance:
                matched = cluster
                break
        if matched:
            count = matched["count"]
            matched["center"] = (matched["center"] * count + mid) / (count + 1)
            matched["count"] = count + 1
        else:
            clusters.append({"center": mid, "count": 1})

    best = max(clusters, key=lambda c: c["count"])
    left_frac = sum(
        1 for s in spans if (s["bbox"][0] + s["bbox"][2]) / 2 < best["center"]
    ) / len(spans)
    if 0.15 <= left_frac <= 0.85:
        return [best["center"]]
    return None


def _detect_column_boundary_direct_gap(spans, page_width):
    """
    NEW: Detect a single column split by finding the largest horizontal gap
    between adjacent span bounding boxes sorted by x-center.

    This is the last-resort fallback for small span sets (e.g. a self-contained
    two-column credit box with only ~6-15 spans) where row-voting methods fail
    because they require >= 2 rows with a visible gutter.

    Examples that now work:
      "Consultant" (left, 3 spans) | "Publishing Credits" (right, 9 spans)
      Any two-column box in a book's interior pages

    Returns [boundary_x] or None.
    """
    if len(spans) < 2:
        return None

    by_x = sorted(spans, key=lambda s: (s["bbox"][0] + s["bbox"][2]) / 2)

    min_gap = max(page_width * 0.05, 12.0)
    best_gap = 0.0
    best_mid = None

    for i in range(len(by_x) - 1):
        if _spans_share_row(by_x[i], by_x[i + 1]):
            continue
        right_edge = by_x[i]["bbox"][2]
        next_left = by_x[i + 1]["bbox"][0]
        gap = next_left - right_edge
        if gap < min_gap:
            continue
        mid = (right_edge + next_left) / 2.0
        # Must sit in the central 70% of the block/page
        if mid < page_width * 0.15 or mid > page_width * 0.85:
            continue
        # Split must be balanced: each side has at least 20% of spans
        left_count = sum(
            1 for s in spans if (s["bbox"][0] + s["bbox"][2]) / 2 < mid
        )
        left_frac = left_count / len(spans)
        if not (0.20 <= left_frac <= 0.80):
            continue
        if gap > best_gap:
            best_gap = gap
            best_mid = mid

    return [best_mid] if best_mid is not None else None


def _detect_column_boundaries(spans, page_width=None):
    """
    Detect vertical gutter positions between columns.

    Detection order (each step used only if previous fails):
      1. Largest center-to-center gap in sorted span centers (original method)
      2. Row-voting + x-cluster methods (original methods)
      3. NEW: _detect_column_boundary_direct_gap — catches small two-column boxes
         that the row-voting methods miss (requires >= 2 rows, which small boxes
         often don't have)
      4. Callout boundary (original last resort)
    """
    if len(spans) < 2:
        return None

    if page_width is None:
        page_width = max(s["bbox"][2] for s in spans)

    from_projection = _vertical_projection_column_boundaries(spans, page_width)
    if from_projection:
        validated = _validate_column_boundaries(spans, from_projection, page_width)
        if validated:
            return validated

    from_clusters = _detect_column_boundary_two_clusters(spans, page_width)
    if from_clusters:
        validated = _validate_column_boundaries(spans, from_clusters, page_width)
        if validated:
            return validated
        return from_clusters

    from_row_gutters = _detect_column_boundary_from_row_gutters(spans, page_width)
    if from_row_gutters:
        validated = _validate_column_boundaries(spans, from_row_gutters, page_width)
        if validated:
            return validated
        return from_row_gutters

    from_rows = _detect_column_boundaries_from_rows(spans, page_width)
    from_clusters = _detect_column_boundaries_from_x_clusters(spans, page_width)
    merged = _merge_boundary_lists(from_rows, from_clusters, page_width=page_width)

    if merged:
        validated = _validate_column_boundaries(spans, merged, page_width)
        if validated:
            sane = [
                b for b in validated
                if 0.15 <= sum(
                    1 for s in spans
                    if (s["bbox"][0] + s["bbox"][2]) / 2 < b
                ) / len(spans) <= 0.85
            ]
            if sane:
                return sane

    # ── NEW FALLBACK ── catches small two-column boxes that row-voting misses
    fallback = _detect_column_boundary_direct_gap(spans, page_width)
    if fallback:
        return fallback

    return _validate_column_boundaries(
        spans, _detect_callout_boundary(spans, page_width), page_width
    )


def _detect_column_split_x(spans, page_width=None):
    """Backward-compatible single split from the first detected column boundary."""
    boundaries = _detect_column_boundaries(spans, page_width)
    if not boundaries:
        return None
    return boundaries[0]


def _word_probe_boxes_from_spans(spans):
    boxes = []
    for span in spans:
        chars = span.get("chars") or []
        if not chars:
            if span.get("bbox"):
                boxes.append({"bbox": span["bbox"]})
            continue
        word_chars = []
        for ch in chars:
            if (ch.get("c") or "").isspace():
                if word_chars:
                    bbs = [c.get("bbox") for c in word_chars if c.get("bbox")]
                    if bbs:
                        boxes.append({"bbox": _merge_bbox(bbs)})
                    word_chars = []
            else:
                word_chars.append(ch)
        if word_chars:
            bbs = [c.get("bbox") for c in word_chars if c.get("bbox")]
            if bbs:
                boxes.append({"bbox": _merge_bbox(bbs)})
    return boxes


def _line_y_for_line(line):
    line_bbox = line.get("bbox")
    if line_bbox:
        return line_bbox[1]
    spans = line.get("spans") or []
    if spans:
        return spans[0].get("bbox", [0, 0, 0, 0])[1]
    return 0.0


def _collect_block_spans_for_reading_order(blocks, *, include_chars=False):
    import math
    spans = []
    for block in blocks:
        if block.get("type") != 0 or "lines" not in block:
            continue
        for line in block["lines"]:
            direction = line.get("dir", (1, 0))
            rotation = round(math.atan2(direction[1], direction[0]) * 180 / math.pi, 2)
            line_y = _line_y_for_line(line)
            line_chars = []
            for _span in line["spans"]:
                if "chars" in _span:
                    for ch in _span["chars"]:
                        line_chars.append(ch.get("c", ""))
                else:
                    line_chars.append(_span.get("text", ""))
            full_line_text = "".join(line_chars)
            full_line_word_count = len(full_line_text.strip().split())
            line_meta = {
                "_rotation": rotation,
                "_line_y": line_y,
                "_full_line_text": full_line_text,
                "_full_line_word_count": full_line_word_count,
            }
            for span in line["spans"]:
                if include_chars:
                    if not span.get("chars"):
                        continue
                elif not (span.get("text") or "").strip():
                    continue
                spans.append({**span, **line_meta})
    return spans


def _collect_words_for_reading_order(words_list):
    items = []
    for w in words_list:
        x0, y0, x1, y1, word_text, _, _, _ = w
        if not (word_text or word_text.strip()):
            continue
        items.append({"bbox": (x0, y0, x1, y1), "_word": w})
    return items


def extract_coords(pdf_path, output_json, extraction_level="sentence", font_list=None, page_from=None, page_to=None):
    import math
    doc = fitz.open(pdf_path)
    pages_data = []
    font_map = font_list or {}
    page_indices = _resolve_page_range(doc, page_from, page_to)

    out_path = Path(output_json)
    if page_from is not None or page_to is not None:
        if out_path.exists():
            try:
                existing = json.loads(out_path.read_text(encoding="utf-8"))
                if isinstance(existing, list):
                    pages_data = [p for p in existing if p.get("page") not in {i + 1 for i in page_indices}]
                elif isinstance(existing, dict) and isinstance(existing.get("pages"), list):
                    pages_data = [p for p in existing["pages"] if p.get("page") not in {i + 1 for i in page_indices}]
            except Exception as e:
                print(f"Warning: could not merge existing coords.json: {e}")

    for page_num in page_indices:
        page = doc[page_num]
        width = page.rect.width
        height = page.rect.height
        raw = page.get_text("rawdict")
        raw_blocks = raw.get("blocks") or []
        blocks = raw_blocks
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
        words_list = page.get_text("words")

        if extraction_level == "glyph":
            extracted_items = []
            word_id = 0
            sentence_id = 0
            in_word = False
            glyph_spans = _collect_block_spans_for_reading_order(raw_blocks, include_chars=True)
            layout_blocks, _page_boundaries = analyze_page_layout(glyph_spans, page_width=width)
            last_line_y = None
            current_block_id = None
            block_column_boundaries = []
            prev_span_bbox = None
            for layout_block in layout_blocks:
                block_id = layout_block["block_id"]
                block_column_boundaries = layout_block["column_boundaries"]
                if current_block_id is not None and block_id != current_block_id:
                    sentence_id += 1
                    in_word = False
                    prev_span_bbox = None
                current_block_id = block_id
                for span in layout_block["spans"]:
                    span_bbox = span.get("bbox") or (0, 0, 0, 0)
                    if prev_span_bbox is not None:
                        gap = span_bbox[1] - prev_span_bbox[3]
                        line_h = max(span.get("size", 12) * 1.2, 10.0)
                        if gap > line_h * 1.45:
                            sentence_id += 1
                            in_word = False
                    prev_span_bbox = span_bbox
                    line_y = span["_line_y"]
                    if last_line_y is not None and line_y != last_line_y:
                        in_word = False
                    last_line_y = line_y
                    rotation = span["_rotation"]
                    full_line_text = span["_full_line_text"]
                    full_line_word_count = span["_full_line_word_count"]
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
                    span_text = "".join(c.get("c", "") for c in chars).strip()
                    is_page_number_span = bool(re.match(r"^\d+$", span_text))
                    is_label_span = (
                        full_line_word_count == 1
                        and _looks_like_label(span_text, width, span.get("bbox") or (0, 0, 0, 0))
                    )
                    is_cover_badge_span = (
                        page_num == 0
                        and bool(re.fullmatch(r"[A-Z](\s+[A-Z]){1,7}", span_text or ""))
                    )
                    if is_page_number_span or is_label_span:
                        sentence_id += 1
                    badge_word_id = None
                    if is_cover_badge_span:
                        word_id += 1
                        badge_word_id = word_id
                        in_word = True
                    for ch in chars:
                        c = ch.get("c", "")
                        if not c:
                            continue
                        if is_cover_badge_span:
                            if c.isspace():
                                continue
                            current_word_id = badge_word_id
                        else:
                            if c.isspace():
                                in_word = False
                                continue
                            if not in_word:
                                word_id += 1
                                in_word = True
                            current_word_id = word_id
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
                            "block_id": block_id,
                        })
                        if c in ".?!":
                            sentence_id += 1
                    if is_page_number_span or is_label_span:
                        sentence_id += 1
        elif extraction_level == "word":
            extracted_items = []
            word_items = _collect_words_for_reading_order(words_list)
            layout_blocks, _page_boundaries = analyze_page_layout(word_items, page_width=width)
            for layout_block in layout_blocks:
                block_id = layout_block["block_id"]
                for item in layout_block["spans"]:
                    w = item["_word"]
                    x0, y0, x1, y1, word_text, _, _, _ = w
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
                        "rotation": rotation,
                        "block_id": block_id,
                    })
        else:
            # Sentence-level extraction
            extracted_items = []
            sentence_parts = []
            active_block_id = [None]

            def flush_sentence():
                if not sentence_parts:
                    return
                texts = [p[0] for p in sentence_parts]
                bboxes = [p[1] for p in sentence_parts]
                info = sentence_parts[0][2]
                combined_text = _join_sentence_text(texts)
                merged_bbox = list(_merge_bbox(bboxes))
                first_origin = (bboxes[0][0], bboxes[0][1]) if bboxes else (0, 0)
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
                    "rotation": info["rotation"],
                    "block_id": active_block_id[0],
                }
                if len(lines) > 1:
                    item["lines"] = lines
                if extracted_items:
                    last = extracted_items[-1]
                    if (last.get("text") == combined_text and
                            _bboxes_overlap(last.get("bbox", []), merged_bbox)):
                        sentence_parts.clear()
                        return
                extracted_items.append(item)
                sentence_parts.clear()

            raw_spans = _collect_block_spans_for_reading_order(blocks)
            layout_blocks, _page_boundaries = analyze_page_layout(raw_spans, page_width=width)
            last_col = None
            current_block_id = None
            block_column_boundaries = []

            for layout_block in layout_blocks:
                block_id = layout_block["block_id"]
                block_column_boundaries = layout_block["column_boundaries"]
                if current_block_id is not None and block_id != current_block_id:
                    flush_sentence()
                    last_col = None
                current_block_id = block_id
                active_block_id[0] = block_id
                for span in layout_block["spans"]:
                    span_col = _column_index(span, block_column_boundaries)
                    if last_col is not None and span_col != last_col:
                        flush_sentence()
                    last_col = span_col
                    text = span["text"]
                    bbox = span["bbox"]
                    rotation = span.get("_rotation", 0)
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
                    multi = _span_multiple_sentences_to_items(text, bbox, words_list, span_info, width)
                    if multi:
                        flush_sentence()
                        extracted_items.extend(multi)
                        continue
                    if re.match(r"^\d+$", (text or "").strip()):
                        flush_sentence()
                        sentence_parts.append((text, bbox, span_info))
                        flush_sentence()
                        continue
                    line_threshold_pts = 5.0
                    if sentence_parts:
                        last_y = sentence_parts[-1][1][1]
                        if bbox[1] - last_y > line_threshold_pts:
                            flush_sentence()
                    line_threshold = _line_threshold_for_font(span_info.get("size"))
                    if sentence_parts:
                        last_y = sentence_parts[-1][1][1]
                        if abs(bbox[1] - last_y) > line_threshold:
                            first_char = (text or "").strip()[:1]
                            if first_char and first_char.isupper():
                                flush_sentence()
                    if sentence_parts:
                        last_text, last_bbox, _ = sentence_parts[-1]
                        last_y = last_bbox[1]
                        if abs(bbox[1] - last_y) <= line_threshold and (last_text or "").strip().endswith((".", "?", "!")):
                            first_char = (text or "").strip()[:1]
                            if first_char and first_char.isupper():
                                flush_sentence()
                    if sentence_parts:
                        last_text, last_bbox, _ = sentence_parts[-1]
                        if (text or "").strip() == (last_text or "").strip() and _bbox_overlap_fraction(last_bbox, bbox) > 0.5:
                            continue
                    sentence_parts.append((text, bbox, span_info))
                    if _is_sentence_end(text):
                        flush_sentence()
            flush_sentence()

        if extraction_level == "glyph" and extracted_items:
            extracted_items = _deduplicate_glyph_words(extracted_items)

        pages_data.append({
            "page": page_num + 1,
            "width": width,
            "height": height,
            "items": extracted_items
        })

    doc.close()
    pages_data.sort(key=lambda p: p.get("page", 0))
    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(pages_data, f, indent=2, ensure_ascii=False)
    print(f"Extracted coordinates to {output_json} (level={extraction_level})")
    return pages_data

def get_dominant_color(img, x0, y0, x1, y1):
    h, w = img.shape[:2]
    samples = []
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
    diff = cv2.absdiff(roi, np.array(bg_color_bgr, dtype=np.uint8))
    diff_gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
    _, text_mask = cv2.threshold(diff_gray, threshold, 255, cv2.THRESH_BINARY)
    if np.sum(text_mask == 255) == 0:
        return text_mask
    contours, _ = cv2.findContours(text_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contour_mask = np.zeros_like(text_mask)
    for c in contours:
        if cv2.contourArea(c) < min_contour_area:
            continue
        cv2.drawContours(contour_mask, [c], -1, 255, -1)
    if np.sum(contour_mask == 255) == 0:
        contour_mask = text_mask.copy()
    k = max(3, int(dilate_size))
    if k % 2 == 0:
        k += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    bubble_mask = cv2.dilate(contour_mask, kernel, iterations=1)
    return bubble_mask


def build_text_mask_from_coords(image, page_data):
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
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)
    return mask


def banner_gradient_fill(img, mask):
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
    doc = fitz.open(pdf_path)
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    pages_map = {}
    for page_num, page in enumerate(doc, start=1):
        try:
            images = page.get_images(full=True)
        except Exception:
            images = []
        if not images:
            continue
        seen_xrefs = set()
        page_list = []
        for idx, img in enumerate(images, start=1):
            try:
                xref = img[0]
                if xref in seen_xrefs:
                    continue
                seen_xrefs.add(xref)
                pix = fitz.Pixmap(doc, xref)
                file_name = f"page_{page_num}_image_{idx}.png"
                file_path = out / file_name
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
    parser.add_argument("--dpi", type=int, default=300, help="DPI for rendering")
    parser.add_argument("--coords-json", help="Path to JSON file for coordinates (required for cleanup)")
    parser.add_argument("--extraction-level", choices=["sentence", "word", "glyph"], default="sentence",
                        help="Coordinate extraction level: sentence (end at .?!), word, or glyph (one item per character)")
    parser.add_argument("--cleanup-threshold", type=int, default=10)
    parser.add_argument("--cleanup-dilate", type=int, default=5)
    parser.add_argument("--page-from", type=int, default=None)
    parser.add_argument("--page-to", type=int, default=None)

    args = parser.parse_args()

    pdf_path = args.pdf
    output_dir = args.output_dir

    page_from = getattr(args, "page_from", None)
    page_to = getattr(args, "page_to", None)

    if args.mode in ["render", "all"]:
        print("Starting Render Phase...")
        render_pages(pdf_path, output_dir, args.dpi, page_from=page_from, page_to=page_to)

    if args.mode in ["extract", "all"]:
        print("Starting Extraction Phase...")
        json_path = args.coords_json or str(Path(output_dir) / "coords.json")
        font_mapping = extract_fonts(pdf_path, output_dir)
        level = getattr(args, "extraction_level", "sentence") or "sentence"
        extract_coords(
            pdf_path, json_path, extraction_level=level, font_list=font_mapping,
            page_from=page_from, page_to=page_to,
        )
        args.coords_json = json_path

    if args.mode in ["cleanup", "all"]:
        print("Starting Cleanup Phase...")
        if not args.coords_json:
            args.coords_json = str(Path(output_dir) / "coords.json")
            if not Path(args.coords_json).exists():
                print("Error: Coordinates JSON not found. Run extract first.")
                return
        cleanup_images(
            output_dir,
            args.coords_json,
            cleanup_threshold=getattr(args, "cleanup_threshold", 10),
            cleanup_dilate=getattr(args, "cleanup_dilate", 5),
        )

    if args.mode in ["extract-images"]:
        print("Starting Embedded Images Extraction Phase...")
        extract_embedded_images(pdf_path, output_dir)

if __name__ == "__main__":
    main()
