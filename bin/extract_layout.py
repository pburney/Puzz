#!/usr/bin/env python3
"""
Extract puzzle piece bounding boxes from an Inkscape SVG and emit layout JSON
for the Puzz engine.

Usage:
    python3 extract_layout.py puzzle-pieces-6.svg > layout-6.json
    python3 extract_layout.py puzzle-pieces-6.svg  # writes layout-6.json in cwd

The SVG must have paths with inkscape:label attributes naming each piece.
Update PIECE_ORDER below to match your piece labels in reading order
(left-to-right, top-to-bottom).
"""

import xml.etree.ElementTree as ET
import json, re, math, sys, os

SVG_NS      = 'http://www.w3.org/2000/svg'
INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape'

# Edit this list to match your piece labels, in reading order.
PIECE_ORDER = [
    'top-left', 'top-center', 'top-right',
    'bottom-left', 'bottom-center', 'bottom-right',
]


# ── Path tokenizer ────────────────────────────────────────────────────────────

_NUM_RE = re.compile(
    r'[MmLlHhVvCcSsQqTtAaZz]'
    r'|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?'
)

def _parse_commands(d):
    """Return list of (cmd_char, [float, ...]) from an SVG path d-string."""
    toks = _NUM_RE.findall(d)
    out, i = [], 0
    while i < len(toks):
        t = toks[i]
        if len(t) == 1 and t.isalpha():
            cmd, nums = t, []
            i += 1
            while i < len(toks) and not (len(toks[i]) == 1 and toks[i].isalpha()):
                nums.append(float(toks[i]))
                i += 1
            out.append((cmd, nums))
        else:
            i += 1
    return out


# ── Cubic bezier bounding box ─────────────────────────────────────────────────

def _cbez_extrema_t(p0, p1, p2, p3):
    """t values in (0,1) where the cubic bezier derivative equals zero."""
    a = -p0 + 3*p1 - 3*p2 + p3
    b =  2*(p0 - 2*p1 + p2)
    c = -p0 + p1
    ts = []
    if abs(a) < 1e-10:
        if abs(b) > 1e-10:
            t = -c / b
            if 0 < t < 1:
                ts.append(t)
    else:
        disc = b*b - 4*a*c
        if disc >= 0:
            sq = math.sqrt(max(0.0, disc))
            for t in [(-b + sq) / (2*a), (-b - sq) / (2*a)]:
                if 0 < t < 1:
                    ts.append(t)
    return ts

def _cbez(p0, p1, p2, p3, t):
    u = 1 - t
    return u**3*p0 + 3*u**2*t*p1 + 3*u*t**2*p2 + t**3*p3


def path_bbox(d):
    """
    Compute the tight bounding box of an SVG path string.
    Returns (minx, miny, maxx, maxy).
    """
    xs, ys = [], []
    cx = cy = sx = sy = 0.0

    def pt(x, y):
        xs.append(x); ys.append(y)

    def cubic_seg(x1, y1, x2, y2, ex, ey):
        nonlocal cx, cy
        for t in _cbez_extrema_t(cx, x1, x2, ex):
            pt(_cbez(cx, x1, x2, ex, t), _cbez(cy, y1, y2, ey, t))
        for t in _cbez_extrema_t(cy, y1, y2, ey):
            pt(_cbez(cx, x1, x2, ex, t), _cbez(cy, y1, y2, ey, t))
        cx, cy = ex, ey
        pt(cx, cy)

    for cmd, args in _parse_commands(d):
        if cmd == 'M':
            for i in range(0, len(args), 2):
                cx, cy = args[i], args[i+1]; pt(cx, cy)
                if i == 0: sx, sy = cx, cy
        elif cmd == 'm':
            for i in range(0, len(args), 2):
                cx += args[i]; cy += args[i+1]; pt(cx, cy)
                if i == 0: sx, sy = cx, cy
        elif cmd == 'L':
            for i in range(0, len(args), 2):
                cx, cy = args[i], args[i+1]; pt(cx, cy)
        elif cmd == 'l':
            for i in range(0, len(args), 2):
                cx += args[i]; cy += args[i+1]; pt(cx, cy)
        elif cmd == 'H':
            for x in args: cx = x; pt(cx, cy)
        elif cmd == 'h':
            for dx in args: cx += dx; pt(cx, cy)
        elif cmd == 'V':
            for y in args: cy = y; pt(cx, cy)
        elif cmd == 'v':
            for dy in args: cy += dy; pt(cx, cy)
        elif cmd == 'C':
            for i in range(0, len(args), 6):
                cubic_seg(args[i], args[i+1], args[i+2], args[i+3], args[i+4], args[i+5])
        elif cmd == 'c':
            for i in range(0, len(args), 6):
                cubic_seg(cx+args[i],   cy+args[i+1],
                          cx+args[i+2], cy+args[i+3],
                          cx+args[i+4], cy+args[i+5])
        elif cmd in ('Z', 'z'):
            cx, cy = sx, sy

    if not xs:
        raise ValueError(f'No points found in path: {d[:60]}')
    return min(xs), min(ys), max(xs), max(ys)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    svg_file = sys.argv[1] if len(sys.argv) > 1 else 'puzzle-pieces-6.svg'
    out_file = os.path.splitext(svg_file)[0].replace('puzzle-pieces-', 'layout-') + '.json'

    tree = ET.parse(svg_file)
    root = tree.getroot()

    raw = []
    for el in root.iter(f'{{{SVG_NS}}}path'):
        label = el.get(f'{{{INKSCAPE_NS}}}label', '')
        d     = el.get('d', '')
        if label and d:
            raw.append({'label': label, 'path': d})

    def sort_key(p):
        try:   return PIECE_ORDER.index(p['label'])
        except ValueError: return 999

    ordered = sorted(raw, key=sort_key)

    pieces = []
    all_mins_x, all_mins_y, all_maxs_x, all_maxs_y = [], [], [], []

    for i, p in enumerate(ordered):
        minx, miny, maxx, maxy = path_bbox(p['path'])
        all_mins_x.append(minx); all_mins_y.append(miny)
        all_maxs_x.append(maxx); all_maxs_y.append(maxy)
        pieces.append({
            'id':    f'p{i+1}',
            'label': p['label'],
            'path':  p['path'],
            'bbox':  {
                'x': round(minx, 4),
                'y': round(miny, 4),
                'w': round(maxx - minx, 4),
                'h': round(maxy - miny, 4),
            },
        })

    pb_x = min(all_mins_x)
    pb_y = min(all_mins_y)
    pb_w = max(all_maxs_x) - pb_x
    pb_h = max(all_maxs_y) - pb_y

    layout = {
        'type':       'custom',
        'total':      len(pieces),
        'puzzleBox':  {
            'x': round(pb_x, 4),
            'y': round(pb_y, 4),
            'w': round(pb_w, 4),
            'h': round(pb_h, 4),
        },
        'pieces': pieces,
    }

    result = json.dumps(layout, indent=2)
    with open(out_file, 'w') as f:
        f.write(result)

    print(result)

    print(f'\n--- wrote {out_file} ---', file=sys.stderr)
    print(f'Puzzle box: ({pb_x:.2f}, {pb_y:.2f})  {pb_w:.2f} × {pb_h:.2f}', file=sys.stderr)
    for p in pieces:
        b = p['bbox']
        print(f"  {p['label']:16s}  bbox ({b['x']:.2f},{b['y']:.2f})  {b['w']:.2f}×{b['h']:.2f}",
              file=sys.stderr)

if __name__ == '__main__':
    main()
