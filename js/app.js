/* ChessPrep · the trainer. You play Stockfish's side of each saved Stress Test while the other
   side's moves play themselves. A wrong move turns red and is taken back, the right move is
   shown, and after "Try again" you play it yourself. */
(function () {
  'use strict';

  const { Board, Games, ChessRules } = globalThis;
  const $ = (id) => document.getElementById(id);

  const DELAY_START = 800; // a new line: a moment to look at the position first
  const DELAY_REPLY = 500; // after your move, before the other side answers
  const WRONG_SHOWN = 900; // how long a wrong move stays on the board
  const REVEAL_PAUSE = 500; // from taking it back to showing the right move
  /** The phone layout (style.css uses the same media query). */
  const ONE_COLUMN = '(max-width: 759px), (max-width: 1199px) and (orientation: portrait)';
  const TINT_WRONG = 'rgba(250, 65, 45, 0.47)';
  const TINT_RIGHT = 'rgba(129, 182, 76, 0.47)';

  const S = {
    sections: [],
    unreadable: 0,
    picked: false,
    line: null,
    cursor: 0, // moves played on the board so far
    view: 0, // the position shown (an earlier one while you look back)
    phase: 'loading', // opponent | turn | wrong | takeback | reveal | done
    missed: new Set(), // your moves (by ply) that you didn't find the first time
    feedback: null, // { ply, again } after a right move
    wrong: null, // { move, san }: the wrong move being shown
    flipped: false,
    showClasses: false,
    showEval: false,
    timer: 0,
  };

  const board = new Board($('board'), { onMove: onBoardMove });

  // ------------------------------------------------------------------ helpers

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const sideName = (c) => (c === 'w' ? 'White' : 'Black');
  const iconSrc = (name) => `assets/icons/${name}.svg`;

  /** "9. e4" / "9... Nf6" for the move played from position `ply`. */
  function numbered(ply, san) {
    const n = Math.floor(ply / 2) + 1;
    return ply % 2 ? `${n}... ${san}` : `${n}. ${san}`;
  }

  /** "Sicilian Defense: Alapin Variation" → "Alapin Variation" (short names stay whole). */
  function shortName(opening) {
    const i = opening.indexOf(':');
    const rest = i < 0 ? '' : opening.slice(i + 1).trim();
    return rest.split(/\s+/).length >= 2 ? rest : opening;
  }

  function fmtDate(unix) {
    return new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function sectionLabel(s) {
    return `<span class="side-tag ${s.side === 'w' ? 'white' : 'black'}">${sideName(s.side)}</span><span>${esc(s.name)}</span>`;
  }

  function classTint(cls) {
    const n = parseInt(Games.CLASSES[cls].color.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, 0.47)`;
  }

  /** The icon for a classified move that led to `position` (checkmate sits on the mated king). */
  function classIcon(move, position) {
    if (move.cls !== 'checkmate') return { square: move.to, src: iconSrc(move.cls) };
    const mated = position.turn;
    return { square: position.kingSquare(mated), src: iconSrc(mated === 'w' ? 'checkmate_white' : 'checkmate_black') };
  }

  /** The pieces that move in `m`, for the board's animation; `back` takes the move back. */
  function motion(m, back) {
    const pairs = [[m.from, m.to]];
    if (m.kind === 'castle') pairs.push([m.rookFrom, m.rookTo]);
    if (!back) return { pairs };
    const appear = [];
    if (m.captured) {
      appear.push(m.kind === 'ep' ? ChessRules.square(ChessRules.fileOf(m.to), ChessRules.rankOf(m.from)) : m.to);
    }
    return { pairs: pairs.map(([a, b]) => [b, a]), appear };
  }

  function later(ms, fn) {
    clearTimeout(S.timer);
    S.timer = setTimeout(() => {
      S.timer = 0;
      fn();
    }, ms);
  }

  function stopTimer() {
    clearTimeout(S.timer);
    S.timer = 0;
  }

  function findLine(id) {
    for (const s of S.sections) for (const l of s.lines) if (l.id === id) return l;
    return null;
  }

  // ------------------------------------------------------------------ eval bar (ChessDetective's)

  /** White's expected score (lichess' curve), as ChessDetective's bar shows it. */
  function whiteShare(ev) {
    const mate = ev.mate !== undefined;
    const e = mate ? (ev.mate > 0 ? 1 : 0) : 1 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, ev.cp))));
    const white = ev.stm === 'w' ? e : 1 - e;
    return mate ? white : Math.max(0.05, Math.min(0.95, white));
  }

  function barText(ev) {
    if (ev.mate !== undefined) return ev.mate === 0 ? '#' : `M${Math.abs(ev.mate)}`;
    return (Math.abs(ev.cp) / 100).toFixed(1);
  }

  /** "+0.45", "-1.20", "M3", "-M2" or "#", from White's side. */
  function whiteText(ev) {
    const sign = ev.stm === 'w' ? 1 : -1;
    if (ev.mate === undefined) {
      const v = (sign * ev.cp) / 100;
      return `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}`;
    }
    if (ev.mate === 0) return '#';
    const n = sign * ev.mate;
    return n > 0 ? `M${n}` : `-M${-n}`;
  }

  // ------------------------------------------------------------------ the line

  function openLine(line) {
    stopTimer();
    closeLines();
    S.line = line;
    S.cursor = S.view = line.start;
    S.missed = new Set();
    S.feedback = null;
    S.wrong = null;
    S.flipped = line.side === 'b';
    if (decodeURIComponent(location.hash.slice(1)) !== line.id) {
      history.replaceState(null, '', `#${encodeURIComponent(line.id)}`);
    }
    renderLines();
    advance(null);
  }

  /** Goes on from the live position: the other side's moves play themselves. */
  function advance(animation) {
    const l = S.line;
    if (S.cursor >= l.moves.length) {
      finish(animation);
      return;
    }
    if (l.positions[S.cursor].turn === l.side) {
      S.phase = 'turn';
      render(animation);
      return;
    }
    S.phase = 'opponent';
    render(animation);
    later(S.cursor === l.start ? DELAY_START : DELAY_REPLY, () => {
      const follow = S.view === S.cursor;
      S.cursor++;
      if (follow) S.view = S.cursor;
      advance(follow ? motion(l.moves[S.cursor - 1]) : null);
    });
  }

  function onBoardMove(move, via) {
    if (S.phase !== 'turn' || S.view !== S.cursor) return;
    const l = S.line;
    const ply = S.cursor;
    const pos = l.positions[ply];
    const right = l.moves[ply];
    const animation = via === 'click' ? motion(move) : null;
    // The board always promotes to a queen: a promotion on the right squares counts as right.
    const isRight =
      pos.uci(move) === right.uci ||
      (move.promotion && right.promotion && move.from === right.from && move.to === right.to);
    if (isRight) {
      S.feedback = { ply, again: S.missed.has(ply) };
      S.wrong = null;
      S.cursor = S.view = ply + 1;
      advance(animation);
      return;
    }
    S.missed.add(ply);
    S.feedback = null;
    S.wrong = { move, san: pos.san(move) };
    S.phase = 'wrong';
    render(animation);
    later(WRONG_SHOWN, () => {
      S.phase = 'takeback';
      render(motion(S.wrong.move, true));
      later(REVEAL_PAUSE, reveal);
    });
  }

  /** Shows the move Stockfish played, on the board. */
  function reveal() {
    S.phase = 'reveal';
    render(motion(S.line.moves[S.cursor]));
  }

  /** "Show the move": no guess, just the answer (it counts as missed). */
  function showMove() {
    if (S.phase !== 'turn') return;
    S.missed.add(S.cursor);
    S.feedback = null;
    S.wrong = null;
    S.view = S.cursor;
    reveal();
  }

  /** The right move goes back, so you play it yourself. */
  function tryAgain() {
    if (S.phase !== 'reveal') return;
    S.phase = 'turn';
    S.wrong = null;
    render(motion(S.line.moves[S.cursor], true));
  }

  function finish(animation) {
    stopTimer();
    S.phase = 'done';
    render(animation);
  }

  function nextLine() {
    const next = S.line && S.line.section.lines[S.line.index + 1];
    if (next) openLine(next);
  }

  /** Looking back through the moves (only between your moves). */
  function goTo(i) {
    if (!S.line || !['opponent', 'turn', 'done'].includes(S.phase)) return;
    const target = Math.max(0, Math.min(S.cursor, i));
    if (target === S.view) return;
    const step = target - S.view;
    const moves = S.line.moves;
    const animation = step === 1 ? motion(moves[S.view]) : step === -1 ? motion(moves[target], true) : null;
    S.view = target;
    render(animation);
  }

  // ------------------------------------------------------------------ drawing

  function render(animation) {
    if (!S.line) return;
    renderBoard(animation || null);
    renderEval();
    renderPlayers();
    renderHead();
    renderStatus();
    renderActions();
    renderMoves();
    renderNav();
  }

  function renderBoard(animation) {
    const l = S.line;
    const ply = S.cursor;
    const view = { flipped: S.flipped, arrows: [], icon: null, tint: null, lastMove: null, interactive: false, animation };
    let last = null;
    if (S.phase === 'wrong' || S.phase === 'takeback') {
      // Your move in red: on the board for a moment, then taken back.
      view.position = S.phase === 'wrong' ? l.positions[ply].play(S.wrong.move) : l.positions[ply];
      view.lastMove = S.wrong.move;
      view.tint = TINT_WRONG;
      if (S.phase === 'wrong') view.icon = { square: S.wrong.move.to, src: iconSrc('wrong') };
      board.render(view);
      return;
    }
    if (S.phase === 'reveal') {
      last = l.moves[ply];
      view.position = l.positions[ply + 1];
      view.tint = TINT_RIGHT;
      if (S.wrong) view.arrows.push({ from: S.wrong.move.from, to: S.wrong.move.to, color: 'red' });
      view.arrows.push({ from: last.from, to: last.to, color: 'green' });
    } else {
      view.position = l.positions[S.view];
      last = S.view > 0 ? l.moves[S.view - 1] : null;
      view.interactive = S.phase === 'turn' && S.view === S.cursor;
    }
    view.lastMove = last;
    if (last && S.showClasses && last.cls) {
      if (!view.tint && last.cls !== 'checkmate') view.tint = classTint(last.cls);
      view.icon = classIcon(last, view.position);
    }
    board.render(view);
  }

  function renderEval() {
    const bar = $('evalbar');
    bar.hidden = !S.showEval;
    document.body.classList.toggle('show-eval', S.showEval);
    if (!S.showEval) return;
    const l = S.line;
    const at = S.phase === 'wrong' || S.phase === 'takeback' ? S.cursor : S.phase === 'reveal' ? S.cursor + 1 : S.view;
    const ev = l.evals[at];
    const share = ev ? whiteShare(ev) : 0.5;
    bar.classList.toggle('flipped', S.flipped);
    bar.classList.toggle('unknown', !ev);
    bar.querySelector('.evalbar-white').style.height = `${share * 100}%`;
    const text = bar.querySelector('.evalbar-text');
    if (!ev) {
      text.textContent = '';
      bar.title = 'No evaluation saved for this position';
      return;
    }
    const whiteBetter = share >= 0.5;
    text.textContent = barText(ev);
    text.className = `evalbar-text ${whiteBetter !== S.flipped ? 'bottom' : 'top'} ${whiteBetter ? 'on-white' : 'on-dark'}`;
    bar.title = `${l.engine}: ${whiteText(ev)}`;
  }

  function renderPlayers() {
    const l = S.line;
    const label = (c) => {
      const who = c === l.side ? `You <span class="who">· ${esc(l.engine)}'s moves</span>` : 'Opponent';
      return `<span class="dot ${c === 'w' ? 'white' : 'black'}"></span>${who}`;
    };
    $('player-top').innerHTML = label(S.flipped ? 'w' : 'b');
    $('player-bottom').innerHTML = label(S.flipped ? 'b' : 'w');
  }

  function renderHead() {
    const l = S.line;
    $('line-title').textContent = l.opening;
    $('line-sub').innerHTML = `${sectionLabel(l.section)}<span>· Line ${l.index + 1} of ${l.section.lines.length}</span>`;
  }

  function statusRow(icon, html) {
    return `<div class="status-row"><img src="${iconSrc(icon)}" alt="">${html}</div>`;
  }

  function renderStatus() {
    const l = S.line;
    const ply = S.cursor;
    const parts = [];
    const feedback = () => {
      const f = S.feedback;
      const san = numbered(f.ply, l.moves[f.ply].san);
      return `<div class="feedback">✓ ${esc(san)} ${f.again ? "— that's it" : 'is right'}</div>`;
    };
    switch (S.phase) {
      case 'opponent':
        if (S.feedback) parts.push(feedback());
        else {
          parts.push(`<div class="status-title">You play ${sideName(l.side)}</div>`);
          parts.push(`<div class="status-text">Find the moves ${esc(l.engine)} played. The other side moves by itself.</div>`);
        }
        parts.push('<div class="status-small">Opponent to move…</div>');
        break;
      case 'turn': {
        if (S.feedback) parts.push(feedback());
        const again = S.missed.has(ply) && !S.feedback;
        const k = l.guesses.indexOf(ply) + 1;
        parts.push(
          `<div class="status-split"><span class="status-title">${again ? 'Now play it yourself' : 'Your move'}</span>` +
            `<span class="status-small">Move ${k} of ${l.guesses.length}</span></div>`,
        );
        parts.push(
          `<div class="status-text weak">${again ? 'Play the move you were just shown.' : `What did ${esc(l.engine)} play here?`}</div>`,
        );
        if (S.view !== S.cursor) {
          parts.push('<div class="status-note">You are looking at an earlier position: ⏭ takes you back to the game.</div>');
        }
        break;
      }
      case 'wrong':
        parts.push(statusRow('wrong', `<span class="status-title red">Wrong move: ${esc(numbered(ply, S.wrong.san))}</span>`));
        parts.push(`<div class="status-text">That's not what ${esc(l.engine)} played.</div>`);
        break;
      case 'takeback':
      case 'reveal': {
        if (S.wrong) {
          parts.push(statusRow('wrong', `<span class="status-title red">${esc(numbered(ply, S.wrong.san))} is not the move</span>`));
        }
        if (S.phase === 'reveal') {
          const right = numbered(ply, l.moves[ply].san);
          parts.push(statusRow('best', `<span class="status-title green">${esc(l.engine)} played ${esc(right)}</span>`));
          parts.push('<button class="button big amber" type="button" data-action="try-again">Try again</button>');
          parts.push('<div class="status-small">Play it yourself so it sticks (Enter).</div>');
        } else {
          parts.push('<div class="status-text weak">The right move is…</div>');
        }
        break;
      }
      case 'done': {
        const total = l.guesses.length;
        const right = total - S.missed.size;
        const next = l.section.lines[l.index + 1];
        parts.push('<div class="status-title">Line complete</div>');
        parts.push(
          right === total
            ? statusRow('best', `<span class="status-title green">All ${total} moves right the first time!</span>`)
            : `<div class="status-text">${right} of ${total} moves right the first time.</div>`,
        );
        if (next) {
          parts.push('<button class="button big green" type="button" data-action="next">Next line ▶</button>');
        } else {
          parts.push(
            `<div class="status-note">That was the last line of ${esc(sideName(l.section.side))} · ${esc(l.section.name)}. ` +
              'There are no more lines to go through.</div>',
          );
          if (l.section.lines.length > 1) {
            parts.push('<button class="button" type="button" data-action="first">Back to line 1</button>');
          }
        }
        break;
      }
    }
    $('status').innerHTML = parts.join('');
  }

  function renderActions() {
    const canShow = S.phase === 'turn';
    $('actions').innerHTML =
      `<div class="action-row">` +
      `<button class="button wide" type="button" data-action="show"${canShow ? '' : ' disabled'}>Show the move</button>` +
      '<button class="button wide" type="button" data-action="restart">↺ Restart line</button>' +
      '</div>';
  }

  function renderMoves() {
    const l = S.line;
    if (!S.cursor) {
      $('moves').innerHTML = '<span class="none">No moves yet.</span>';
      return;
    }
    const out = [];
    for (let i = 0; i < S.cursor; i++) {
      const m = l.moves[i];
      let num = '';
      if (i % 2 === 0) num = `${i / 2 + 1}.`;
      else if (i === l.start) num = `${(i - 1) / 2 + 1}...`;
      const cls = S.showClasses ? m.cls : null;
      const info = cls ? Games.CLASSES[cls] : null;
      const kind = i < l.start ? 'setup' : l.positions[i].turn === l.side ? (S.missed.has(i) ? 'missed' : 'right') : 'opp';
      const icon = cls ? `<img src="${iconSrc(cls === 'checkmate' ? 'checkmate_white' : cls)}" alt="${info.label}" title="${info.label}">` : '';
      out.push(
        `<span class="mv">${num ? `<span class="num">${num}</span>` : ''}${icon}` +
          `<button type="button" class="chip ${kind}${S.view === i + 1 ? ' selected' : ''}" data-ply="${i + 1}">` +
          `${esc(m.san)}${info ? info.glyph : ''}</button></span>`,
      );
      if (i === l.start - 1) out.push('<span class="divider" title="Stockfish\'s moves start here">│</span>');
    }
    $('moves').innerHTML = out.join('');
  }

  function renderNav() {
    const free = ['opponent', 'turn', 'done'].includes(S.phase);
    for (const b of document.querySelectorAll('[data-go]')) {
      const back = b.dataset.go === 'start' || b.dataset.go === 'back';
      b.disabled = !free || (back ? S.view <= 0 : S.view >= S.cursor);
    }
  }

  function renderLines() {
    const html = [];
    for (const s of S.sections) {
      html.push(`<div class="section-head">${sectionLabel(s)}<span class="count">${s.lines.length}</span></div>`);
      s.lines.forEach((l, i) => {
        const first = l.guesses[0];
        const after = first > 0 ? `after ${numbered(first - 1, l.moves[first - 1].san)}` : 'from the start';
        const detail = `${after} · ${l.guesses.length} moves${l.saved ? ` · ${fmtDate(l.saved)}` : ''}`;
        html.push(
          `<button type="button" class="line-row${l === S.line ? ' selected' : ''}" data-line="${esc(l.id)}" title="${esc(l.opening)}">` +
            `<span class="line-number">${i + 1}</span>` +
            `<span class="line-text"><span class="line-name">${esc(shortName(l.opening))}</span>` +
            `<span class="line-detail">${esc(detail)}</span></span></button>`,
        );
      });
    }
    $('sections').innerHTML = html.join('');
    // Keep the line you play in sight in the side column (the phone drawer does this on opening).
    const selected = document.querySelector('.line-row.selected');
    if (selected && window.matchMedia('(min-width: 1200px)').matches) selected.scrollIntoView({ block: 'nearest' });
    const notes = [];
    if (S.unreadable) notes.push(`<p>${S.unreadable} file${S.unreadable === 1 ? '' : 's'} in the folder could not be read.</p>`);
    notes.push(
      S.picked
        ? '<p>Playing the files you picked (until you reload the page).</p>'
        : '<p>New Stress Tests: copy their .json files into the <code>games</code> folder and upload them.</p>',
    );
    notes.push('<p><button class="button small" type="button" data-action="pick">Choose files…</button></p>');
    $('lines-note').innerHTML = notes.join('');
  }

  function showEmpty(kind, n) {
    stopTimer();
    S.line = null;
    document.body.classList.add('no-games');
    const box = $('empty');
    box.hidden = false;
    const pick = '<button class="button" type="button" data-action="pick">Choose Stress Test files…</button>';
    box.innerHTML = {
      loading: '<h2>Loading your games…</h2>',
      file:
        "<h2>Can't open the games folder</h2>" +
        "<p>Opened straight from a file, your browser doesn't let the page read the <code>games</code> " +
        'folder. On GitHub Pages it finds your games by itself.</p>' +
        '<p>For now, pick your Stress Test files (.json) to play them:</p>' +
        pick,
      none:
        '<h2>No games yet</h2>' +
        '<p>Copy your Stress Test files (.json) into the <code>games</code> folder and upload them. ' +
        'ChessDetective saves them in <code>~/.local/share/chessdetective/stress-tests</code>.</p>' +
        pick,
      unreadable:
        '<h2>No Stress Tests found</h2>' +
        `<p>None of the ${n} file${n === 1 ? '' : 's'} could be read as a ChessDetective Stress Test.</p>` +
        pick,
    }[kind];
  }

  // ------------------------------------------------------------------ layout

  /** Sizes the board to fit: the height on a computer, the width on a phone. */
  function layout() {
    let size;
    if (window.matchMedia(ONE_COLUMN).matches) {
      // Full width, leaving room below the board for the move box.
      const bar = S.showEval ? 20 : 0;
      size = Math.min(window.innerWidth - 16 - bar, window.innerHeight - 260);
    } else {
      const center = document.querySelector('.center');
      const style = getComputedStyle(center);
      const width = center.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2 * 36;
      // Room for the two player lines, the buttons and the checkboxes.
      const height = center.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 150;
      size = Math.min(width, height);
    }
    size = Math.max(200, Math.floor(size / 8) * 8);
    board.resize(size);
    document.documentElement.style.setProperty('--board-size', `${size}px`);
  }

  function openLines() {
    document.body.classList.add('lines-open');
    const selected = document.querySelector('.line-row.selected');
    if (selected) selected.scrollIntoView({ block: 'center' });
  }

  function closeLines() {
    document.body.classList.remove('lines-open');
  }

  // ------------------------------------------------------------------ input

  function onAction(e) {
    const button = e.target.closest('[data-action]');
    if (!button || button.disabled) return;
    switch (button.dataset.action) {
      case 'try-again':
        tryAgain();
        break;
      case 'next':
        nextLine();
        break;
      case 'first':
        openLine(S.line.section.lines[0]);
        break;
      case 'show':
        showMove();
        break;
      case 'restart':
        if (S.line) openLine(S.line);
        break;
      case 'pick':
        $('picker').click();
        break;
    }
  }

  function onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || !S.line) return;
    const onControl = ['BUTTON', 'INPUT', 'A'].includes(e.target.tagName);
    switch (e.key) {
      case 'ArrowLeft':
        goTo(S.view - 1);
        break;
      case 'ArrowRight':
        goTo(S.view + 1);
        break;
      case 'Home':
        goTo(0);
        break;
      case 'End':
        goTo(S.cursor);
        break;
      case 'Enter':
        if (onControl) return;
        if (S.phase === 'reveal') tryAgain();
        else if (S.phase === 'done') nextLine();
        else return;
        break;
      case 'Escape':
        closeLines();
        return;
      default:
        return;
    }
    e.preventDefault();
  }

  for (const id of ['status', 'actions', 'lines-note', 'empty']) $(id).addEventListener('click', onAction);

  $('sections').addEventListener('click', (e) => {
    const row = e.target.closest('[data-line]');
    const line = row && findLine(row.dataset.line);
    if (line) openLine(line);
  });

  $('moves').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-ply]');
    if (chip) goTo(Number(chip.dataset.ply));
  });

  $('nav').addEventListener('click', (e) => {
    const button = e.target.closest('[data-go]');
    if (!button || button.disabled) return;
    const go = { start: 0, back: S.view - 1, forward: S.view + 1, end: S.cursor }[button.dataset.go];
    goTo(go);
  });

  $('flip').addEventListener('click', () => {
    S.flipped = !S.flipped;
    render();
  });

  $('show-classes').addEventListener('change', (e) => {
    S.showClasses = e.target.checked;
    render();
  });

  $('show-eval').addEventListener('change', (e) => {
    S.showEval = e.target.checked;
    layout();
    render();
  });

  $('open-lines').addEventListener('click', openLines);
  $('close-lines').addEventListener('click', closeLines);
  $('scrim').addEventListener('click', closeLines);

  $('picker').addEventListener('change', async (e) => {
    const files = await Games.readPicked(e.target.files);
    e.target.value = '';
    if (!files.length) return;
    S.picked = true;
    useFiles(files);
  });

  window.addEventListener('resize', layout);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => {
    const line = findLine(decodeURIComponent(location.hash.slice(1)));
    if (line && line !== S.line) openLine(line);
  });

  // ------------------------------------------------------------------ start

  function useFiles(files) {
    const { sections, unreadable } = Games.build(files);
    S.sections = sections;
    S.unreadable = unreadable;
    const count = sections.reduce((n, s) => n + s.lines.length, 0);
    $('summary').textContent = count ? `${count} line${count === 1 ? '' : 's'}` : '';
    if (!count) {
      showEmpty(files.length ? 'unreadable' : 'none', files.length);
      return;
    }
    document.body.classList.remove('no-games');
    $('empty').hidden = true;
    layout();
    const wanted = findLine(decodeURIComponent(location.hash.slice(1)));
    openLine(wanted || sections[0].lines[0]);
  }

  async function start() {
    // Both start off, even when the browser would restore the checkboxes.
    $('show-classes').checked = false;
    $('show-eval').checked = false;
    showEmpty('loading');
    if (/^https?:$/.test(location.protocol)) {
      try {
        useFiles(await Games.fetchGamesFolder());
        return;
      } catch {
        // No folder listing from this server: ask for the files instead.
      }
    }
    showEmpty('file');
  }

  start();
})();
