# Changelog

What is new in each version of SAMPO Studio. The app shows the latest entries after it
updates; click the version number in the bottom corner to read them again.

## 0.6.0 — 2026-10-29

Built for playing live: faster saves, steadier sound, and sound effects.

### Highlights

- Sound effects: add a sound as SFX and it becomes a soundboard pad you can hit as fast as you
  like, each hit starting it over from the beginning. Music stays one track at a time.
- A now-playing deck that keeps the music going when you change page, with a waveform you can
  press or drag through. Drag the deck anywhere; it snaps back to its corner.
- Saving a story with gigabytes of music now takes as long as saving its text, and the version
  history keeps each sound once instead of in every copy.
- Opening a shared project waits until everyone's work is here before you can edit, so nobody
  works on an old copy.
- Select several cards with Ctrl or Shift and set their type or status at once.

### Added

- Music and SFX: `+ Music` and `+ SFX` on every card, and a switch on each sound to change
  which it is. Effects play through their own channel and never interrupt the music; each hit
  restarts its effect, and different effects can sound together.
- Now playing: the sound that is on keeps playing across pages, the card panel and focus mode,
  until you stop it. Back to the start, pause and stop on the deck and in every player.
- Waveforms for music, measured once per track and remembered; the played part fills in as it
  plays. Press anywhere to jump, hold and drag to scrub, arrow keys step five seconds.
- The deck sits bottom left in focus mode, clear of the phase buttons. Drag it anywhere; drop
  it near its corner or double-click it to put it back.
- "Importing…" with progress while a large story opens for the first time on a computer.
- Shared projects: a syncing screen while a project opens, showing what it is waiting for; the
  start screen shows who is working on each shared project right now; work offline on this
  computer's copy when the cloud cannot be reached.
- Drop a card on `+ Phase` to make a new phase for it.
- Ctrl or Shift click to pick several cards; a bar sets their type or status in one step.
- Reorder the blocks in a card by dragging their grip, or Alt ↑ / ↓ while typing.
- Focus mode shows the cards side by side or as a list, and remembers which.
- Sixteen colours for card types and characters.
- Click a thread on the Threads wall to keep it lit after the pointer leaves.
- A saving bar while a save is written.

### Changed

- Saves add only what changed to the end of the file; music already in it is never rewritten.
  A save cut off by a crash or power cut leaves the previous version readable.
- Version history keeps each picture and sound once for all copies.
- Sounds up to 1 GB each, enough for an hour of 24-bit 96 kHz WAV. Sounds stay exactly as they
  were added, bit for bit; nothing is compressed.
- Tension is shown as a number from 0 to 5, with six bars on cards and in the panel alike.
- Others' edits in a shared project show at once instead of after their pictures and sounds.
- Autosave and version history wait while music plays, and closing the app asks first.
- The screen stays awake while music plays, and no update is offered in the middle of a song.

### Fixed

- The card type list opens from its arrow too.
- The arrow to expand a card shows whenever text is cut off.
- Alt and the scroll wheel zoomed only after an extra click.
- Someone's coloured ring stayed on a card after they went to focus mode.
- Only the owner sees the project's cloud space.
- A fault inside the app no longer closes it; a view that fails can be drawn again while the
  music plays on. F5, Ctrl R and the mouse's back button no longer reload the app.

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
