/* ChessPrep · the chessboard, drawn like ChessDetective's: squares and coordinates, last-move
   and classification highlights, arrows and icons. Pieces move by drag or by click / tap. */
(function () {
  'use strict';

  const { square, fileOf, rankOf, colorOf } = globalThis.ChessRules;
  const SVG = 'http://www.w3.org/2000/svg';
  const MOVE_MS = 200;
  /** ChessDetective's arrow colours: red for what you played, lime for the right move. */
  const ARROWS = {
    red: { fill: 'rgb(232, 64, 52)', opacity: 0.784 },
    green: { fill: 'rgb(155, 213, 52)', opacity: 0.843 },
  };

  const pieceSrc = (p) => `assets/pieces/${colorOf(p)}${p.toUpperCase()}.svg`;

  function el(tag, className, parent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (parent) parent.appendChild(node);
    return node;
  }

  class Board {
    /** `onMove(move, via)` gets every legal move you make; `via` is "drag" or "click". */
    constructor(root, { onMove }) {
      this.root = root;
      this.onMove = onMove;
      this.state = null;
      this.selected = -1;
      this.press = null;
      this.pieceEls = new Map();
      this.keys = {};
      root.classList.add('board');
      root.innerHTML = '';
      const squares = el('div', 'layer squares', root);
      for (let i = 0; i < 64; i++) el('div', (Math.floor(i / 8) + i) % 2 ? 'sq dark' : 'sq light', squares);
      this.marks = el('div', 'layer marks', root);
      this.coords = el('div', 'layer coords', root);
      this.pieces = el('div', 'layer pieces', root);
      this.hints = el('div', 'layer hints', root);
      this.arrows = document.createElementNS(SVG, 'svg');
      this.arrows.setAttribute('class', 'layer arrows');
      this.arrows.setAttribute('viewBox', '0 0 8 8');
      root.appendChild(this.arrows);
      this.icons = el('div', 'layer icons', root);

      root.addEventListener('pointerdown', (e) => this._down(e));
      root.addEventListener('pointermove', (e) => this._move(e));
      root.addEventListener('pointerup', (e) => this._up(e));
      root.addEventListener('pointercancel', () => this._cancel());
      root.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    /** Sets the board's size in CSS pixels. */
    resize(px) {
      this.root.style.width = `${px}px`;
      this.root.style.height = `${px}px`;
      this.root.style.setProperty('--sq', `${px / 8}px`);
    }

    /**
     * Draws `state`: { position, flipped, lastMove: {from, to}, tint (css colour of the last
     * move's squares), icon: {square, src}, arrows: [{from, to, color}], interactive,
     * animation: {pairs: [[from, to]], appear: [squares]} }.
     */
    render(state) {
      const prev = this.state;
      this.state = state;
      const positionKey = `${state.position.board.join()}|${state.position.turn}|${state.flipped}`;
      if (!state.interactive || (prev && positionKey !== this.keys.position)) this._cancel(true);
      if (positionKey !== this.keys.position) {
        this.keys.position = positionKey;
        this._drawPieces(state.animation);
      }
      if (!state.interactive) this.root.style.cursor = '';
      if (!prev || prev.flipped !== state.flipped) this._drawCoords();
      this._drawMarks();
      this._drawHints();
      this._drawArrows();
      this._drawIcon(state.animation);
    }

    // ---------------------------------------------------------------- geometry

    _cell(s) {
      const f = fileOf(s);
      const r = rankOf(s);
      return this.state.flipped ? { col: 7 - f, row: r } : { col: f, row: 7 - r };
    }

    _place(node, s) {
      const { col, row } = this._cell(s);
      node.style.left = `${col * 12.5}%`;
      node.style.top = `${row * 12.5}%`;
    }

    _squareAt(x, y) {
      const rect = this.root.getBoundingClientRect();
      const col = Math.floor(((x - rect.left) / rect.width) * 8);
      const row = Math.floor(((y - rect.top) / rect.height) * 8);
      if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
      return this.state.flipped ? square(7 - col, row) : square(col, 7 - row);
    }

    // ---------------------------------------------------------------- layers

    _drawPieces(animation) {
      this.pieces.innerHTML = '';
      this.pieceEls.clear();
      const board = this.state.position.board;
      for (let s = 0; s < 64; s++) {
        if (!board[s]) continue;
        const img = el('img', 'piece', this.pieces);
        img.src = pieceSrc(board[s]);
        img.alt = '';
        img.draggable = false;
        this._place(img, s);
        this.pieceEls.set(s, img);
      }
      if (!animation) return;
      for (const [from, to] of animation.pairs || []) {
        const img = this.pieceEls.get(to);
        if (!img) continue;
        const a = this._cell(from);
        const b = this._cell(to);
        img.style.zIndex = 2;
        const anim = img.animate(
          [{ transform: `translate(${(a.col - b.col) * 100}%, ${(a.row - b.row) * 100}%)` }, { transform: 'none' }],
          { duration: MOVE_MS, easing: 'cubic-bezier(.3, .1, .3, 1)' },
        );
        anim.onfinish = anim.oncancel = () => (img.style.zIndex = '');
      }
      for (const s of animation.appear || []) {
        const img = this.pieceEls.get(s);
        if (img) img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOVE_MS, easing: 'ease-in' });
      }
    }

    _drawCoords() {
      this.coords.innerHTML = '';
      for (let i = 0; i < 8; i++) {
        const rank = this.state.flipped ? i : 7 - i;
        const fileSq = square(this.state.flipped ? 7 : 0, rank);
        const r = el('span', `coord rank ${(fileOf(fileSq) + rank) % 2 ? 'on-light' : 'on-dark'}`, this.coords);
        r.textContent = rank + 1;
        r.style.top = `${i * 12.5}%`;
        const file = this.state.flipped ? 7 - i : i;
        const rankSq = square(file, this.state.flipped ? 7 : 0);
        const f = el('span', `coord file ${(file + rankOf(rankSq)) % 2 ? 'on-light' : 'on-dark'}`, this.coords);
        f.textContent = 'abcdefgh'[file];
        f.style.left = `${i * 12.5}%`;
      }
    }

    _drawMarks() {
      this.marks.innerHTML = '';
      const { lastMove, tint, position } = this.state;
      if (lastMove) {
        for (const s of [lastMove.from, lastMove.to]) {
          const m = el('div', 'mark', this.marks);
          m.style.background = tint || 'var(--last-move)';
          this._place(m, s);
        }
      }
      if (this.selected >= 0) this._place(el('div', 'mark selected', this.marks), this.selected);
      if (position.inCheck()) {
        const k = position.kingSquare(position.turn);
        if (k >= 0) this._place(el('div', 'mark check', this.marks), k);
      }
    }

    _drawHints() {
      this.hints.innerHTML = '';
      if (this.selected < 0) return;
      const { position } = this.state;
      for (const m of position.legalMoves()) {
        if (m.from !== this.selected || (m.promotion && m.promotion !== 'q')) continue;
        const capture = Boolean(position.board[m.to]);
        this._place(el('div', capture ? 'hint capture' : 'hint', this.hints), m.to);
      }
    }

    _drawArrows() {
      this.arrows.innerHTML = '';
      for (const a of this.state.arrows || []) this._arrow(a);
    }

    /** ChessDetective's arrow: a bar and a head; knight moves get an L-shaped one. */
    _arrow({ from, to, color }) {
      const center = (s) => {
        const c = this._cell(s);
        return { x: c.col + 0.5, y: c.row + 0.5 };
      };
      const a = center(from);
      const b = center(to);
      const df = Math.abs(fileOf(from) - fileOf(to));
      const dr = Math.abs(rankOf(from) - rankOf(to));
      const points = [a];
      if ((df === 1 && dr === 2) || (df === 2 && dr === 1)) {
        points.push(Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
      }
      points.push(b);
      const width = 0.19;
      const headLength = 0.42;
      const headHalf = 0.27;
      const style = ARROWS[color] || ARROWS.green;
      const g = document.createElementNS(SVG, 'g');
      g.setAttribute('fill', style.fill);
      g.setAttribute('opacity', style.opacity);
      const polygon = (pts) => {
        const p = document.createElementNS(SVG, 'polygon');
        p.setAttribute('points', pts.map((q) => `${q.x.toFixed(4)},${q.y.toFixed(4)}`).join(' '));
        g.appendChild(p);
      };
      for (let i = 0; i < points.length - 1; i++) {
        const p = points[i];
        const q = points[i + 1];
        const len = Math.hypot(q.x - p.x, q.y - p.y);
        const dx = (q.x - p.x) / len;
        const dy = (q.y - p.y) / len;
        const at = (o, along, across) => ({ x: o.x + dx * along - dy * across, y: o.y + dy * along + dx * across });
        const last = i === points.length - 2;
        const start = at(p, i === 0 ? 0.1 : width / 2, 0);
        const end = last ? at(q, -headLength, 0) : at(q, width / 2, 0);
        const w = width / 2;
        polygon([at(start, 0, -w), at(end, 0, -w), at(end, 0, w), at(start, 0, w)]);
        if (last) polygon([at(end, 0, -headHalf), q, at(end, 0, headHalf)]);
      }
      this.arrows.appendChild(g);
    }

    /** The classification icon, on the top-right corner of its square (kept on the board). */
    _drawIcon(animation) {
      const icon = this.state.icon;
      const key = icon ? `${icon.src}|${icon.square}|${this.state.flipped}` : '';
      if (key === this.keys.icon) return;
      this.keys.icon = key;
      this.icons.innerHTML = '';
      if (!icon) return;
      const { col, row } = this._cell(icon.square);
      const img = el('img', 'class-icon', this.icons);
      img.src = icon.src;
      img.alt = '';
      img.draggable = false;
      // 0.46 of a square, centred 0.18 of its size in from the corner, as ChessDetective draws it.
      const size = 0.46;
      const left = Math.min(col + 1 - size * 0.18 - size / 2, 8 - size);
      const top = Math.max(row + size * 0.18 - size / 2, 0);
      img.style.left = `${left * 12.5}%`;
      img.style.top = `${top * 12.5}%`;
      if (animation) img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, delay: MOVE_MS, fill: 'backwards' });
    }

    // ---------------------------------------------------------------- input

    _own(s) {
      const p = this.state.position.board[s];
      return Boolean(p) && colorOf(p) === this.state.position.turn;
    }

    _down(e) {
      if (!this.state || !this.state.interactive || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const s = this._squareAt(e.clientX, e.clientY);
      if (s < 0) return;
      e.preventDefault();
      this.press = { id: e.pointerId, square: s, x: e.clientX, y: e.clientY, own: this._own(s), touch: e.pointerType !== 'mouse', dragging: false };
      if (this.press.own) this.root.setPointerCapture(e.pointerId);
    }

    _move(e) {
      const p = this.press;
      if (!p || p.id !== e.pointerId) {
        // The grab cursor over your pieces, like ChessDetective.
        if (e.pointerType === 'mouse' && this.state) {
          const s = this.state.interactive ? this._squareAt(e.clientX, e.clientY) : -1;
          this.root.style.cursor = s >= 0 && this._own(s) ? 'grab' : '';
        }
        return;
      }
      if (!p.own) return;
      if (!p.dragging) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < (p.touch ? 8 : 4)) return;
        p.dragging = true;
        this.selected = p.square;
        this.root.style.cursor = 'grabbing';
        const piece = this.pieceEls.get(p.square);
        if (piece) piece.style.visibility = 'hidden';
        this.ghost = el('img', 'piece ghost', this.root);
        this.ghost.src = piece ? piece.src : '';
        this.ghost.alt = '';
        this.ghostScale = p.touch ? 1.6 : 1.05;
        this._drawMarks();
        this._drawHints();
      }
      const rect = this.root.getBoundingClientRect();
      const size = (rect.width / 8) * this.ghostScale;
      const lift = p.touch ? size * 0.45 : 0;
      this.ghost.style.width = this.ghost.style.height = `${size}px`;
      this.ghost.style.left = `${e.clientX - rect.left - size / 2}px`;
      this.ghost.style.top = `${e.clientY - rect.top - size / 2 - lift}px`;
    }

    _up(e) {
      const p = this.press;
      if (!p || p.id !== e.pointerId) return;
      this.press = null;
      const target = this._squareAt(e.clientX, e.clientY);
      if (p.dragging) {
        this._endDrag();
        if (target >= 0 && target !== p.square && this._play(p.square, target, 'drag')) return;
        this.selected = p.square; // a drag that went nowhere keeps the piece picked up
      } else if (this.selected >= 0 && target >= 0 && target !== this.selected && this._play(this.selected, target, 'click')) {
        return;
      } else {
        this.selected = p.own && this.selected !== p.square ? p.square : -1;
      }
      this._drawMarks();
      this._drawHints();
    }

    _play(from, to, via) {
      const move = this.state.position.find(from, to);
      if (!move) return false;
      this.selected = -1;
      this.onMove(move, via);
      return true;
    }

    _endDrag() {
      this.root.style.cursor = '';
      if (this.ghost) this.ghost.remove();
      this.ghost = null;
      for (const img of this.pieceEls.values()) img.style.visibility = '';
    }

    /** Drops whatever you were doing with the mouse or finger. */
    _cancel(quiet) {
      const had = this.selected >= 0 || this.press;
      this.press = null;
      this.selected = -1;
      this._endDrag();
      if (had && !quiet) {
        this._drawMarks();
        this._drawHints();
      }
    }
  }

  globalThis.Board = Board;
})();
