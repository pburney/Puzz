/**
 * Puzz — zero-dependency configurable puzzle engine
 * Usage: new Puzz(containerEl, configUrl).init()
 */
class Puzz {
  static DEFAULT_EMOJIS = [
    '🎉','🌟','✨','🎊','🦋','🌈','🔥','💫','🎈','🍀',
    '⭐','🌸','🎯','🎆','🥳','🎵','🌺','💥','🎀','🐝'
  ];

  // Supported piece counts for grid shorthand
  static GRID_PRESETS = { 4:[2,2], 6:[3,2], 9:[3,3], 15:[5,3], 25:[5,5] };

  constructor(container, configUrl) {
    this.container   = container;
    this.configUrl   = configUrl;
    this.config      = null;
    this.layout      = null;
    this.pieces      = [];   // { el, id, slotIndex, placed }
    this.slots       = [];   // { el, index, occupied }
    this.timerStart  = null;
    this.timerEl     = null;
    this.timerRafId  = null;
    this._pausedAt   = null; // ms elapsed when timer was paused; null = not paused
    this.frameEl     = null;
    this.frameW      = 0;
    this.frameH      = 0;
  }

  // ── Bootstrap ────────────────────────────────────────

  async init() {
    this.config = await this._fetchJSON(this.configUrl);
    this.layout = await this._buildLayout();
    this.container.classList.add('puzz-root');
    this._buildFrame();
    this._buildPieces();
    this._loadScores();
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this._closeExpanded();
    });
  }

  async _fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Puzz: failed to load ${url}`);
    return r.json();
  }

  // ── Layout ────────────────────────────────────────────

  async _buildLayout() {
    const lay = this.config.layout || { type: 'grid', cols: 3, rows: 2 };
    if (lay.type === 'grid') {
      let { cols, rows } = lay;
      if (lay.pieces !== undefined) {
        const preset = Puzz.GRID_PRESETS[lay.pieces];
        if (!preset) throw new Error(
          `Puzz: invalid pieces count "${lay.pieces}". Valid values: ${Object.keys(Puzz.GRID_PRESETS).join(', ')}`
        );
        [cols, rows] = preset;
      }
      return this._gridLayout(cols ?? 3, rows ?? 2);
    }
    if (lay.type === 'custom') return this._fetchJSON(lay.src);
    throw new Error(`Puzz: unknown layout type "${lay.type}"`);
  }

  _gridLayout(cols, rows) {
    const pieces = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        pieces.push({
          id:     `p${i}`,
          col: c, row: r,
          origin: [c / cols, r / rows],
          size:   [1 / cols, 1 / rows],
          slot:   [c / cols, r / rows],
        });
      }
    }
    return { type: 'grid', cols, rows, total: cols * rows, pieces };
  }

  // ── Frame ─────────────────────────────────────────────

  _buildFrame() {
    const lay    = this.layout;
    const custom = lay.type === 'custom';
    const aspect = custom ? lay.puzzleBox.w / lay.puzzleBox.h : lay.cols / lay.rows;

    const HEADER_H = 38;
    const FOOTER_H = 40;
    const maxW = Math.min(this.container.clientWidth  * 0.6, 560);
    const maxH = Math.min(this.container.clientHeight * 0.65, 560) - HEADER_H - FOOTER_H;
    let fw = maxW, fh = maxW / aspect;
    if (fh > maxH) { fh = maxH; fw = maxH * aspect; }
    this.frameW = Math.round(fw);
    this.frameH = Math.round(fh);

    // ── Stage (box: header + frame + footer) ─────────────
    const stage = document.createElement('div');
    stage.className = 'puzz-stage';
    stage.style.width = `${this.frameW}px`;
    this._stageEl = stage;

    // Header — title left, subtitle right
    const header = document.createElement('div');
    header.className = 'puzz-stage-header';
    if (this.config.title) {
      const t = document.createElement('span');
      t.className = 'puzz-stage-title';
      t.textContent = this.config.title;
      header.appendChild(t);
    }
    if (this.config.subtitle) {
      const s = document.createElement('span');
      s.className = 'puzz-stage-subtitle';
      s.textContent = this.config.subtitle;
      header.appendChild(s);
    }
    stage.appendChild(header);

    // Frame
    const frame = document.createElement('div');
    frame.className = 'puzz-frame';
    frame.style.width  = `${this.frameW}px`;
    frame.style.height = `${this.frameH}px`;
    this.frameEl = frame;

    const bg = document.createElement('div');
    bg.className = 'puzz-frame-bg';
    bg.style.backgroundImage = `url(${this.config.image})`;
    bg.style.backgroundSize  = '100% 100%';
    frame.appendChild(bg);
    this._frameBgEl = bg;

    if (custom) {
      this._buildCustomSlots(frame, lay);
    } else {
      const slotsEl = document.createElement('div');
      slotsEl.className = 'puzz-slots';
      const pw = this.frameW / lay.cols;
      const ph = this.frameH / lay.rows;
      this.slots = lay.pieces.map((lp, i) => {
        const slot = document.createElement('div');
        slot.className = 'puzz-slot';
        slot.style.left   = `${lp.slot[0] * this.frameW}px`;
        slot.style.top    = `${lp.slot[1] * this.frameH}px`;
        slot.style.width  = `${pw}px`;
        slot.style.height = `${ph}px`;
        slotsEl.appendChild(slot);
        return { el: slot, index: i, occupied: false };
      });
      frame.appendChild(slotsEl);
    }

    stage.appendChild(frame);

    // Footer — Solves | Fastest | Timer | Restart
    const footer = document.createElement('div');
    footer.className = 'puzz-stage-footer';

    this.solvesEl  = document.createElement('span');
    this.solvesEl.className = 'puzz-footer-stat';

    const sep1 = document.createElement('span');
    sep1.className = 'puzz-footer-sep';
    sep1.textContent = '|';

    this.fastestEl = document.createElement('span');
    this.fastestEl.className = 'puzz-footer-stat';

    const sep2 = document.createElement('span');
    sep2.className = 'puzz-footer-sep';
    sep2.textContent = '|';

    this.timerEl = document.createElement('span');
    this.timerEl.className = 'puzz-footer-timer';
    this.timerEl.textContent = '0:00';

    const restartBtn = document.createElement('button');
    restartBtn.className = 'puzz-restart-btn';
    restartBtn.innerHTML = '&#x21BA;';
    restartBtn.title = 'Restart';
    restartBtn.addEventListener('click', () => this.reset());

    footer.appendChild(this.solvesEl);
    footer.appendChild(sep1);
    footer.appendChild(this.fastestEl);
    footer.appendChild(sep2);
    footer.appendChild(this.timerEl);
    footer.appendChild(restartBtn);

    stage.appendChild(footer);
    this.container.appendChild(stage);
  }

  _buildCustomSlots(frame, lay) {
    const pb = lay.puzzleBox;
    this.sf  = this.frameW / pb.w;
    const sf = this.sf;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width',  this.frameW);
    svg.setAttribute('height', this.frameH);
    svg.style.cssText = 'position:absolute;inset:0;z-index:2;pointer-events:none;overflow:visible;';

    this.slots = lay.pieces.map((lp, i) => {
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', lp.path);
      pathEl.setAttribute('transform', `scale(${sf}) translate(${-pb.x} ${-pb.y})`);
      pathEl.setAttribute('fill',          'none');
      pathEl.setAttribute('stroke',        'rgba(255,255,255,0.4)');
      pathEl.setAttribute('stroke-width',  '2');
      pathEl.setAttribute('stroke-dasharray', '5,3');
      pathEl.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(pathEl);

      const div = document.createElement('div');
      div.style.cssText = [
        'position:absolute',
        `left:${(lp.bbox.x - pb.x) * sf}px`,
        `top:${(lp.bbox.y  - pb.y) * sf}px`,
        `width:${lp.bbox.w * sf}px`,
        `height:${lp.bbox.h * sf}px`,
      ].join(';');
      frame.appendChild(div);

      return { el: div, pathEl, index: i, occupied: false };
    });

    frame.appendChild(svg);
    this._injectClipPaths(lay, pb, sf);
  }

  _injectClipPaths(lay, pb, sf) {
    const key    = this.config.storageKey || 'default';
    const defsSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    defsSvg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    lay.pieces.forEach(lp => {
      const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
      clip.setAttribute('id', `puzz-clip-${key}-${lp.id}`);
      clip.setAttribute('clipPathUnits', 'userSpaceOnUse');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', lp.path);
      path.setAttribute('transform', `scale(${sf}) translate(${-lp.bbox.x} ${-lp.bbox.y})`);
      clip.appendChild(path);
      defs.appendChild(clip);
    });

    defsSvg.appendChild(defs);
    this.container.insertBefore(defsSvg, this.container.firstChild);
    this._clipDefsEl = defsSvg;
  }

  // ── Pieces ────────────────────────────────────────────

  _buildPieces() {
    const lay    = this.layout;
    const custom = lay.type === 'custom';
    const pb     = custom ? lay.puzzleBox : null;
    const sf     = custom ? this.sf : null;
    const key    = this.config.storageKey || 'default';
    const gridPW = custom ? 0 : this.frameW / lay.cols;
    const gridPH = custom ? 0 : this.frameH / lay.rows;

    this.pieces = lay.pieces.map((lp, i) => {
      const cfg = (this.config.pieces || [])[i] || {};

      const pw      = custom ? lp.bbox.w * sf              : gridPW;
      const ph      = custom ? lp.bbox.h * sf              : gridPH;
      const offsetX = custom ? (lp.bbox.x - pb.x) * sf    : lp.origin[0] * this.frameW;
      const offsetY = custom ? (lp.bbox.y - pb.y) * sf    : lp.origin[1] * this.frameH;

      const piece = document.createElement('div');
      piece.className = 'puzz-piece';
      piece.style.width  = `${pw}px`;
      piece.style.height = `${ph}px`;
      if (custom) piece.style.clipPath = `url(#puzz-clip-${key}-${lp.id})`;

      // Inner (for 3D flip)
      const inner = document.createElement('div');
      inner.className = 'puzz-piece-inner';

      // Front face
      const front = document.createElement('div');
      front.className = 'puzz-piece-front';

      const img = document.createElement('div');
      img.className = 'puzz-piece-image';
      img.style.backgroundImage    = `url(${this.config.image})`;
      img.style.backgroundSize     = `${this.frameW}px ${this.frameH}px`;
      img.style.backgroundPosition = `-${offsetX}px -${offsetY}px`;
      img.style.backgroundRepeat   = 'no-repeat';
      front.appendChild(img);

      const label = document.createElement('div');
      label.className = 'puzz-piece-label';
      const span = document.createElement('span');
      span.textContent = cfg.title || `Piece ${i + 1}`;
      label.appendChild(span);
      if (cfg.subtitle) {
        const sub = document.createElement('small');
        sub.className = 'puzz-piece-subtitle';
        sub.textContent = cfg.subtitle;
        label.appendChild(sub);
      }
      front.appendChild(label);

      inner.appendChild(front);

      // Back face — shown during flip animation (compact view, panel has full content)
      const back = document.createElement('div');
      back.className = 'puzz-piece-back';
      const h3 = document.createElement('h3');
      h3.textContent = cfg.title || `Piece ${i + 1}`;
      back.appendChild(h3);
      inner.appendChild(back);

      piece.appendChild(inner);
      this.container.appendChild(piece);

      const state = { el: piece, id: lp.id, slotIndex: i, placed: false, labelEl: label };

      this._scatter(piece);
      this._enableDrag(piece, state);

      return state;
    });
  }

  _scatter(el) {
    const margin  = 20;
    const pw      = parseInt(el.style.width);
    const ph      = parseInt(el.style.height);
    const cw      = this.container.clientWidth;
    const ch      = this.container.clientHeight;
    const fw      = this.frameW;
    const fh      = this.frameH;
    const fcx     = cw / 2;
    const fcy     = ch / 2;

    let x, y, tries = 0;
    do {
      x = margin + Math.random() * (cw - pw - margin * 2);
      y = margin + Math.random() * (ch - ph - margin * 2);
      tries++;
    } while (
      tries < 30 &&
      x > fcx - fw / 2 - pw && x < fcx + fw / 2 &&
      y > fcy - fh / 2 - ph && y < fcy + fh / 2
    );

    const rot = (Math.random() * 60) - 30;
    el.style.left      = `${x}px`;
    el.style.top       = `${y}px`;
    el.style.transform = `rotate(${rot}deg)`;
  }

  // ── Drag & Drop ───────────────────────────────────────

  _enableDrag(el, state) {
    let startX, startY, startLeft, startTop, dragging = false, moved = false;

    el.addEventListener('pointerdown', e => {
      if (this._currentExpanded) return;
      e.preventDefault();

      startX = e.clientX;
      startY = e.clientY;
      moved  = false;

      if (state.placed) return; // no drag for placed pieces, but startX/Y recorded for tap

      el.setPointerCapture(e.pointerId);
      dragging  = true;
      startLeft = parseInt(el.style.left) || 0;
      startTop  = parseInt(el.style.top)  || 0;

      el.classList.add('dragging');
      el.style.transform = 'rotate(0deg)';
      el.style.zIndex    = 200;

      if (!this.timerStart && this._pausedAt === null) this._startTimer();
    });

    el.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > 4) moved = true;
      if (moved) {
        el.style.left = `${startLeft + dx}px`;
        el.style.top  = `${startTop  + dy}px`;
      }
    });

    el.addEventListener('pointerup', e => {
      if (this._currentExpanded) return;
      const wasTap = !moved && startX !== undefined;

      if (dragging) {
        dragging = false;
        el.classList.remove('dragging');
        el.style.zIndex = 20;
        if (wasTap) {
          this._flip(el, state);
        } else {
          this._trySnap(el, state);
        }
      } else if (wasTap) {
        // placed piece tap
        this._flip(el, state);
      }

      moved = false;
    });
  }

  _trySnap(el, state) {
    const pw    = parseInt(el.style.width);
    const ph    = parseInt(el.style.height);
    const elCx  = parseInt(el.style.left) + pw / 2;
    const elCy  = parseInt(el.style.top)  + ph / 2;

    const slot   = this.slots[state.slotIndex];
    const frameRect = this.frameEl.getBoundingClientRect();
    const rootRect  = this.container.getBoundingClientRect();

    const slotLeft = frameRect.left - rootRect.left + slot.el.offsetLeft;
    const slotTop  = frameRect.top  - rootRect.top  + slot.el.offsetTop;
    const slotCx   = slotLeft + pw / 2;
    const slotCy   = slotTop  + ph / 2;

    const dist = Math.hypot(elCx - slotCx, elCy - slotCy);
    const SNAP_DIST = Math.min(pw, ph) * 0.55;

    if (dist < SNAP_DIST && !slot.occupied) {
      el.style.left      = `${slotLeft}px`;
      el.style.top       = `${slotTop}px`;
      el.style.transform = 'rotate(0deg)';
      el.classList.add('placed');
      state.placed = true;
      slot.occupied = true;
      if (slot.pathEl) slot.pathEl.style.opacity = '0';
      else             slot.el.classList.add('occupied');
      this._checkComplete();
    } else {
      const rot = (Math.random() * 30) - 15;
      el.style.transform = `rotate(${rot}deg)`;
    }
  }

  // ── Flip / Info Panel ─────────────────────────────────

  _flip(el, state) {
    if (this._currentExpanded) {
      this._closeExpanded();
      return;
    }
    this._currentExpanded = { el, state };
    el.classList.add('flipped');
    this._pauseTimer();
    const cfg = (this.config.pieces || [])[state.slotIndex] || {};
    this._openInfoPanel(cfg);
  }

  _openInfoPanel(cfg) {
    const backdrop = document.createElement('div');
    backdrop.className = 'puzz-info-backdrop';
    backdrop.addEventListener('click', () => this._closeExpanded());

    const panel = document.createElement('div');
    panel.className = 'puzz-info-panel';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'puzz-info-close';
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.addEventListener('click', e => {
      e.stopPropagation();
      this._closeExpanded();
    });
    panel.appendChild(closeBtn);

    const title = document.createElement('h2');
    title.className = 'puzz-info-title';
    title.textContent = cfg.title || '';
    panel.appendChild(title);

    if (cfg.subtitle) {
      const sub = document.createElement('p');
      sub.className = 'puzz-info-subtitle';
      sub.textContent = cfg.subtitle;
      panel.appendChild(sub);
    }

    if (cfg.description) {
      const body = document.createElement('div');
      body.className = 'puzz-info-body';
      body.innerHTML = Puzz._renderMarkdown(cfg.description);
      panel.appendChild(body);
    }

    this.container.appendChild(backdrop);
    this.container.appendChild(panel);
    this._backdropEl = backdrop;
    this._panelEl    = panel;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        backdrop.classList.add('visible');
        panel.classList.add('visible');
      });
    });
  }

  _closeExpanded() {
    if (!this._currentExpanded) return;
    const { el } = this._currentExpanded;
    this._currentExpanded = null;

    if (this._panelEl) {
      this._panelEl.classList.remove('visible');
      this._backdropEl.classList.remove('visible');
      const panelEl    = this._panelEl;
      const backdropEl = this._backdropEl;
      this._panelEl    = null;
      this._backdropEl = null;
      setTimeout(() => { panelEl.remove(); backdropEl.remove(); }, 400);
    }

    this._resumeTimer();
    setTimeout(() => el.classList.remove('flipped'), 50);
  }

  // ── Timer ─────────────────────────────────────────────

  _startTimer() {
    this.timerStart = Date.now();
    const tick = () => {
      if (!this.timerStart) return;
      const ms = Date.now() - this.timerStart;
      this.timerEl.textContent = Puzz._fmtTime(ms);
      this.timerRafId = requestAnimationFrame(tick);
    };
    this.timerRafId = requestAnimationFrame(tick);
  }

  _stopTimer() {
    cancelAnimationFrame(this.timerRafId);
    const elapsed = Date.now() - this.timerStart;
    this.timerStart = null;
    this._pausedAt  = null;
    return elapsed;
  }

  _pauseTimer() {
    if (!this.timerStart) return; // not running (not yet started, or already paused)
    this._pausedAt = Date.now() - this.timerStart;
    cancelAnimationFrame(this.timerRafId);
    this.timerRafId = null;
    this.timerStart = null;
  }

  _resumeTimer() {
    if (this._pausedAt === null) return; // nothing to resume
    this.timerStart = Date.now() - this._pausedAt;
    this._pausedAt  = null;
    const tick = () => {
      if (!this.timerStart) return;
      const ms = Date.now() - this.timerStart;
      this.timerEl.textContent = Puzz._fmtTime(ms);
      this.timerRafId = requestAnimationFrame(tick);
    };
    this.timerRafId = requestAnimationFrame(tick);
  }

  static _fmtTime(ms) {
    const s   = Math.floor(ms / 1000);
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
  }

  // ── Completion ────────────────────────────────────────

  _checkComplete() {
    if (!this.pieces.every(p => p.placed)) return;

    const elapsed = this._stopTimer();
    const scores  = this._loadScores();
    const n       = this.layout.total;

    const isFirst = scores.completions === 0;
    let secondsSaved = 0;

    scores.lastTime = elapsed;
    scores.completions += 1;
    scores.history = scores.history || [];
    scores.history.push(elapsed);

    if (isFirst || elapsed < (scores.fastestTime || Infinity)) {
      secondsSaved       = isFirst ? 0 : Math.floor((scores.fastestTime - elapsed) / 1000);
      scores.fastestTime = elapsed;
    }

    this._saveScores(scores);

    this.pieces.forEach(p => p.labelEl.style.opacity = '0');

    setTimeout(() => {
      this._frameBgEl.classList.add('revealed');
    }, 600);

    setTimeout(() => {
      this._celebrate(isFirst, secondsSaved, n, elapsed, scores);
    }, 800);
  }

  _celebrate(isFirst, secondsSaved, n, elapsed, scores) {
    this._burstEmojis('💜', n, 0);

    if (!isFirst && secondsSaved > 0) {
      const bonusCount = secondsSaved * n;
      const emojis     = this.config.celebrationEmojis || Puzz.DEFAULT_EMOJIS;
      this._burstEmojis(null, bonusCount, 80, emojis);
    }

    setTimeout(() => {
      this._showCompletionOverlay(this.config.completionMessage || 'Puzzle complete!');
    }, 1500);
  }

  _showCompletionOverlay(message) {
    const frameRect = this.frameEl.getBoundingClientRect();
    const rootRect  = this.container.getBoundingClientRect();

    const overlay = document.createElement('div');
    overlay.className = 'puzz-message-overlay';
    overlay.style.left   = `${frameRect.left - rootRect.left}px`;
    overlay.style.top    = `${frameRect.top  - rootRect.top}px`;
    overlay.style.width  = `${this.frameW}px`;
    overlay.style.height = `${this.frameH}px`;

    const wordWrap = document.createElement('div');
    wordWrap.className = 'puzz-message-words';
    const words = message.split(' ');
    words.forEach((word, i) => {
      const span = document.createElement('span');
      span.className = 'puzz-message-word';
      span.textContent = word;
      wordWrap.appendChild(span);
      if (i < words.length - 1) wordWrap.appendChild(document.createTextNode(' '));
    });
    overlay.appendChild(wordWrap);

    this.container.appendChild(overlay);
    this._completionEl = overlay;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => overlay.classList.add('visible'));
    });

    const WORD_DELAY = 380;
    wordWrap.querySelectorAll('.puzz-message-word').forEach((el, i) => {
      setTimeout(() => el.classList.add('visible'), 500 + i * WORD_DELAY);
    });
  }

  _burstEmojis(fixed, count, delayBetween, pool) {
    const root  = this.container;
    const cx    = root.clientWidth  / 2;
    const cy    = root.clientHeight / 2;

    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const span = document.createElement('span');
        span.className = 'puzz-emoji';
        span.textContent = fixed ?? pool[Math.floor(Math.random() * pool.length)];

        const angle = Math.random() * Math.PI * 2;
        const dist  = 120 + Math.random() * Math.min(root.clientWidth, root.clientHeight) * 0.35;
        const tx    = Math.cos(angle) * dist;
        const ty    = Math.sin(angle) * dist;
        const rot   = (Math.random() * 360) - 180;
        const dur   = 0.9 + Math.random() * 0.7;

        span.style.setProperty('--tx',  `${tx}px`);
        span.style.setProperty('--ty',  `${ty}px`);
        span.style.setProperty('--rot', `${rot}deg`);
        span.style.setProperty('--dur', `${dur}s`);
        span.style.left = `${cx + (Math.random() * 40 - 20)}px`;
        span.style.top  = `${cy + (Math.random() * 40 - 20)}px`;

        root.appendChild(span);
        span.addEventListener('animationend', () => span.remove());
      }, i * delayBetween);
    }
  }

  // ── Reset ─────────────────────────────────────────────

  reset() {
    // Close info panel immediately (no transition needed on reset)
    if (this._panelEl) {
      this._panelEl.remove();
      this._backdropEl.remove();
      this._panelEl    = null;
      this._backdropEl = null;
    }
    if (this._currentExpanded) {
      this._currentExpanded.el.classList.remove('flipped');
      this._currentExpanded = null;
    }
    this._pausedAt = null;

    if (this._completionEl) {
      this._completionEl.remove();
      this._completionEl = null;
    }
    this.container.querySelectorAll('.puzz-emoji').forEach(e => e.remove());

    this._frameBgEl.classList.remove('revealed');

    this.pieces.forEach(p => {
      p.placed    = false;
      p.el.classList.remove('placed', 'flipped');
      p.labelEl.style.opacity = '1';
      this._scatter(p.el);
    });

    this.slots.forEach(s => {
      s.occupied = false;
      if (s.pathEl) s.pathEl.style.opacity = '1';
      else          s.el.classList.remove('occupied');
    });

    this.timerEl.textContent = '0:00';
    cancelAnimationFrame(this.timerRafId);
    this.timerStart = null;
  }

  // ── LocalStorage ──────────────────────────────────────

  _storageKey() {
    return `puzz-${this.config.storageKey || 'default'}`;
  }

  _loadScores() {
    try {
      const raw = localStorage.getItem(this._storageKey());
      const scores = raw ? JSON.parse(raw) : { completions: 0, fastestTime: null, lastTime: null, history: [] };
      this._updateFooterStats(scores);
      return scores;
    } catch { return { completions: 0, fastestTime: null, lastTime: null, history: [] }; }
  }

  _saveScores(scores) {
    try {
      localStorage.setItem(this._storageKey(), JSON.stringify(scores));
      this._updateFooterStats(scores);
    } catch {}
  }

  _updateFooterStats(scores) {
    if (!this.solvesEl) return;
    this.solvesEl.textContent  = `Solves: ${scores.completions > 0 ? scores.completions : '—'}`;
    this.fastestEl.textContent = scores.fastestTime
      ? `Fastest: ${Puzz._fmtTime(scores.fastestTime)}`
      : 'Fastest: —';
  }

  // ── Markdown ──────────────────────────────────────────

  static _renderMarkdown(text) {
    if (!text) return '';

    function inlineFmt(s) {
      return s
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g,     '<em>$1</em>')
        .replace(/_(.+?)_/g,       '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
          const safe = url.toLowerCase().startsWith('javascript:') ? '#' : url;
          return `<a href="${safe}" target="_blank" rel="noopener">${text}</a>`;
        });
    }

    const lines  = text.split('\n');
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
      const trimmed = lines[i].trim();

      if (!trimmed) { i++; continue; }

      // H3 before H2 (longer prefix first)
      if (trimmed.startsWith('### ')) {
        blocks.push(`<h3>${inlineFmt(trimmed.slice(4))}</h3>`);
        i++; continue;
      }

      if (trimmed.startsWith('## ')) {
        blocks.push(`<h2>${inlineFmt(trimmed.slice(3))}</h2>`);
        i++; continue;
      }

      // Unordered list (- or *)
      if (/^[-*]\s/.test(trimmed)) {
        const items = [];
        while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
          items.push(`<li>${inlineFmt(lines[i].trim().slice(2))}</li>`);
          i++;
        }
        blocks.push(`<ul>${items.join('')}</ul>`);
        continue;
      }

      // Paragraph: accumulate consecutive non-special lines
      const para = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!t || t.startsWith('#') || /^[-*]\s/.test(t)) break;
        para.push(t);
        i++;
      }
      if (para.length) blocks.push(`<p>${inlineFmt(para.join(' '))}</p>`);
    }

    return blocks.join('\n');
  }
}
