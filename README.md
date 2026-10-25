# ChessPrep

Learn Stockfish's moves from your ChessDetective Stress Tests. You play Stockfish's side; the
other side's moves play themselves. Get a move wrong and it turns red and goes back, the right
move is shown, and after **Try again** you play it yourself.

Just HTML, CSS, JS and your Stress Test `.json` files: no backend, no cookies, nothing saved.

## Put it on GitHub Pages

1. Make a new repository on GitHub.
2. Upload everything in this folder: `index.html`, `game-list.json`, `css/`, `js/`, `assets/`
   and `games/`.
3. In the repository: **Settings → Pages → Build and deployment**: Source **Deploy from a branch**,
   branch **main**, folder **/ (root)**, then **Save**.
4. About a minute later it is live at `https://<your-username>.github.io/<repository>/`, on your
   computer and your phone.

A GitHub Pages site is public: anyone with the link can see the lines.

## Add new Stress Tests

ChessDetective saves them in `~/.local/share/chessdetective/stress-tests`. Copy the new `.json`
files into `games/` and upload them to the `games` folder of the repository. GitHub Pages rebuilds
`game-list.json` (the list of files in `games/`) by itself, so the new lines show up a minute
later. Delete a file from `games/` to drop its line. Don't edit `game-list.json`.

## Playing

- **Sections**: [White] Jobava London, [White] King's Indian, [Black] Sicilian, [Black] Slav.
  At the end of a line, **Next line** goes on to the next one in the section.
- **Show the move** when you don't know it: it counts as missed, then you play it yourself.
- **Show move classifications** and **Show eval bar** are off when the page opens.
- Keys: `←` `→` `Home` `End` look back through the moves, `Enter` is Try again / Next line.

Which section a line goes in is decided by the short list of rules at the top of `js/games.js`.

## Without GitHub Pages

Opened straight from the folder (`index.html` in the browser), the page can't read `games/`:
browsers don't allow it. It then asks you to pick the `.json` files instead. Any local web server
works too, for example `python3 -m http.server` in this folder, then `http://localhost:8000`.

## Credits

Pieces (cburnett), classification icons, logo and look from ChessDetective; Ubuntu Light and
Noto Sans Bold fonts (licences in `assets/fonts`). Opening names: lichess chess-openings (CC0).
