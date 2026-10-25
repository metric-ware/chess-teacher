/* ChessPrep · your Stress Tests: the JSON files ChessDetective saves, read from the games folder
   (or picked by hand) and turned into lines, sorted into sections. */
(function () {
  'use strict';

  const { Position } = globalThis.ChessRules;

  // ------------------------------------------------------------------ sections
  // The sections, in the order they are listed. `side` is the side you play (Stockfish's side in
  // the Stress Test); each line goes in the first section of its side whose `has` test says yes.
  // A line no section takes (say, 1.e4 as White) ends up in "Other" for its side.
  const SECTIONS = [
    { side: 'w', name: 'Jobava London', has: (line) => starts(line, 'd4') && !kingsIndian(line) },
    { side: 'w', name: "King's Indian", has: (line) => starts(line, 'd4') && kingsIndian(line) },
    { side: 'b', name: 'Sicilian', has: (line) => starts(line, 'e4 c5') },
    { side: 'b', name: 'Slav', has: () => true },
  ];

  /** Does the game begin with these moves ("e4 c5")? */
  function starts(line, sans) {
    return sans.split(' ').every((san, i) => line.moves[i] && plain(line.moves[i].san) === san);
  }

  /** Black sets up with ...g6 early (before any ...d5): the King's Indian family. */
  function kingsIndian(line) {
    for (let i = 1; i < Math.min(line.moves.length, 12); i += 2) {
      const san = plain(line.moves[i].san);
      if (san === 'g6') return true;
      if (san === 'd5') return false;
    }
    return false;
  }

  const plain = (san) => san.replace(/[+#?!]/g, '');

  // ------------------------------------------------------------------ classifications

  /** ChessDetective's move classifications: icon file, name, colour and glyph. */
  const CLASSES = {
    theory: { label: 'Theory', color: '#d5a47d', glyph: '' },
    brilliant: { label: 'Brilliant', color: '#26c2a3', glyph: '!!' },
    best: { label: 'Best', color: '#81b64c', glyph: '' },
    excellent: { label: 'Excellent', color: '#81b64c', glyph: '' },
    good: { label: 'Good', color: '#77915f', glyph: '' },
    forced: { label: 'Forced', color: '#96af8b', glyph: '' },
    inaccuracy: { label: 'Inaccuracy', color: '#f7c631', glyph: '?!' },
    mistake: { label: 'Mistake', color: '#ffa459', glyph: '?' },
    blunder: { label: 'Blunder', color: '#fa412d', glyph: '??' },
    missed_win: { label: 'Missed win', color: '#ff7769', glyph: '' },
    checkmate: { label: 'Checkmate', color: '#312e2b', glyph: '' },
  };

  // ------------------------------------------------------------------ finding the games
  // A web page can't look into a folder by itself, so the names of the files in games/ come from
  // the first of these that works:
  //   1. game-list.json, which GitHub Pages rebuilds with those names every time you upload;
  //   2. GitHub's API, for a public repository whose Pages site doesn't build game-list.json;
  //   3. the folder listing of a local web server (python3 -m http.server and the like).

  async function fromGameList() {
    try {
      const res = await fetch('game-list.json', { cache: 'no-cache' });
      const names = res.ok ? JSON.parse(await res.text()) : null;
      return Array.isArray(names) && names.every((n) => typeof n === 'string') ? names : null;
    } catch {
      return null; // not built (not on GitHub Pages): try the next way
    }
  }

  async function fromGitHubApi() {
    const owner = (location.hostname.match(/^([\w-]+)\.github\.io$/i) || [])[1];
    if (!owner) return null;
    const path = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (path.length && path[path.length - 1].includes('.')) path.pop(); // index.html
    // A project site is owner.github.io/repo/…, a user site the owner.github.io repository.
    const places = [];
    if (path.length) places.push([path[0], path.slice(1)]);
    places.push([`${owner}.github.io`, path]);
    for (const [repo, sub] of places) {
      for (const root of [[], ['docs']]) {
        const dir = [...root, ...sub, 'games'].map(encodeURIComponent).join('/');
        try {
          const res = await fetch(`https://api.github.com/repos/${owner}/${encodeURIComponent(repo)}/contents/${dir}`);
          const items = res.ok ? await res.json() : null;
          if (Array.isArray(items)) {
            return items.filter((f) => f.type === 'file' && /\.json$/i.test(f.name)).map((f) => f.name);
          }
        } catch {
          // try the next place
        }
      }
    }
    return null;
  }

  async function fromFolderListing() {
    try {
      const base = new URL('games/', location.href);
      const res = await fetch(base, { cache: 'no-cache' });
      if (!res.ok) return null;
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const names = new Set();
      for (const a of doc.querySelectorAll('a[href]')) {
        const url = new URL(a.getAttribute('href'), base);
        if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) continue;
        const name = decodeURIComponent(url.pathname.slice(base.pathname.length));
        if (/^[^/]+\.json$/i.test(name)) names.add(name);
      }
      return [...names];
    } catch {
      return null;
    }
  }

  /** Every game in the games folder as { name, text }; throws when its files can't be found. */
  async function fetchGamesFolder() {
    const names = (await fromGameList()) || (await fromGitHubApi()) || (await fromFolderListing());
    if (!names) throw new Error('No list of the games folder');
    return Promise.all(
      names.map(async (name) => {
        try {
          const res = await fetch(`games/${encodeURIComponent(name)}`, { cache: 'no-cache' });
          return { name, text: res.ok ? await res.text() : null };
        } catch {
          return { name, text: null };
        }
      }),
    );
  }

  /** Files picked by hand (a FileList), as { name, text }. */
  function readPicked(files) {
    return Promise.all(
      [...files]
        .filter((f) => f.name.toLowerCase().endsWith('.json'))
        .map(async (f) => ({ name: f.name, text: await f.text() })),
    );
  }

  // ------------------------------------------------------------------ lines

  /** One saved Stress Test as a line to learn, or null when it isn't one. */
  function parseLine(name, text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    if (!data || !Array.isArray(data.moves) || !['white', 'black'].includes(data.side)) return null;

    const positions = [Position.initial()];
    const moves = [];
    for (const saved of data.moves) {
      const pos = positions[positions.length - 1];
      const move = saved && typeof saved.uci === 'string' ? pos.moveFromUci(saved.uci) : null;
      if (!move) break; // like ChessDetective: the game stops at a move that doesn't fit
      moves.push(
        Object.assign(move, {
          uci: pos.uci(move),
          san: typeof saved.san === 'string' && saved.san ? saved.san : pos.san(move),
          cls: CLASSES[saved.class] ? saved.class : null,
        }),
      );
      positions.push(pos.play(move));
    }

    // You played one side in the Stress Test; here you play the other one, Stockfish's.
    const side = data.side === 'white' ? 'b' : 'w';
    const start = Math.min(Math.max(0, Number.parseInt(data.start, 10) || 0), moves.length);
    const guesses = [];
    for (let i = start; i < moves.length; i++) if (positions[i].turn === side) guesses.push(i);
    if (!guesses.length) return null;

    // Stockfish's saved evaluations (for the side to move), for the eval bar. The moves before
    // the test have none; positions without legal moves need no engine.
    const savedEvals = data.evals && typeof data.evals === 'object' ? data.evals : {};
    const evals = positions.map((pos) => {
      const score = savedEvals[pos.epd()] && savedEvals[pos.epd()].score;
      if (score && Number.isFinite(score.cp)) return { cp: score.cp, stm: pos.turn };
      if (score && Number.isFinite(score.mate)) return { mate: score.mate, stm: pos.turn };
      if (!pos.legalMoves().length) return pos.inCheck() ? { mate: 0, stm: pos.turn } : { cp: 0, stm: pos.turn };
      return null;
    });

    // Named after the position of your first move: later names would give Stockfish's moves away.
    let opening = null;
    for (let i = guesses[0]; i >= 0 && !opening; i--) opening = globalThis.OPENINGS[positions[i].epd()] || null;

    return {
      id: name,
      opening: opening ? opening[1] : 'Unnamed opening',
      eco: opening ? opening[0] : '',
      saved: Number(data.saved) || 0,
      engine: typeof data.engine === 'string' && data.engine ? data.engine : 'Stockfish',
      side,
      start,
      moves,
      positions,
      evals,
      guesses,
    };
  }

  /** Orders lines like an opening tree: lines that share moves sit together, and at every
   *  fork the branch you saved first comes first. */
  function treeOrder(lines) {
    const node = () => ({ children: new Map(), lines: [], first: Infinity });
    const root = node();
    for (const line of lines) {
      let n = root;
      n.first = Math.min(n.first, line.saved);
      for (const m of line.moves) {
        if (!n.children.has(m.uci)) n.children.set(m.uci, node());
        n = n.children.get(m.uci);
        n.first = Math.min(n.first, line.saved);
      }
      n.lines.push(line);
    }
    const out = [];
    (function walk(n) {
      n.lines.sort((a, b) => a.saved - b.saved || a.id.localeCompare(b.id)).forEach((l) => out.push(l));
      [...n.children.values()].sort((a, b) => a.first - b.first).forEach(walk);
    })(root);
    return out;
  }

  /** Reads the files into sections: [{ key, side, name, lines }], plus how many files failed. */
  function build(files) {
    const lines = [];
    let unreadable = 0;
    for (const f of files) {
      const line = f.text == null ? null : parseLine(f.name, f.text);
      if (line) lines.push(line);
      else unreadable++;
    }
    const sections = SECTIONS.map((s) => ({ key: `${s.side}:${s.name}`, side: s.side, name: s.name, has: s.has, lines: [] }));
    for (const side of ['w', 'b']) {
      sections.push({ key: `${side}:Other`, side, name: 'Other', has: () => true, lines: [] });
    }
    for (const line of lines) {
      const section = sections.find((s) => s.side === line.side && s.has(line));
      section.lines.push(line);
    }
    const used = sections.filter((s) => s.lines.length);
    used.sort((a, b) => (a.side === b.side ? 0 : a.side === 'w' ? -1 : 1));
    for (const s of used) {
      s.lines = treeOrder(s.lines);
      s.lines.forEach((line, i) => {
        line.section = s;
        line.index = i;
      });
    }
    return { sections: used, unreadable };
  }

  globalThis.Games = { CLASSES, fetchGamesFolder, readPicked, build };
})();
