#!/usr/bin/env python3
"""
Parametric jigsaw-piece SVG generator for the Puzz project.

Produces a grid of interlocking puzzle-piece paths with smooth,
classic round-tab edges (neck + circular bulb) instead of hand-traced
or autotraced artwork. Each interior grid line is generated once as a
shared boundary curve, then traced forward/backward by its two
neighboring pieces -- guaranteeing a perfect, gap-free interlock.

Output matches the conventions of graphics/puzzle-pieces-6.svg:
an A4 (210x297mm) page, one <path> per piece with an inkscape:label,
ready to feed into layouts/extract_layout.py.
"""

import math
import random
import sys

# ── Tunables ──────────────────────────────────────────────────────────────

ROWS, COLS = 2, 3
SEED = 7

# puzzleBox placement -- matches the existing layout-6.json footprint
PB_X, PB_Y, PB_W, PB_H = 11.8355, 65.3795, 191.3243, 126.3937

# Tab shape, all as a fraction of the local edge length L (edge runs 0..1
# canonically in +x, tab bulges toward +y)
NECK_X      = 0.42     # x where neck leaves the flat baseline
BULB_CY     = 0.30     # bulb center height
BULB_R      = 0.17     # bulb radius
ATTACH_DROP = 34        # degrees the neck attaches from the base-facing point
NECK_LEAN   = 0.025     # inward lean of the neck for a slight S-curve
ARC_STEPS   = 4         # bezier segments approximating the dome's major arc

PIECE_ORDER = ['top-left', 'top-center', 'top-right',
               'bottom-left', 'bottom-center', 'bottom-right']


# ── Geometry helpers ─────────────────────────────────────────────────────

def fmt(n):
    return f'{n:.4f}'


def arc_bezier(cx, cy, r, theta1, theta2):
    """One cubic-bezier (c1, c2, end) approximating the circular arc from
    theta1 to theta2 (degrees, |theta2-theta1| should be <= ~95 deg)."""
    t1 = math.radians(theta1)
    t2 = math.radians(theta2)
    dt = t2 - t1
    alpha = 4 / 3 * math.tan(dt / 4)

    p1 = (cx + r * math.cos(t1), cy + r * math.sin(t1))
    p2 = (cx + r * math.cos(t2), cy + r * math.sin(t2))
    c1 = (p1[0] - alpha * r * math.sin(t1), p1[1] + alpha * r * math.cos(t1))
    c2 = (p2[0] + alpha * r * math.sin(t2), p2[1] - alpha * r * math.cos(t2))
    return (c1, c2, p2)


