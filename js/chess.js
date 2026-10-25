/* ChessPrep · chess rules: positions, legal moves, SAN, UCI and EPD.
   Just what replaying Stress Test games and checking your moves needs. */
(function () {
  'use strict';

  const FILES = 'abcdefgh';
  const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const DIAGONAL = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const STRAIGHT = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const PROMOTIONS = ['q', 'r', 'b', 'n'];
  const INITIAL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  // Squares: a1 = 0, b1 = 1 … h8 = 63. Pieces: 'P' is a white pawn, 'p' a black one.
  const square = (file, rank) => rank * 8 + file;
  const fileOf = (s) => s & 7;
  const rankOf = (s) => s >> 3;
  const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
  const squareName = (s) => FILES[fileOf(s)] + (rankOf(s) + 1);
  const parseSquare = (name) => square(FILES.indexOf(name[0]), Number(name[1]) - 1);
  const colorOf = (p) => (p === p.toUpperCase() ? 'w' : 'b');
  const roleOf = (p) => p.toLowerCase();
  const other = (c) => (c === 'w' ? 'b' : 'w');
  const pieceOf = (color, role) => (color === 'w' ? role.toUpperCase() : role);

  /** A position. Never changed after it is made: `play` returns a new one. */
  class Position {
    constructor(board, turn, castling, ep, halfmoves, fullmoves) {
      this.board = board;
      this.turn = turn;
      /** Castling rights, a subset of "KQkq" in that order. */
      this.castling = castling;
      /** The en passant target square after a double pawn push, else -1. */
      this.ep = ep;
      this.halfmoves = halfmoves;
      this.fullmoves = fullmoves;
      this._legal = null;
    }

    static initial() {
      return Position.fromFen(INITIAL);
    }

    static fromFen(fen) {
      const [placement, turn = 'w', castling = '-', ep = '-', half = '0', full = '1'] =
        fen.trim().split(/\s+/);
      const board = new Array(64).fill(null);
      placement.split('/').forEach((row, i) => {
        let file = 0;
        for (const ch of row) {
          if (/\d/.test(ch)) file += Number(ch);
          else board[square(file++, 7 - i)] = ch;
        }
      });
      return new Position(
        board,
        turn,
        castling === '-' ? '' : castling,
        ep === '-' ? -1 : parseSquare(ep),
        Number(half),
        Number(full),
      );
    }

    kingSquare(color) {
      return this.board.indexOf(pieceOf(color, 'k'));
    }

    /** Is `target` attacked by a piece of colour `by`? */
    isAttacked(target, by) {
      const b = this.board;
      const f = fileOf(target);
      const r = rankOf(target);
      const pawnRank = by === 'w' ? r - 1 : r + 1;
      for (const df of [-1, 1]) {
        if (onBoard(f + df, pawnRank) && b[square(f + df, pawnRank)] === pieceOf(by, 'p')) return true;
      }
      const jumps = (steps, role) =>
        steps.some(([df, dr]) => onBoard(f + df, r + dr) && b[square(f + df, r + dr)] === pieceOf(by, role));
      if (jumps(KNIGHT, 'n') || jumps(KING, 'k')) return true;
      const slides = (dirs, roles) =>
        dirs.some(([df, dr]) => {
          for (let nf = f + df, nr = r + dr; onBoard(nf, nr); nf += df, nr += dr) {
            const p = b[square(nf, nr)];
            if (p) return colorOf(p) === by && roles.includes(roleOf(p));
          }
          return false;
        });
      return slides(DIAGONAL, 'bq') || slides(STRAIGHT, 'rq');
    }

    inCheck() {
      const k = this.kingSquare(this.turn);
      return k >= 0 && this.isAttacked(k, other(this.turn));
    }

    /** Moves that follow the piece rules, ignoring whether they leave the king in check. */
    pseudoMoves() {
      const moves = [];
      const b = this.board;
      const us = this.turn;
      const them = other(us);
      const add = (from, to, extra) =>
        moves.push(Object.assign({ from, to, piece: b[from], captured: b[to], promotion: null, kind: 'normal' }, extra));

      for (let from = 0; from < 64; from++) {
        const p = b[from];
        if (!p || colorOf(p) !== us) continue;
        const f = fileOf(from);
        const r = rankOf(from);
        const role = roleOf(p);
        if (role === 'p') {
          const dir = us === 'w' ? 1 : -1;
          const last = us === 'w' ? 7 : 0;
          const advance = (to, extra) => {
            if (rankOf(to) === last) PROMOTIONS.forEach((promotion) => add(from, to, Object.assign({ promotion }, extra)));
            else add(from, to, extra);
          };
          const one = square(f, r + dir);
          if (!b[one]) {
            advance(one);
            const two = square(f, r + 2 * dir);
            if (r === (us === 'w' ? 1 : 6) && !b[two]) add(from, two, { kind: 'double' });
          }
          for (const df of [-1, 1]) {
            if (!onBoard(f + df, r + dir)) continue;
            const to = square(f + df, r + dir);
            if (b[to] && colorOf(b[to]) === them) advance(to);
            else if (to === this.ep && !b[to]) add(from, to, { kind: 'ep', captured: pieceOf(them, 'p') });
          }
        } else if (role === 'n' || role === 'k') {
          for (const [df, dr] of role === 'n' ? KNIGHT : KING) {
            if (!onBoard(f + df, r + dr)) continue;
            const to = square(f + df, r + dr);
            if (!b[to] || colorOf(b[to]) === them) add(from, to);
          }
          if (role === 'k') this._castles(from, add);
        } else {
          const dirs = role === 'b' ? DIAGONAL : role === 'r' ? STRAIGHT : DIAGONAL.concat(STRAIGHT);
          for (const [df, dr] of dirs) {
            for (let nf = f + df, nr = r + dr; onBoard(nf, nr); nf += df, nr += dr) {
              const to = square(nf, nr);
              if (b[to]) {
                if (colorOf(b[to]) === them) add(from, to);
                break;
              }
              add(from, to);
            }
          }
        }
      }
      return moves;
    }

    _castles(from, add) {
      const us = this.turn;
      const them = other(us);
      const home = us === 'w' ? 0 : 7;
      if (from !== square(4, home) || this.isAttacked(from, them)) return;
      const sides = [
        { right: pieceOf(us, 'k'), rook: 7, to: 6, rookTo: 5, empty: [5, 6], safe: [5, 6] },
        { right: pieceOf(us, 'q'), rook: 0, to: 2, rookTo: 3, empty: [1, 2, 3], safe: [3, 2] },
      ];
      for (const s of sides) {
        if (!this.castling.includes(s.right) || this.board[square(s.rook, home)] !== pieceOf(us, 'r')) continue;
        if (s.empty.some((file) => this.board[square(file, home)])) continue;
        if (s.safe.some((file) => this.isAttacked(square(file, home), them))) continue;
        add(from, square(s.to, home), { kind: 'castle', rookFrom: square(s.rook, home), rookTo: square(s.rookTo, home) });
      }
    }

    legalMoves() {
      if (!this._legal) {
        this._legal = this.pseudoMoves().filter((m) => {
          const next = this.play(m);
          return !next.isAttacked(next.kingSquare(this.turn), next.turn);
        });
      }
      return this._legal;
    }

    /** The position after `m` (a move from this position's move lists). */
    play(m) {
      const b = this.board.slice();
      const us = this.turn;
      b[m.to] = m.promotion ? pieceOf(us, m.promotion) : b[m.from];
      b[m.from] = null;
      if (m.kind === 'ep') b[square(fileOf(m.to), rankOf(m.from))] = null;
      if (m.kind === 'castle') {
        b[m.rookTo] = b[m.rookFrom];
        b[m.rookFrom] = null;
      }
      let castling = this.castling;
      for (const s of [m.from, m.to]) {
        if (s === 4) castling = castling.replace(/[KQ]/g, '');
        if (s === 60) castling = castling.replace(/[kq]/g, '');
        if (s === 7) castling = castling.replace('K', '');
        if (s === 0) castling = castling.replace('Q', '');
        if (s === 63) castling = castling.replace('k', '');
        if (s === 56) castling = castling.replace('q', '');
      }
      const reset = roleOf(m.piece) === 'p' || m.captured;
      return new Position(
        b,
        other(us),
        castling,
        m.kind === 'double' ? (m.from + m.to) / 2 : -1,
        reset ? 0 : this.halfmoves + 1,
        us === 'b' ? this.fullmoves + 1 : this.fullmoves,
      );
    }

    /**
     * The legal move from `from` to `to`, or null. Dropping the king on its own rook castles;
     * a pawn reaching the last rank becomes `promotion` (a queen unless told otherwise).
     */
    find(from, to, promotion) {
      const found = this.legalMoves().filter(
        (m) => m.from === from && (m.to === to || (m.kind === 'castle' && m.rookFrom === to)),
      );
      return found.find((m) => m.promotion === (promotion || 'q')) || found.find((m) => !m.promotion) || null;
    }

    moveFromUci(uci) {
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
      return this.find(parseSquare(uci.slice(0, 2)), parseSquare(uci.slice(2, 4)), uci[4]);
    }

    uci(m) {
      return squareName(m.from) + squareName(m.to) + (m.promotion || '');
    }

    san(m) {
      let san;
      if (m.kind === 'castle') {
        san = fileOf(m.to) === 6 ? 'O-O' : 'O-O-O';
      } else if (roleOf(m.piece) === 'p') {
        san = (m.captured ? FILES[fileOf(m.from)] + 'x' : '') + squareName(m.to);
        if (m.promotion) san += '=' + m.promotion.toUpperCase();
      } else {
        const rivals = this.legalMoves().filter((o) => o.piece === m.piece && o.to === m.to && o.from !== m.from);
        let from = '';
        if (rivals.length) {
          if (!rivals.some((o) => fileOf(o.from) === fileOf(m.from))) from = FILES[fileOf(m.from)];
          else if (!rivals.some((o) => rankOf(o.from) === rankOf(m.from))) from = String(rankOf(m.from) + 1);
          else from = squareName(m.from);
        }
        san = roleOf(m.piece).toUpperCase() + from + (m.captured ? 'x' : '') + squareName(m.to);
      }
      const next = this.play(m);
      if (next.inCheck()) san += next.legalMoves().length ? '+' : '#';
      return san;
    }

    /** "board turn castling ep", with the en passant square only when it can be taken. */
    epd() {
      const rows = [];
      for (let r = 7; r >= 0; r--) {
        let row = '';
        let empty = 0;
        for (let f = 0; f < 8; f++) {
          const p = this.board[square(f, r)];
          if (!p) {
            empty++;
            continue;
          }
          if (empty) row += empty;
          empty = 0;
          row += p;
        }
        rows.push(row + (empty || ''));
      }
      const ep = this.ep >= 0 && this.legalMoves().some((m) => m.kind === 'ep') ? squareName(this.ep) : '-';
      return `${rows.join('/')} ${this.turn} ${this.castling || '-'} ${ep}`;
    }
  }

  globalThis.ChessRules = { Position, square, squareName, parseSquare, fileOf, rankOf, colorOf, roleOf };
})();
