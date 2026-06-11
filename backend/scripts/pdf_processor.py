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


def _glyph_char_ends_sentence(ch, prev_ch="", next_ch=""):
    """True when a glyph ends a sentence (not dot leaders, not abbreviations like Ph.D.)."""
    if ch not in ".?!":
        return False
    if ch in "?!":
        return True
    if prev_ch == "." or next_ch == ".":
        return False
    if prev_ch.isalpha() and len(prev_ch) == 1 and next_ch.isalpha():
        return False
    if prev_ch.isalpha() and next_ch.isdigit():
        return False
    return True


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


def _looks_like_image_caption(text, page_width, bbox):
    """Short narrow right-side caption (e.g. 'Nez Perce chief' under a portrait)."""
    t = (text or "").strip()
    if not t or not page_width:
        return False
    words = t.split()
    # Wrapped body lines are 4+ words; real captions are brief (1–3 words).
    if len(words) > 3 or len(t) > 32:
        return False
    if any(ch in ".?!" for ch in t):
        return False
    # Narrative / sidebar sentences (e.g. "There are seven") are not image captions.
    if re.match(
        r"^(There|A|An|The|This|These|It|They|He|She|We|You|In|On|At|As|But|So|If|When|While|Because)\s",
        t,
        re.I,
    ):
        return False
    try:
        x0, _, x1, _ = bbox
        span_width = abs(x1 - x0)
    except Exception:
        return False
    # Paragraph columns are wide; captions hug the image on the right.
    if span_width > page_width * 0.34:
        return False
    return x0 >= page_width * 0.50


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
# VISION-BASED ZONE DETECTION (runs before column / reading-order analysis)
# ─────────────────────────────────────────────────────────────────────────────

VISION_ZONE_DPI = 96


def _render_page_bgr(page, dpi=VISION_ZONE_DPI):
    """Render a PDF page to a BGR numpy array; return (img, scale_x, scale_y) in PDF pts/px."""
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
    if pix.n == 4:
        img = cv2.cvtColor(arr, cv2.COLOR_RGBA2BGR)
    else:
        img = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    page_w = page.rect.width
    page_h = page.rect.height
    scale_x = page_w / float(pix.w)
    scale_y = page_h / float(pix.h)
    return img, scale_x, scale_y


def _estimate_background_bgr(img, border=12):
    """Median color from page border strips (background estimate)."""
    h, w = img.shape[:2]
    border = min(border, h // 8, w // 8)
    if border < 2:
        return tuple(int(c) for c in np.median(img.reshape(-1, 3), axis=0))
    strips = [
        img[:border, :].reshape(-1, 3),
        img[h - border:, :].reshape(-1, 3),
        img[:, :border].reshape(-1, 3),
        img[:, w - border:].reshape(-1, 3),
    ]
    samples = np.vstack(strips)
    return tuple(int(c) for c in np.median(samples, axis=0))


def _pdf_bbox_to_px(bbox, scale_x, scale_y):
    x0 = max(0, int(bbox[0] / scale_x))
    y0 = max(0, int(bbox[1] / scale_y))
    x1 = int(bbox[2] / scale_x)
    y1 = int(bbox[3] / scale_y)
    return x0, y0, x1, y1


def _px_rect_to_pdf_bbox(x0, y0, x1, y1, scale_x, scale_y):
    return (
        x0 * scale_x,
        y0 * scale_y,
        x1 * scale_x,
        y1 * scale_y,
    )


def _build_vision_structural_mask(img, bg_bgr):
    """
    Structural foreground mask for zone boundaries only.
    Deliberately excludes span bboxes so vertical whitespace gutters survive XY-cut.
    """
    h, w = img.shape[:2]
    bg = np.array(bg_bgr, dtype=np.uint8)
    diff = cv2.absdiff(img, bg)
    diff_gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
    _, visual_mask = cv2.threshold(diff_gray, 12, 255, cv2.THRESH_BINARY)

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1]
    bg_hsv = cv2.cvtColor(bg.reshape(1, 1, 3), cv2.COLOR_BGR2HSV)[0, 0]
    val_diff = cv2.absdiff(hsv[:, :, 2], np.full((h, w), int(bg_hsv[2]), dtype=np.uint8))
    tint_mask = np.zeros((h, w), dtype=np.uint8)
    tint_mask[(sat > 16) | (val_diff > 12)] = 255

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 40, 120)
    k_h = max(15, int(w * 0.08))
    horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k_h, 1))
    horiz_lines = cv2.morphologyEx(edges, cv2.MORPH_OPEN, horiz_kernel, iterations=1)

    combined = cv2.bitwise_or(visual_mask, tint_mask)
    combined = cv2.bitwise_or(combined, horiz_lines)
    k = max(3, int(min(w, h) * 0.003))
    if k % 2 == 0:
        k += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel, iterations=1)
    return combined


