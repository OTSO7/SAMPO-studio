# Changelog

What is new in each version of SAMPO Studio. The app shows the latest entries after it
updates; click the version number in the bottom corner to read them again.

## 0.6.3 — 2026-10-29

A cleaner look for the start screen and focus mode.

### Changed

- The start screen is simpler. Start a new story with the one highlighted button, and find
  your recent stories and shared projects in tidy lists next to it. Long lists show the first
  five, with a button to see the rest.
- Cards in focus mode are easier to read. Each card shows its number, type, tension and status
  in one quiet line at the top, then its heading, then the story.
- The buttons for adding text, lines, pictures and sounds now appear only when you click into
  a card, so the cards stay clean while you present.

## 0.6.2 — 2026-10-29

A fix for sound effects.

### Fixed

- A long sound effect can now be stopped. While an effect plays, a stop button appears next to
  it and a bar shows how far it has got. Pressing Esc on the effect stops it too.

## 0.6.1 — 2026-10-29

A small update: the notes about what changed in 0.6.0 are now easier to read.

### Changed

- Clearer, simpler update notes in this window and on the download page.

## 0.6.0 — 2026-10-29

A big update for playing music live, with sound effects, smoother music and much faster saving.

### Highlights

- Sound effects: cards now have two kinds of sound, Music and SFX. An SFX sound becomes a big
  button you can press as often as you like, and it starts over from the beginning each time.
- Music keeps playing when you move around the app. A small player shows what is playing, and
  you can see the song's shape and drag through it to jump to any point.
- Saving is now almost instant, even when your story has gigabytes of music in it.
- When you open a shared project, the app first makes sure you have everyone's latest work
  before you can edit, so nobody works on an old copy.
- Select several cards at once and change their type or status in one go.

### New

- Music or SFX: use `+ Music` or `+ SFX` on a card. You can switch any sound between the two
  later. Sound effects never interrupt the music.
- A music player in the corner of the screen keeps the song playing while you switch pages or
  open focus mode. It has play and pause, back to the start, and stop.
- See the shape of each song (a waveform). Click it to jump, or hold and drag to move through
  the song. The arrow keys skip five seconds.
- In focus mode the music player sits in the bottom left corner. You can drag it anywhere; drop
  it near the corner, or double-click it, and it jumps back.
- Opening a large story for the first time shows "Importing…" with a progress bar.
- Shared projects: a "Syncing…" screen while a project opens, and the start screen shows who
  is working on each shared project right now. With no internet, you can still choose to work
  on your own copy; everything is combined when you are back online.
- Drag a card onto `+ Phase` to create a new phase for it.
- Hold Ctrl or Shift and click cards to select several, then change them all at once.
- Change the order of the parts inside a card by dragging the handle on their left, or with
  Alt and the up and down arrows.
- Focus mode can show the cards side by side or as a list.
- Sixteen colours to choose from for card types and characters.
- On the Threads wall, click a thread to keep it highlighted.
- A small bar at the bottom shows when the story is being saved.

### Improved

- Saving no longer rewrites all your music every time, so it is fast and uses less disk.
  If the computer crashes in the middle of saving, your previous save is still safe.
- The version history no longer stores a new copy of every song each time; each song is kept
  only once.
- Sounds can now be up to 1 GB each. Your sounds are never compressed: they sound exactly as
  good as the files you added.
- Tension is shown as a number from 0 to 5.
- In a shared project, other people's text changes appear right away.
- While music is playing, the app waits with automatic saving, asks before closing, keeps the
  screen awake and does not offer updates.

### Fixed

- The card type menu now also opens when you click its arrow.
- The button to expand a card now appears whenever the text does not fit.
- Zooming with Alt and the scroll wheel works straight away, without an extra click.
- A friend's coloured marker no longer stays on a card after they leave it.
- Only the project's owner sees how much cloud space it uses.
- If something goes wrong inside the app, it no longer closes; the music keeps playing.
  F5 and Ctrl R no longer reload the app by accident.

## 0.5.0 — 2026-10-28

Edit a story together with friends.

### Added

- Shared projects. Share an open story, send the invite code to a friend and let them in once;
  after that the project is on both start screens, marked with its owner.
- Real-time editing together: edits show as they happen, the card someone has open and the line
  they are typing in are marked with their colour and name, and what they just changed lights up.
- Work on your own too: a shared project opens and saves without a connection or the others,
  and catches up when you are back. Ctrl Z undoes only your own edits.
- End-to-end encryption: the cloud in between only passes on scrambled data and cannot read the
  story, names or pictures. Pictures and sounds stay on your computers.
- Version history: complete copies of every story are kept automatically. History in the board
  header opens any of them as a copy.
- The owner can see members, remove them, close the project to new people, and delete it; a
  member can leave. Both from the Shared panel or the start screen's ⋯ menu.

### Changed

- Saving in a browser tab now says that files need the app, instead of a cryptic error.

## 0.4.5 — 2026-10-28

Fixes and improvements from beta feedback.

### Added

- A Save button in the title bar for everyone who does not use Ctrl S. It lights up while
  there are unsaved changes.
- Duplicate a card from its panel or by right-clicking it. The copy's lines get recording IDs
  of their own.
- Right-click a card on the board to open, expand, duplicate or delete it.
- An arrow in the corner of a card that has more to show, to expand it on the board.
- The start screen says whether a newer version is out, and installs it in one click.
- What's new: this list, shown once after each update.

### Changed

- Every card shows its type, including the first type in the list.
- A story always opens on the board, whichever view it was saved in.

### Fixed

- Card headings could not contain spaces.

## 0.4.4 — 2026-10-23

### Added

- Pictures and sounds on cards. Paste a screenshot, drop files onto a card or use the Image
  and Sound buttons. Everything is packed inside the `.sampo` file, so a story copied to
  another computer opens with all of it.
- Recorded takes: attach a scratch or final recording to any line and play it in place.
- Card status: Draft, Review and Final, with a progress bar for the story, a filter on the
  board and the S key to step a card through them.
- Story threads: pin cards to a clue, a mystery or a promise the story has to keep, and follow
  them on the Threads wall. Threads that are set up and never paid off are marked open.
- A voice actor for each character, included in the recording sheet.
- Export only the lines on final cards, ready for the studio.
- Status and recording columns in the Lines view, with filters by character and status.
- A search field in the board header. Ctrl K jumps into it.
- The app draws its own title bar and window buttons.

### Changed

- Pasting a script keeps its dialogue: lines such as `IRIS: …` become lines with a speaker.
- Alt and the scroll wheel zoom around the pointer; Ctrl and the scroll wheel scroll sideways.
- A calmer card panel, clearer cards and a redesigned start screen.

### Fixed

- Pressing Ctrl S during an autosave could report a failed save.

## 0.4.3 — 2026-10-22

### Added

- Pictures on cards.

### Fixed

- The version number in the corner now always matches the installed version.

## 0.4.2 — 2026-10-22

### Added

- SAMPO notices when another program saves the story file and asks before replacing it.

## 0.4.1 — 2026-10-22

### Added

- Automatic updates.

## 0.4.0 — 2026-10-22

First version with automatic updates.
