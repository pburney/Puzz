# Puzz — TODO / Future Work

## Static content mode — piece-morph transition (stretch)

Static content mode (progressive-enhancement `#puzz-content` markup, dissolve
transition on init) ships with a plain cross-fade between the static list and
the interactive puzzle. A more ambitious version was scoped but deferred to
keep the initial SEO work tractable:

- Instead of a plain cross-fade, use a FLIP transition (capture each `<li>`'s
  bounding rect, let the puzzle piece render in its scattered position,
  animate the delta via CSS transform) so the *active-language* `<li>`
  visually morphs into its puzzle piece, while the inactive-language `<li>`s
  shrink and travel toward the language-switcher flag control.
- **Grid layout only.** Pieces are plain rectangles, so a rect→rect FLIP
  transform is straightforward. Custom SVG clip-path layouts should keep
  falling back to the plain cross-fade — animating between a rectangular
  `<li>` and an irregular clip-path shape needs point-matched clip-path
  interpolation (or a mask crossfade), a materially harder and more fragile
  problem not worth solving just to unlock this.
- The "shrink into the flag" part needs the language-switcher trigger's
  position at the time of dissolve, which doesn't exist yet at `init()` time
  in the current architecture — building the switcher before the dissolve
  animation starts is a minor ordering change but real enough to flag.
- Worth prototyping on a single piece before committing to all six.

See `~/.claude/plans/puzz-is-cool-but-clever-naur.md` for the full static
content mode design this builds on.

## Pre-existing bug: `_renderMarkdown` javascript: link sanitization

Found while re-running the test suite during the static-content-mode work
(2026-07-15) — not caused by that change, `_renderMarkdown` itself was
untouched. `test/puzz.test.html` — "javascript: link sanitized to #" fails:

```
got:      <p><a href="#" target="_blank" rel="noopener">click</a>)</p>
expected: <p><a href="#" target="_blank" rel="noopener">click</a></p>
```

A stray `)` survives after the link is sanitized — looks like the markdown
link regex isn't consuming the closing paren correctly when the URL itself
gets rewritten. 1 of 48 tests, otherwise unrelated to anything else in this
file.
