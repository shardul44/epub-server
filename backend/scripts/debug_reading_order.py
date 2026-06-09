"""
Debug script: dumps PDF stream order vs Y/X coordinate order for a specific page.
Usage:
    python debug_reading_order.py <pdf_path> <page_number_1based> [sentence|word|glyph]

Output shows:
  - Stream order (block→line→span as PyMuPDF gives it)
  - Whether column interleaving is detected
  - Final reading order produced by each extraction level
"""
import sys
import math
import re
import fitz
import json

def color_to_hex(c):
    if c is None:
        return "#000000"
    if isinstance(c, int):
        r = (c >> 16) & 0xFF
        g = (c >> 8) & 0xFF
        b = c & 0xFF
        return f"#{r:02x}{g:02x}{b:02x}"
    return "#000000"

def _detect_column_split(page_width, centers):
    if not centers or page_width <= 0 or len(centers) < 6:
        return None
    bin_count = 50
    bins = [0] * bin_count
    for cx in centers:
        b = min(bin_count - 1, max(0, int((cx / page_width) * bin_count)))
        bins[b] += 1
    smooth = []
    for i in range(bin_count):
        prev = bins[i - 1] if i > 0 else 0
        nxt = bins[i + 1] if i < bin_count - 1 else 0
        smooth.append((prev + bins[i] * 2 + nxt) / 4)
    lo = int(bin_count * 0.28)
    hi = int(bin_count * 0.72)
    valley_bin = lo
    min_val = float("inf")
    for i in range(lo, hi + 1):
        if smooth[i] < min_val:
            min_val = smooth[i]
            valley_bin = i
    left_end = max(1, valley_bin)
    right_start = min(bin_count - 1, valley_bin + 1)
    left_peak = max(smooth[int(bin_count * 0.08):left_end]) if left_end > 0 else 0
    right_peak = max(smooth[right_start:int(bin_count * 0.92)]) if right_start < bin_count else 0
    total = sum(smooth)
    if total < 4 or left_peak < 1 or right_peak < 1:
        return None
    if min_val > left_peak * 0.45 or min_val > right_peak * 0.45:
        print(f"  [histogram] valley={min_val:.2f} left_peak={left_peak:.2f} right_peak={right_peak:.2f} — ratio too high, no split detected")
        return None
    split = ((valley_bin + 0.5) / bin_count) * page_width
    print(f"  [histogram] valley={min_val:.2f} left_peak={left_peak:.2f} right_peak={right_peak:.2f} — split at x={split:.1f}")
    return split


def main():
    if len(sys.argv) < 3:
        print("Usage: python debug_reading_order.py <pdf> <page> [sentence|word|glyph]")
        sys.exit(1)

    pdf_path = sys.argv[1]
    page_num_1based = int(sys.argv[2])
    level = sys.argv[3] if len(sys.argv) > 3 else "sentence"

    doc = fitz.open(pdf_path)
    page = doc[page_num_1based - 1]
    width = page.rect.width
    height = page.rect.height
    print(f"\n=== Page {page_num_1based} | size={width:.1f}x{height:.1f} | level={level} ===\n")

    raw = page.get_text("rawdict")
    raw_blocks = raw.get("blocks") or []
    words_list = page.get_text("words")  # (x0,y0,x1,y1,text,block_no,line_no,word_no)

    # ── 1. Show raw stream order (blocks → lines → spans) ──────────────────────
    print("── STREAM ORDER (block→line→span) ──────────────────────────────────────")
    stream_items = []  # (text, x0, y0, block_no, line_no)
    for bi, block in enumerate(raw_blocks):
        if block.get("type") != 0 or "lines" not in block:
            continue
        for li, line in enumerate(block["lines"]):
            line_text = ""
            for span in line["spans"]:
                chars = span.get("chars", [])
                line_text += "".join(c.get("c", "") for c in chars) if chars else span.get("text", "")
            bb = block.get("bbox", [0,0,0,0])
            x0, y0 = bb[0], bb[1]
            stream_items.append((line_text.strip(), x0, y0, bi, li))
            print(f"  blk{bi:02d} ln{li:02d}  x={x0:6.1f}  y={y0:6.1f}  \"{line_text.strip()[:60]}\"")

    # ── 2. Detect columns ───────────────────────────────────────────────────────
    print(f"\n── COLUMN DETECTION (page_width={width:.1f}) ──────────────────────────────")
    centers = [(x0 + (x0 + 100)) / 2 for _, x0, _, _, _ in stream_items]  # rough
    # Use actual word centers instead
    wcenters = []
    for w in words_list:
        x0,y0,x1,y1,wt,_,_,_ = w
        wcenters.append((x0+x1)/2)
    split_x = _detect_column_split(width, wcenters)
    print(f"  split_x = {split_x}")

    # ── 3. Show interleaving analysis ──────────────────────────────────────────
    if split_x is not None:
        print(f"\n── STREAM INTERLEAVE CHECK (split_x={split_x:.1f}) ───────────────────────────")
        cols = []
        for text, x0, y0, bi, li in stream_items:
            col = 0 if x0 < split_x else 1
            cols.append(col)
            print(f"  blk{bi:02d} ln{li:02d}  col={col}  x={x0:6.1f}  \"{text[:50]}\"")
        transitions = sum(1 for i in range(1, len(cols)) if cols[i] != cols[i-1])
        print(f"\n  transitions={transitions}  {'→ INTERLEAVED (geometry re-sort needed)' if transitions > 2 else '→ COLUMN-CONSISTENT (stream order OK)'}")

    # ── 4. Show Y/X coordinate order (old behaviour) ───────────────────────────
    print(f"\n── Y→X SORT ORDER (old pipeline behaviour) ─────────────────────────────")
    yx_sorted = sorted(stream_items, key=lambda t: (t[2], t[1]))
    for i, (text, x0, y0, bi, li) in enumerate(yx_sorted, 1):
        print(f"  {i:3d}.  x={x0:6.1f}  y={y0:6.1f}  \"{text[:60]}\"")

    # ── 5. If split detected, show col→y→x order ───────────────────────────────
    if split_x is not None:
        print(f"\n── COL→Y→X SORT ORDER (geometry re-sort) ────────────────────────────────")
        col_sorted = sorted(stream_items, key=lambda t: (0 if t[1] < split_x else 1, t[2], t[1]))
        for i, (text, x0, y0, bi, li) in enumerate(col_sorted, 1):
            col = 0 if x0 < split_x else 1
            print(f"  {i:3d}.  col={col}  x={x0:6.1f}  y={y0:6.1f}  \"{text[:60]}\"")

    # ── 6. Show stream order (what the new pipeline will produce) ───────────────
    print(f"\n── STREAM ORDER (new pipeline — what pdf2htmlEX would produce) ──────────")
    for i, (text, x0, y0, bi, li) in enumerate(stream_items, 1):
        print(f"  {i:3d}.  blk{bi:02d}  x={x0:6.1f}  y={y0:6.1f}  \"{text[:60]}\"")

    print(f"\nTotal items: {len(stream_items)}")
    doc.close()


if __name__ == "__main__":
    main()