def _detect_tinted_panel_rects(img, bg_bgr, scale_x, scale_y, page_width, page_height):
    """Detect colored/shadowed panels (credit boxes, tinted callout boxes)."""
    h, w = img.shape[:2]
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    bg_lab = cv2.cvtColor(
        np.array(bg_bgr, dtype=np.uint8).reshape(1, 1, 3), cv2.COLOR_BGR2LAB
    )[0, 0]
    l_diff = cv2.absdiff(lab[:, :, 0], np.full((h, w), int(bg_lab[0]), dtype=np.uint8))
    a_diff = cv2.absdiff(lab[:, :, 1], np.full((h, w), int(bg_lab[1]), dtype=np.uint8))
    b_diff = cv2.absdiff(lab[:, :, 2], np.full((h, w), int(bg_lab[2]), dtype=np.uint8))
    panel_mask = ((l_diff > 6) | (a_diff > 5) | (b_diff > 5)).astype(np.uint8) * 255

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    panel_mask = cv2.bitwise_or(panel_mask, ((hsv[:, :, 1] > 14).astype(np.uint8) * 255))

    k = max(5, int(min(w, h) * 0.006))
    if k % 2 == 0:
        k += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    panel_mask = cv2.morphologyEx(panel_mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(panel_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = page_width * page_height * 0.015
    min_h = page_height * 0.04
    rects = []
    for contour in contours:
        x, y, bw, bh = cv2.boundingRect(contour)
        area_pdf = (bw * scale_x) * (bh * scale_y)
        if area_pdf < min_area or (bh * scale_y) < min_h:
            continue
        if bw < 20 or bh < 12:
            continue
        rects.append(_px_rect_to_pdf_bbox(x, y, x + bw, y + bh, scale_x, scale_y))
    return rects


def _compute_inter_row_gaps(rows):
    gaps = []
    for i in range(len(rows) - 1):
        bottom = max(s["bbox"][3] for s in rows[i])
        top = min(s["bbox"][1] for s in rows[i + 1])
        gaps.append(max(0.0, top - bottom))
    return gaps


def _gap_is_section_break(gap, all_gaps, median_h):
    """True when a row gap is large enough to start a new layout section."""
    if gap >= max(median_h * 2.0, 22.0):
        return True
    if not all_gaps:
        return gap >= max(median_h * 1.5, 20.0)
    sorted_gaps = sorted(all_gaps)
    p75 = sorted_gaps[min(len(sorted_gaps) - 1, int(len(sorted_gaps) * 0.75))]
    p90 = sorted_gaps[min(len(sorted_gaps) - 1, int(len(sorted_gaps) * 0.90))]
    return gap >= max(p75 * 1.25, p90 * 0.80, median_h * 1.65, 18.0)


def _find_whitespace_gap_centers(projection, min_gap, peak_ratio=0.06):
    """Return center indices of whitespace runs in a 1-D projection."""
    if len(projection) == 0:
        return []
    peak = float(np.max(projection))
    if peak <= 0:
        return []
    threshold = peak * peak_ratio
    gaps = []
    in_gap = False
    gap_start = 0
    for i, val in enumerate(projection):
        if val <= threshold:
            if not in_gap:
                in_gap = True
                gap_start = i
        elif in_gap:
            gap_len = i - gap_start
            if gap_len >= min_gap:
                gaps.append(gap_start + gap_len // 2)
            in_gap = False
    if in_gap:
        gap_len = len(projection) - gap_start
        if gap_len >= min_gap:
            gaps.append(gap_start + gap_len // 2)
    return gaps


def _xy_cut_mask_regions(mask, min_gap_h, min_gap_w, min_region_h, min_region_w, depth=0, max_depth=7):
    """Recursively split a binary mask by horizontal then vertical whitespace."""
    h, w = mask.shape[:2]
    if depth >= max_depth or h < min_region_h * 2 or w < min_region_w * 2:
        return [(0, 0, w, h)]

    h_proj = np.sum(mask > 0, axis=1).astype(np.float32)
    h_gaps = _find_whitespace_gap_centers(h_proj, min_gap_h)
    if h_gaps:
        mid_lo = int(h * 0.08)
        mid_hi = int(h * 0.92)
        candidates = [g for g in h_gaps if mid_lo <= g <= mid_hi]
        if candidates:
            cut = candidates[len(candidates) // 2]
            top = mask[:cut, :]
            bottom = mask[cut:, :]
            regions = []
            regions.extend(_xy_cut_mask_regions(top, min_gap_h, min_gap_w, min_region_h, min_region_w, depth + 1, max_depth))
            for x0, y0, x1, y1 in _xy_cut_mask_regions(
                bottom, min_gap_h, min_gap_w, min_region_h, min_region_w, depth + 1, max_depth
            ):
                regions.append((x0, y0 + cut, x1, y1 + cut))
            return regions

    v_proj = np.sum(mask > 0, axis=0).astype(np.float32)
    v_gaps = _find_whitespace_gap_centers(v_proj, min_gap_w)
    if v_gaps:
        mid_lo = int(w * 0.08)
        mid_hi = int(w * 0.92)
        candidates = [g for g in v_gaps if mid_lo <= g <= mid_hi]
        if candidates:
            cut = candidates[len(candidates) // 2]
            left = mask[:, :cut]
            right = mask[:, cut:]
            regions = []
            regions.extend(_xy_cut_mask_regions(left, min_gap_h, min_gap_w, min_region_h, min_region_w, depth + 1, max_depth))
            for x0, y0, x1, y1 in _xy_cut_mask_regions(
                right, min_gap_h, min_gap_w, min_region_h, min_region_w, depth + 1, max_depth
            ):
                regions.append((x0 + cut, y0, x1 + cut, y1))
            return regions

    return [(0, 0, w, h)]


def _connected_component_zone_rects(mask, min_area_px, scale_x, scale_y):
    """Connected-component blobs after dilation — catches cards, callouts, boxed panels."""
    h, w = mask.shape[:2]
    kw = max(5, int(w * 0.008))
    kh = max(5, int(h * 0.005))
    if kw % 2 == 0:
        kw += 1
    if kh % 2 == 0:
        kh += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kw, kh))
    dilated = cv2.dilate(mask, kernel, iterations=1)
    num_labels, _, stats, _ = cv2.connectedComponentsWithStats(dilated, connectivity=8)
    rects = []
    page_area = float(h * w)
    for label in range(1, num_labels):
        x, y, bw, bh, area = stats[label]
        if area < min_area_px or area > page_area * 0.92:
            continue
        if bw < 8 or bh < 8:
            continue
        rects.append(_px_rect_to_pdf_bbox(x, y, x + bw, y + bh, scale_x, scale_y))
    return rects


def _tighten_zone_to_mask(zone_bbox, mask, scale_x, scale_y, pad_px=2):
    """Shrink a zone bbox to the tight bounds of mask pixels inside it."""
    x0, y0, x1, y1 = _pdf_bbox_to_px(zone_bbox, scale_x, scale_y)
    h, w = mask.shape[:2]
    x0 = max(0, min(w - 1, x0))
    y0 = max(0, min(h - 1, y0))
    x1 = max(x0 + 1, min(w, x1))
    y1 = max(y0 + 1, min(h, y1))
    roi = mask[y0:y1, x0:x1]
    if roi.size == 0 or np.sum(roi > 0) == 0:
        return zone_bbox
    ys, xs = np.where(roi > 0)
    tx0 = max(0, x0 + int(xs.min()) - pad_px)
    ty0 = max(0, y0 + int(ys.min()) - pad_px)
    tx1 = min(w, x0 + int(xs.max()) + 1 + pad_px)
    ty1 = min(h, y0 + int(ys.max()) + 1 + pad_px)
    return _px_rect_to_pdf_bbox(tx0, ty0, tx1, ty1, scale_x, scale_y)


def _split_zone_at_internal_gutters(zone_bbox, mask, scale_x, scale_y, page_width, page_height):
    """Split an oversized zone at vertical or horizontal whitespace gutters inside it."""
    x0, y0, x1, y1 = _pdf_bbox_to_px(zone_bbox, scale_x, scale_y)
    h, w = mask.shape[:2]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    if x1 <= x0 + 4 or y1 <= y0 + 4:
        return [zone_bbox]

    roi = mask[y0:y1, x0:x1]
    zone_w = zone_bbox[2] - zone_bbox[0]
    zone_h = zone_bbox[3] - zone_bbox[1]
    page_area = page_width * page_height
    min_sub_area = page_area * 0.025

    def _sub_rects_from_cuts(cuts, axis):
        if not cuts:
            return [zone_bbox]
        cuts = sorted(set(cuts))
        bounds = [0] + cuts + [roi.shape[axis]]
        pieces = []
        for i in range(len(bounds) - 1):
            a, b = bounds[i], bounds[i + 1]
            if b - a < 6:
                continue
            if axis == 0:
                sub_px = (x0 + a, y0, x0 + b, y1)
            else:
                sub_px = (x0, y0 + a, x1, y0 + b)
            sub_pdf = _px_rect_to_pdf_bbox(*sub_px, scale_x, scale_y)
            sub_area = (sub_pdf[2] - sub_pdf[0]) * (sub_pdf[3] - sub_pdf[1])
            if axis == 1:
                sub_roi = roi[bounds[i]:bounds[i + 1], :]
            else:
                sub_roi = roi[:, bounds[i]:bounds[i + 1]]
            if sub_area >= min_sub_area and np.sum(sub_roi > 0) > 0:
                pieces.append(_tighten_zone_to_mask(sub_pdf, mask, scale_x, scale_y))
        return pieces if len(pieces) >= 2 else [zone_bbox]

    if zone_w > page_width * 0.34:
        min_gap = max(4, int(roi.shape[1] * 0.035))
        v_proj = np.sum(roi > 0, axis=0).astype(np.float32)
        v_cuts = _find_whitespace_gap_centers(v_proj, min_gap, peak_ratio=0.05)
        mid_lo = int(roi.shape[1] * 0.12)
        mid_hi = int(roi.shape[1] * 0.88)
        v_cuts = [c for c in v_cuts if mid_lo <= c <= mid_hi]
        if v_cuts:
            split = _sub_rects_from_cuts(v_cuts, axis=0)
            if len(split) >= 2:
                return split

    if zone_h > page_height * 0.18:
        min_gap = max(5, int(roi.shape[0] * 0.022))
        h_proj = np.sum(roi > 0, axis=1).astype(np.float32)
        h_cuts = _find_whitespace_gap_centers(h_proj, min_gap, peak_ratio=0.05)
        mid_lo = int(roi.shape[0] * 0.08)
        mid_hi = int(roi.shape[0] * 0.92)
        h_cuts = [c for c in h_cuts if mid_lo <= c <= mid_hi]
        if h_cuts:
            split = _sub_rects_from_cuts(h_cuts, axis=1)
            if len(split) >= 2:
                return split

    return [zone_bbox]


def _refine_visual_zone_rects(rects, mask, scale_x, scale_y, page_width, page_height):
    """Split wide/tall merged zones, then drop near-duplicate overlaps."""
    refined = []
    for rect in rects:
        refined.extend(
            _split_zone_at_internal_gutters(rect, mask, scale_x, scale_y, page_width, page_height)
        )
    return _merge_overlapping_zone_rects(refined, overlap_threshold=0.62)


def _merge_overlapping_zone_rects(rects, overlap_threshold=0.45):
    """Merge zone rectangles that substantially overlap (IoU or containment)."""
    if not rects:
        return []
    merged = True
    current = [tuple(r) for r in rects]
    while merged:
        merged = False
        next_rects = []
        used = [False] * len(current)
        for i, a in enumerate(current):
            if used[i]:
                continue
            ax0, ay0, ax1, ay1 = a
            group = [a]
            used[i] = True
            for j in range(i + 1, len(current)):
                if used[j]:
                    continue
                b = current[j]
                if _bbox_overlap_fraction(a, b) >= overlap_threshold:
                    group.append(b)
                    used[j] = True
                    merged = True
            xs0 = min(r[0] for r in group)
            ys0 = min(r[1] for r in group)
            xs1 = max(r[2] for r in group)
            ys1 = max(r[3] for r in group)
            next_rects.append((xs0, ys0, xs1, ys1))
        current = next_rects
    return current


def _span_zone_overlap(span, zone_bbox):
    bbox = span.get("bbox")
    if not bbox or len(bbox) < 4:
        return 0.0
    return _bbox_overlap_fraction(bbox, zone_bbox)


def _merge_span_groups_within_panels(groups, panel_rects):
    """Merge macro groups that fall inside the same tinted panel (e.g. credit box header + body)."""
    if not groups or not panel_rects:
        return groups

    def _centroid(span_group):
        bboxes = [s.get("bbox") for s in span_group if s.get("bbox")]
        if not bboxes:
            return None
        return (
            sum((b[0] + b[2]) / 2.0 for b in bboxes) / len(bboxes),
            sum((b[1] + b[3]) / 2.0 for b in bboxes) / len(bboxes),
        )

    def _panel_key_for_point(cx, cy):
        for panel in panel_rects:
            if panel[0] <= cx <= panel[2] and panel[1] <= cy <= panel[3]:
                return tuple(panel)
        return None

    panel_buckets = {}
    standalone = []
    for group in groups:
        c = _centroid(group)
        if c is None:
            standalone.append(group)
            continue
        pkey = _panel_key_for_point(c[0], c[1])
        if pkey is None:
            standalone.append(group)
        else:
            panel_buckets.setdefault(pkey, []).extend(group)

    merged = standalone + [spans for spans in panel_buckets.values() if spans]
    merged.sort(key=lambda g: min(s["bbox"][1] for s in g if s.get("bbox")) if g else 0.0)
    return merged


def _absorb_rects_into_panels(panel_rects, other_rects, overlap_threshold=0.45):
    """Drop fragment rects that mostly lie inside a detected panel."""
    if not panel_rects:
        return other_rects
    kept = []
    for rect in other_rects:
        if any(_bbox_overlap_fraction(rect, panel) >= overlap_threshold for panel in panel_rects):
            continue
        kept.append(rect)
    return kept


def _assign_spans_to_visual_zones(spans, zone_rects, page_width=None):
    """Partition spans into per-zone groups using max-overlap assignment."""
    if not spans:
        return []
    if not zone_rects:
        return [list(spans)]

    zone_rects = sorted(zone_rects, key=lambda z: (z[1], z[0]))
    groups = [[] for _ in zone_rects]
    unassigned = []

    for span in spans:
        bbox = span.get("bbox")
        if not bbox or len(bbox) < 4:
            unassigned.append(span)
            continue
        best_idx = -1
        best_overlap = 0.0
        cx = (bbox[0] + bbox[2]) / 2.0
        cy = (bbox[1] + bbox[3]) / 2.0
        for zi, zone in enumerate(zone_rects):
            overlap = _span_zone_overlap(span, zone)
            if overlap > best_overlap:
                best_overlap = overlap
                best_idx = zi
        if best_idx < 0 or best_overlap < 0.02:
            inside = [
                zi for zi, zone in enumerate(zone_rects)
                if zone[0] <= cx <= zone[2] and zone[1] <= cy <= zone[3]
            ]
            best_idx = inside[0] if inside else -1
        if best_idx >= 0:
            groups[best_idx].append(span)
        else:
            unassigned.append(span)

    result = [g for g in groups if g]
    if unassigned:
        result.extend(_segment_spans_into_layout_blocks(unassigned, page_width=page_width))
    return result


def _detect_visual_zones_from_page(page, spans, page_width, page_height):
    """
    Detect visually distinct layout zones (boxed panels, image cards, callouts)
    before reading-order analysis. Returns (zone_rects, panel_rects).
    """
    if not spans or page is None:
        return [], []

    try:
        img, scale_x, scale_y = _render_page_bgr(page, dpi=VISION_ZONE_DPI)
    except Exception as exc:
        print(f"Warning: vision zone render failed: {exc}")
        return [], []

    h, w = img.shape[:2]
    bg_bgr = _estimate_background_bgr(img)
    mask = _build_vision_structural_mask(img, bg_bgr)
    panel_rects = _detect_tinted_panel_rects(
        img, bg_bgr, scale_x, scale_y, page_width, page_height
    )

    min_gap_h = max(5, int(h * 0.014))
    min_gap_w = max(6, int(w * 0.018))
    min_region_h = max(10, int(h * 0.04))
    min_region_w = max(10, int(w * 0.04))
    min_area_px = max(400, int(h * w * 0.0015))

    xy_regions_px = _xy_cut_mask_regions(
        mask, min_gap_h, min_gap_w, min_region_h, min_region_w
    )
    xy_rects = []
    for x0, y0, x1, y1 in xy_regions_px:
        sub = mask[y0:y1, x0:x1]
        if sub.size == 0 or np.sum(sub > 0) < min_area_px * 0.25:
            continue
        tight = _tighten_zone_to_mask(
            _px_rect_to_pdf_bbox(x0, y0, x1, y1, scale_x, scale_y),
            mask, scale_x, scale_y,
        )
        area = (tight[2] - tight[0]) * (tight[3] - tight[1])
        if area >= page_width * page_height * 0.002:
            xy_rects.append(tight)

    cc_rects = _connected_component_zone_rects(mask, min_area_px, scale_x, scale_y)

    other_rects = _merge_overlapping_zone_rects(xy_rects + cc_rects, overlap_threshold=0.50)
    other_rects = _refine_visual_zone_rects(
        other_rects, mask, scale_x, scale_y, page_width, page_height
    )
    other_rects = _absorb_rects_into_panels(panel_rects, other_rects)

    all_rects = list(panel_rects) + other_rects
    all_rects = _merge_overlapping_zone_rects(all_rects, overlap_threshold=0.55)

    # Drop zones that are almost the full page (no useful split).
    page_area = page_width * page_height
    filtered = []
    for rect in all_rects:
        area = (rect[2] - rect[0]) * (rect[3] - rect[1])
        if area >= page_area * 0.97:
            continue
        filtered.append(rect)

    if len(filtered) <= 1:
        return [], panel_rects

    filtered.sort(key=lambda z: (z[1], z[0]))
    return filtered, panel_rects


def _span_plain_text(span):
    if span.get("text"):
        return span.get("text") or ""
    chars = span.get("chars") or []
    return "".join(c.get("c", "") for c in chars)


def _is_label_grid_spans(spans, page_width):
    """True for glossary / diagram grids: mostly single-word labels in a spaced layout."""
    if len(spans) < 3:
        return False
    label_count = sum(
        1 for s in spans
        if _looks_like_label(_span_plain_text(s), page_width, s.get("bbox") or (0, 0, 0, 0))
    )
    return label_count >= 3 and label_count >= len(spans) * 0.55


def _split_label_grid_group(spans, page_width):
    """Split one row of spaced single-word labels (glossary grid) into separate groups."""
    if len(spans) < 3:
        return [spans]
    rows = _cluster_spans_into_rows(spans)
    if len(rows) != 1:
        return [spans]
    label_count = sum(
        1 for s in spans
        if _looks_like_label(_span_plain_text(s), page_width, s.get("bbox") or (0, 0, 0, 0))
    )
    if label_count < 3 or label_count < len(spans) * 0.6:
        return [spans]
    ordered = sorted(spans, key=lambda s: s["bbox"][0])
    clusters = [[ordered[0]]]
    min_gap = max(page_width * 0.05, 24.0)
    for span in ordered[1:]:
        prev = clusters[-1][-1]
        gap = span["bbox"][0] - prev["bbox"][2]
        if gap >= min_gap:
            clusters.append([span])
        else:
            clusters[-1].append(span)
    if len(clusters) < 2:
        return [spans]
    return clusters


def _expand_label_grid_groups(groups, page_width):
    expanded = []
    for group in groups:
        expanded.extend(_split_label_grid_group(group, page_width))
    return expanded


def _segment_spans_by_vision_or_layout(spans, page_width, page=None, page_height=None):
    """
    Top-level macro segmentation: vision zones when available, else adaptive text gaps.
    Uses whichever strategy yields more distinct sections (min 2).
    """
    if not spans:
        return []

    text_blocks = _segment_spans_into_layout_blocks(spans, page_width=page_width)

    visual_zones = []
    panel_rects = []
    if page is not None and page_height:
        visual_zones, panel_rects = _detect_visual_zones_from_page(
            page, spans, page_width, page_height
        )

    vision_groups = []
    if len(visual_zones) >= 2:
        vision_groups = _assign_spans_to_visual_zones(spans, visual_zones, page_width=page_width)
        if panel_rects:
            vision_groups = _merge_span_groups_within_panels(vision_groups, panel_rects)

    if len(vision_groups) >= 2 and len(vision_groups) >= len(text_blocks):
        return _expand_label_grid_groups(vision_groups, page_width)
    if len(text_blocks) >= 2:
        return _expand_label_grid_groups(text_blocks, page_width)
    if len(vision_groups) >= 2:
        return _expand_label_grid_groups(vision_groups, page_width)
    return _expand_label_grid_groups(text_blocks, page_width)


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
    inter_row_gaps = _compute_inter_row_gaps(rows)

    blocks = []
    current_rows = []
    section_bottom = 0.0

    for i, row in enumerate(rows):
        row_top = min(s["bbox"][1] for s in row)
        row_bottom = max(s["bbox"][3] for s in row)

        if not current_rows:
            current_rows.append(row)
            section_bottom = row_bottom
            continue

        gap = row_top - section_bottom
        section_break = _gap_is_section_break(gap, inter_row_gaps, median_h)
        if section_break:
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


def _is_side_by_side_column_layout(block_spans, page_width):
    """Credit-box style: repeated rows with content in both left and right halves."""
    if _is_label_grid_spans(block_spans, page_width):
        return False
    if len(block_spans) < 4 or not page_width:
        return False
    rows = _cluster_spans_into_rows(block_spans)
    if len(rows) < 2:
        return False
    block_min_x = min(s["bbox"][0] for s in block_spans)
    block_max_x = max(s["bbox"][2] for s in block_spans)
    block_w = block_max_x - block_min_x
    if block_w < page_width * 0.22:
        return False
    split_x = block_min_x + block_w * 0.5
    margin = block_w * 0.12
    both_sides = 0
    for row in rows:
        has_left = any(s["bbox"][0] < split_x - margin for s in row)
        has_right = any(s["bbox"][0] > split_x + margin for s in row)
        if has_left and has_right:
            both_sides += 1
    return both_sides >= max(2, int(len(rows) * 0.18))


def _sort_spans_column_first(block_spans, page_width):
    """Column-first reading order for side-by-side column layouts."""
    if not block_spans:
        return []
    block_x_max = max(s["bbox"][2] for s in block_spans)
    boundaries = _detect_column_boundaries(block_spans, page_width=block_x_max)
    if not boundaries:
        block_min_x = min(s["bbox"][0] for s in block_spans)
        block_max_x = max(s["bbox"][2] for s in block_spans)
        boundaries = [(block_min_x + block_max_x) / 2.0]
    else:
        boundaries = [
            _refine_column_boundary(block_spans, b, page_width=block_x_max)
            for b in boundaries
        ]
    from collections import defaultdict
    by_col = defaultdict(list)
    for s in block_spans:
        by_col[_column_index(s, boundaries)].append(s)
    out = []
    for col in sorted(by_col.keys()):
        out.extend(_sort_spans_row_primary(by_col[col]))
    return out


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

    if _is_label_grid_spans(block_spans, page_width):
        return _sort_spans_row_primary(block_spans)

    block_x_max = max(s["bbox"][2] for s in block_spans)
    if _is_side_by_side_column_layout(block_spans, page_width):
        return _sort_spans_column_first(block_spans, page_width)

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


def analyze_page_layout(spans, page_width=None, page=None, page_height=None):
    """
    Hierarchical layout: Page → Vision zones → Columns → Blocks → spans.

    Returns (layout_blocks, page_column_boundaries) where each layout block is:
      { block_id, column, min_y, min_x, column_boundaries, spans }
    Blocks are in reading order: sorted by (column, y, x).
    """
    if not spans:
        return [], None

    if page_width is None:
        page_width = max(s["bbox"][2] for s in spans)
    if page_height is None and page is not None:
        page_height = page.rect.height

    page_boundaries = _detect_column_boundaries(spans, page_width)
    macro_blocks = _segment_spans_by_vision_or_layout(
        spans, page_width=page_width, page=page, page_height=page_height
    )

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

    # Row-primary between macro blocks (glossary grids); column-first stays within each block.
    layout_blocks = _sort_layout_blocks_reading_order(layout_blocks)
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


def _layout_block_height(block):
    spans = block.get("spans") or []
    if not spans:
        return 10.0
    return max(s["bbox"][3] for s in spans) - block["min_y"]


def _cluster_layout_blocks_into_rows(blocks):
    """Group layout blocks on the same visual row (glossary grids, caption rows)."""
    if not blocks:
        return []
    blocks = sorted(blocks, key=lambda b: (b["min_y"], b["min_x"]))
    rows = []
    for block in blocks:
        block_y = block["min_y"]
        block_h = _layout_block_height(block)
        inserted = False
        for row in rows:
            row_min_y = min(b["min_y"] for b in row)
            row_h = max(_layout_block_height(b) for b in row)
            # Tighter than span rows: consecutive paragraphs (e.g. credits) must not merge.
            if abs(block_y - row_min_y) < (max(block_h, row_h) * 0.5):
                row.append(block)
                inserted = True
                break
        if not inserted:
            rows.append([block])
    return rows


def _sort_layout_blocks_reading_order(layout_blocks):
    """Top-to-bottom rows of layout blocks, left-to-right within each row."""
    if not layout_blocks:
        return []
    rows = _cluster_layout_blocks_into_rows(layout_blocks)
    rows.sort(key=lambda r: min(b["min_y"] for b in r))
    out = []
    for row in rows:
        row.sort(key=lambda b: (b["min_x"], b["min_y"]))
        out.extend(row)
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
            layout_blocks, _page_boundaries = analyze_page_layout(
                glyph_spans, page_width=width, page=page, page_height=height
            )
            last_line_y = None
            current_block_id = None
            block_column_boundaries = []
            prev_span_bbox = None
            prev_span_size = None
            prev_span_line_y = None
            prev_block_min_y = None
            prev_block_label_grid = False
            prev_span_ended_sentence = False
            open_paragraph_sid = None
            line_sentence_ids = {}
            for layout_block in layout_blocks:
                block_id = layout_block["block_id"]
                block_column_boundaries = layout_block["column_boundaries"]
                block_spans = layout_block["spans"]
                block_is_label_grid = _is_label_grid_spans(block_spans, width)
                block_min_y = min(s["bbox"][1] for s in block_spans)
                if current_block_id is not None and block_id != current_block_id:
                    # Side-by-side vision blocks (glossary row, columns) break sentences.
                    # Stacked line blocks keep flowing until .?! — only break on large section gaps.
                    first_span = block_spans[0]
                    first_bbox = first_span.get("bbox") or (0, 0, 0, 0)
                    line_h = max(first_span.get("size", 12) * 1.2, 10.0)
                    same_row = (
                        prev_block_min_y is not None
                        and abs(block_min_y - prev_block_min_y) < line_h * 0.55
                    )
                    section_gap = False
                    if prev_span_bbox is not None:
                        gap = first_bbox[1] - prev_span_bbox[3]
                        section_gap = gap > line_h * 4.5
                    label_row_continuation = (
                        same_row and prev_block_label_grid and block_is_label_grid
                    )
                    if section_gap or (same_row and not label_row_continuation):
                        sentence_id += 1
                        open_paragraph_sid = None
                        line_sentence_ids.clear()
                    in_word = False
                prev_block_min_y = block_min_y
                prev_block_label_grid = block_is_label_grid
                current_block_id = block_id
                for span in layout_block["spans"]:
                    span_bbox = span.get("bbox") or (0, 0, 0, 0)
                    size = span.get("size", 12)
                    line_y = span["_line_y"]
                    prior_sentence_ended = prev_span_ended_sentence
                    if prev_span_bbox is not None and prev_span_line_y is not None and line_y != prev_span_line_y:
                        gap = span_bbox[1] - prev_span_bbox[3]
                        line_h = max(span.get("size", 12) * 1.2, 10.0)
                        prev_line_h = max((prev_span_size or size) * 1.2, 10.0)
                        size_delta = abs(size - (prev_span_size or size))
                        style_break = (
                            prev_span_size is not None
                            and size_delta >= max(2.0, prev_span_size * 0.12)
                        )
                        if gap > line_h * 1.45 and prior_sentence_ended:
                            sentence_id += 1
                            open_paragraph_sid = None
                            line_sentence_ids.clear()
                            in_word = False
                        elif gap > line_h * 4.5:
                            # Blank line / section break between paragraphs.
                            sentence_id += 1
                            open_paragraph_sid = None
                            line_sentence_ids.clear()
                            in_word = False
                        elif style_break and gap > min(prev_line_h, line_h) * 0.65:
                            # Chapter title / header (larger type) then body paragraph.
                            sentence_id += 1
                            open_paragraph_sid = None
                            line_sentence_ids.clear()
                            in_word = False
                    if last_line_y is not None and line_y != last_line_y:
                        in_word = False
                    last_line_y = line_y
                    rotation = span["_rotation"]
                    full_line_text = span["_full_line_text"]
                    full_line_word_count = span["_full_line_word_count"]
                    font_name = span.get("font", "")
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
                    span_bbox_tuple = span.get("bbox") or (0, 0, 0, 0)
                    is_label_span = (
                        full_line_word_count == 1
                        and _looks_like_label(span_text, width, span_bbox_tuple)
                    )
                    span_word_count = len(span_text.split()) if span_text else 0
                    is_caption_span = (
                        not is_label_span
                        and full_line_word_count <= 4
                        and span_word_count >= full_line_word_count
                        and _looks_like_image_caption(full_line_text, width, span_bbox_tuple)
                    )
                    is_cover_badge_span = (
                        page_num == 0
                        and bool(re.fullmatch(r"[A-Z](\s+[A-Z]){1,7}", span_text or ""))
                    )
                    is_special_span = is_page_number_span or is_label_span or is_caption_span
                    if is_special_span:
                        sentence_id += 1
                        span_assign_sid = sentence_id
                    elif open_paragraph_sid is not None and not prior_sentence_ended:
                        span_assign_sid = open_paragraph_sid
                    elif line_y in line_sentence_ids and not prior_sentence_ended:
                        span_assign_sid = line_sentence_ids[line_y]
                    else:
                        span_assign_sid = sentence_id
                        open_paragraph_sid = sentence_id
                    if not is_special_span:
                        line_sentence_ids[line_y] = span_assign_sid
                    badge_word_id = None
                    if is_cover_badge_span:
                        word_id += 1
                        badge_word_id = word_id
                        in_word = True
                    active_sid = span_assign_sid
                    for ci, ch in enumerate(chars):
                        c = ch.get("c", "")
                        if not c:
                            continue
                        prev_c = chars[ci - 1].get("c", "") if ci > 0 else ""
                        next_c = chars[ci + 1].get("c", "") if ci + 1 < len(chars) else ""
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
                        current_sentence_id = active_sid
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
                        if _glyph_char_ends_sentence(c, prev_c, next_c):
                            sentence_id += 1
                            active_sid = sentence_id
                            open_paragraph_sid = sentence_id
                            line_sentence_ids[line_y] = sentence_id
                            prev_span_ended_sentence = True
                    if is_label_span or is_caption_span:
                        sentence_id += 1
                        # Captions/labels are isolated but do not end the surrounding paragraph.
                        if is_label_span:
                            prev_span_ended_sentence = True
                    elif prev_span_ended_sentence and not _is_sentence_end(span_text):
                        # Sentence ended mid-span; more text on this span belongs to the next sentence.
                        prev_span_ended_sentence = False
                    elif prev_span_ended_sentence:
                        pass
                    elif _is_sentence_end(span_text):
                        sentence_id += 1
                        open_paragraph_sid = None
                        line_sentence_ids.pop(line_y, None)
                        prev_span_ended_sentence = True
                    prev_span_bbox = span_bbox
                    prev_span_size = size
                    prev_span_line_y = line_y
        elif extraction_level == "word":
            extracted_items = []
            word_items = _collect_words_for_reading_order(words_list)
            layout_blocks, _page_boundaries = analyze_page_layout(
                word_items, page_width=width, page=page, page_height=height
            )
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
            layout_blocks, _page_boundaries = analyze_page_layout(
                raw_spans, page_width=width, page=page, page_height=height
            )
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