def tab_segments(sign):
    """
    Build one canonical tab curve as a list of cubic-bezier segments
    (c1, c2, end), running from local (0,0) to (1,0), bulging toward
    +y if sign > 0 else -y. Returns segments only (no leading M).
    """
    s = sign
    nx = NECK_X
    fx = 1 - NECK_X

    cy = s * BULB_CY
    tip_angle = 90 if s > 0 else 270
    base_angle = (tip_angle + 180) % 360

    cand1 = (base_angle - ATTACH_DROP) % 360
    cand2 = (base_angle + ATTACH_DROP) % 360

    def point_at(deg):
        r = math.radians(deg)
        return (0.5 + BULB_R * math.cos(r), cy + BULB_R * math.sin(r))

    p_cand1 = point_at(cand1)
    p_cand2 = point_at(cand2)

    # identify which candidate is physically on the left (smaller x)
    if p_cand1[0] <= p_cand2[0]:
        left_angle, left_pt = cand1, p_cand1
        right_angle, right_pt = cand2, p_cand2
    else:
        left_angle, left_pt = cand2, p_cand2
        right_angle, right_pt = cand1, p_cand1

    ax1, ay1 = left_pt
    ax2, ay2 = right_pt

    segs = []

    # flat base -> left neck root (tiny ease-in curve, not a hard corner)
    segs.append(((nx - 0.06, 0), (nx - 0.02, 0.35 * ay1), (nx, ay1 * 0.55)))
    # left neck root -> left bulb attach point (gentle S lean)
    segs.append(((nx + NECK_LEAN, ay1 * 0.8), (ax1 - NECK_LEAN, ay1 * 0.95), (ax1, ay1)))

    # the dome: major arc (through the tip) from left_angle to right_angle,
    # always walking the "increasing angle away from base" direction
    start_angle = left_angle
    total_sweep = (right_angle - left_angle) % 360
    if total_sweep < 180:
        # left_angle -> right_angle the short way passes through the base;
        # we want the long way instead
        total_sweep = total_sweep - 360  # negative: walk decreasing angle
    steps = ARC_STEPS
    dtheta = total_sweep / steps
    theta = start_angle
    for _ in range(steps):
        c1, c2, end = arc_bezier(0.5, cy, BULB_R, theta, theta + dtheta)
        segs.append((c1, c2, end))
        theta += dtheta
    # sanity: end should now equal right_angle's point
    (ex, ey) = segs[-1][2]
    assert abs(ex - ax2) < 1e-6 and abs(ey - ay2) < 1e-6, (ex, ey, ax2, ay2)

    # right bulb attach point -> right neck root
    segs.append(((ax2 - NECK_LEAN, ay2 * 0.95), (fx - NECK_LEAN, ay2 * 0.8), (fx, ay2 * 0.8)))
    # right neck root -> flat base
    segs.append(((fx, ay2 * 0.55), (fx + 0.02, 0.35 * ay2), (fx + 0.06, 0)))
    # close out to the far corner
    segs.append(((fx + 0.12, 0), (0.94, 0), (1, 0)))

    return segs


def transform_segment(seg, ox, oy, ux, uy, vx, vy, length):
    """Map a local (edge-length-normalized) segment into absolute
    coordinates, where u is the unit vector along the edge and v is the
    unit perpendicular (canonical +y direction)."""
    def pt(lx, ly):
        ax = ox + (lx * length) * ux + ly * length * vx
        ay = oy + (lx * length) * uy + ly * length * vy
        return (ax, ay)

    c1, c2, end = seg
    return (pt(*c1), pt(*c2), pt(*end))


def reverse_segments(segs, start, end):
    """Reverse a forward cubic-bezier segment chain (given its absolute
    start/end points) into the backward-traversal chain."""
    pts = [start]
    ctrls = []
    for c1, c2, e in segs:
        pts.append(e)
        ctrls.append((c1, c2))
    assert abs(pts[-1][0] - end[0]) < 1e-6 and abs(pts[-1][1] - end[1]) < 1e-6

    rev = []
    n = len(ctrls)
    for i in range(n - 1, -1, -1):
        c1, c2 = ctrls[i]
        new_end = pts[i]
        rev.append((c2, c1, new_end))
    return rev


def segs_to_path_commands(segs):
    out = []
    for c1, c2, e in segs:
        out.append(f'C {fmt(c1[0])},{fmt(c1[1])} {fmt(c2[0])},{fmt(c2[1])} {fmt(e[0])},{fmt(e[1])}')
    return out


# ── Grid build ────────────────────────────────────────────────────────────

def build():
    rng = random.Random(SEED)

    cell_w = PB_W / COLS
    cell_h = PB_H / ROWS
    gx = [PB_X + c * cell_w for c in range(COLS + 1)]
    gy = [PB_Y + r * cell_h for r in range(ROWS + 1)]

    # Horizontal interior edges: canonical +y = downward (tab belongs to
    # the piece above); forward direction runs left -> right.
    h_edges = {}
    for r in range(1, ROWS):
        for c in range(COLS):
            sign = rng.choice([1, -1])
            local = tab_segments(sign)
            length = gx[c + 1] - gx[c]
            ox, oy = gx[c], gy[r]
            abs_segs = [transform_segment(s, ox, oy, 1, 0, 0, 1, length) for s in local]
            h_edges[(r, c)] = (abs_segs, (ox, oy), (gx[c + 1], gy[r]))

    # Vertical interior edges: canonical +y(local) = rightward absolute
    # (tab belongs to the piece on the left); forward direction runs top -> bottom.
    v_edges = {}
    for c in range(1, COLS):
        for r in range(ROWS):
            sign = rng.choice([1, -1])
            local = tab_segments(sign)
            length = gy[r + 1] - gy[r]
            ox, oy = gx[c], gy[r]
            abs_segs = [transform_segment(s, ox, oy, 0, 1, 1, 0, length) for s in local]
            v_edges[(c, r)] = (abs_segs, (ox, oy), (gx[c], gy[r + 1]))

    pieces = []
    for r in range(ROWS):
        for c in range(COLS):
            top_left = (gx[c], gy[r])
            top_right = (gx[c + 1], gy[r])
            bot_right = (gx[c + 1], gy[r + 1])
            bot_left = (gx[c], gy[r + 1])

            d = [f'M {fmt(top_left[0])},{fmt(top_left[1])}']

            # top edge: left -> right
            if r == 0:
                d.append(f'L {fmt(top_right[0])},{fmt(top_right[1])}')
            else:
                segs, s0, s1 = h_edges[(r, c)]
                d += segs_to_path_commands(segs)

            # right edge: top -> bottom
            if c == COLS - 1:
                d.append(f'L {fmt(bot_right[0])},{fmt(bot_right[1])}')
            else:
                segs, s0, s1 = v_edges[(c + 1, r)]
                d += segs_to_path_commands(segs)

            # bottom edge: right -> left
            if r == ROWS - 1:
                d.append(f'L {fmt(bot_left[0])},{fmt(bot_left[1])}')
            else:
                segs, s0, s1 = h_edges[(r + 1, c)]
                rsegs = reverse_segments(segs, s0, s1)
                d += segs_to_path_commands(rsegs)

            # left edge: bottom -> top
            if c == 0:
                d.append(f'L {fmt(top_left[0])},{fmt(top_left[1])}')
            else:
                segs, s0, s1 = v_edges[(c, r)]
                rsegs = reverse_segments(segs, s0, s1)
                d += segs_to_path_commands(rsegs)

            d.append('Z')
            pieces.append(' '.join(d))

    return pieces


def main():
    pieces = build()
    labels = PIECE_ORDER

    parts = []
    parts.append('<?xml version="1.0" encoding="UTF-8" standalone="no"?>')
    parts.append('<svg')
    parts.append('   width="210mm"')
    parts.append('   height="297mm"')
    parts.append('   viewBox="0 0 210 297"')
    parts.append('   version="1.1"')
    parts.append('   id="svg1"')
    parts.append('   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"')
    parts.append('   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"')
    parts.append('   xmlns="http://www.w3.org/2000/svg">')
    parts.append('  <g inkscape:label="puzzle" inkscape:groupmode="layer" id="layer1">')

    palette = ['#1e85a3', '#2ea21f']
    for i, (label, d) in enumerate(zip(labels, pieces)):
        fill = palette[i % 2]
        parts.append(f'    <path')
        parts.append(f'       d="{d}"')
        parts.append(f'       style="display:inline;fill:{fill};stroke:#000000;stroke-width:0.5;paint-order:stroke markers fill"')
        parts.append(f'       id="path{i+1}"')
        parts.append(f'       inkscape:label="{label}" />')

    parts.append('  </g>')
    parts.append('</svg>')
    parts.append('')

    out = '\n'.join(parts)
    outfile = sys.argv[1] if len(sys.argv) > 1 else 'puzzle-pieces-6-nice.svg'
    with open(outfile, 'w') as f:
        f.write(out)
    print(f'wrote {outfile}', file=sys.stderr)


if __name__ == '__main__':
    main()
