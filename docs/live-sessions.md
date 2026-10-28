# Shared projects

A story several people edit together: in real time when they are online at the same time,
and each on their own when they are not. No accounts. The owner shares a story and lets each
friend in once with an invite code; after that the project is on everyone's start screen.

## Using it

- **Share:** open a story → **Share** in the title bar → your name → **Share**. Open
  **Shared** again for the invite code and **Copy** it to a friend.
- **Join:** start screen → **Join a shared project** → paste the code and your name →
  **Ask to join**. The owner needs SAMPO open to let you in, once.
- After that the project is under **Shared** on both start screens ("You own this" /
  "Owner: Otto"). Open it any time, without a code, with or without the others online.
- When you are online together, edits show as they happen. The card someone has open has a
  ring in their colour and their name; the line they are typing in, a bar and their name;
  whatever they just changed lights up for a moment. **Ctrl Z** undoes only your own edits.
- **Offline** works too: changes are kept on your computer and go out when you are back.
- **History** in the board header lists earlier versions; **Open copy** opens one beside the
  story, never in its place.
- The owner sees every member, here or away, and can **Remove** one, or **Delete project for
  everyone**. A member can **Leave project**.
- **Copy invite message** gives a ready message with the code and how to join. Untick **Let new
  people ask to join** once everyone is in: the code then opens nothing, even if it leaks.
- Coming back, a notice says what others changed meanwhile, and it lights up.

## Nothing is lost

- Every computer keeps the whole project and works without the others or the relay.
- The owner's own `.sampo` file stays theirs and keeps being saved as usual.
- **Version history**, complete copies with pictures and sounds, on each computer: when a story
  opens, every ten minutes of editing, before someone else's deletions are applied, when it is
  shared, and before leaving or deleting a project. It keeps the 20 newest and one a day for
  60 days. A project is only removed from a computer after its copy is in the history.
- Merging is done by Yjs (a CRDT): edits to different cards, blocks, phases or characters
  never clash, and a card one person moves while another edits it keeps both.

## Security

- **End-to-end encrypted** with a random 256-bit project key (AES-256-GCM, keys derived with
  HKDF). The key is in the invite code and on members' computers, never on the relay, which
  stores and passes on only ciphertext: not the story, not names, not pictures. Pictures are
  stored under a keyed hash, so the relay cannot even tell which file is which.
- **The owner decides who gets in.** A code alone only lets someone knock. A knock from
  someone without the right key is turned away automatically; the owner admits or declines
  everyone else, once. Members then have their own token, which the owner can revoke.
- The relay cannot change anything unnoticed: a changed or forged message fails to open and
  is ignored.
- **Names cannot be faked.** The relay stamps who sent each live message; the name shown is the
  one the owner let in, not one someone types later. A knock that uses an existing member's
  name is flagged for the owner.
- **Only the owner can replace the stored history** (snapshots); a member cannot wipe it.
- **Each project may hold 900 MB in the cloud**, under Cloudflare's free-plan limits for one
  project and for the whole account, so one project cannot use up the space.
- **The app talks only to its relay.** Its content security policy blocks connections to any
  other address, so even a bug letting foreign code in could not send anything elsewhere.

What it does not do, honestly:

- Anyone can type any name when knocking. Let in only someone you expect, e.g. after a word on
  Discord.
- A member can edit and delete like you can (as with edit access in Google Docs). The
  version history is there for mistakes.
- Removing a member stops what they get from then on; the copy already on their computer
  stays theirs.
- The relay sees technical facts: addresses, when messages pass and how big they are.

## Size

- **Any size of edit.** Cloudflare takes messages up to 1 MiB, so anything larger, such as
  pasting a whole long script at once, goes in 700 KB pieces and is put back together on
  arrival (`src/app/live/pieces.ts`). Progress is recorded only for edits that arrived whole.
- **Pictures and sounds live on your computers, not in the cloud.** The cloud is their mailbox:
  a file waits there only until every member has confirmed they have it, then it is deleted;
  one nobody collects goes after two weeks. Someone who needs a file the cloud no longer holds
  (a new member, or after a long absence) gets it from whoever has it and is online; if nobody
  is, the request waits and the file comes when someone with it opens the project. Pictures
  added offline go up once the connection is back.
- So the cloud holds mostly the story's text, which is small: a whole story is typically
  0.1–0.5 MB. The **Shared** panel shows the space in use: story text, files on their way, and
  the project's limit.
- Pictures are already made small when added (WebP, longest edge 1920 px, 85% quality). Files go
  in 512 KB pieces, up to 100 MB a file; a larger one stays on its computer, and the app says so
  by name.
- **If the cloud space is ever full**, nothing is lost: the refused edit or file stays on the
  computer, the app says so once, checks for room every five minutes and on every reconnect,
  and sends what waited as soon as it fits.

### What 5 GB means

Cloudflare's 5 GB is how much the account holds at any moment, not a monthly allowance: it
does not run out over time, and deleted data frees space. Daily limits (requests, compute
time) reset every day. With pictures and sounds kept on computers, the cloud mostly holds text.

## Cost

The relay runs on Cloudflare's **free plan with no payment method**, so it cannot cost
anything; if a daily free limit were ever reached, syncing would pause until the next day while
everyone keeps working on their own copy.

## How it works

- `src/app/live/project.ts`: sharing, joining, syncing, presence, pictures, reconnecting.
- `src/app/live/story-doc.ts`: the story as a Yjs document. `projects.ts`: the projects on this
  computer and their local copies. `crypto.ts`: the code and the encryption.
- `src/app/backups.ts` and `src-tauri/src/backups.rs`: the version history.
- `cloud/src/index.ts`: the relay, a Cloudflare Worker with one Durable Object per project
  that keeps the encrypted edits until the owner folds them into a snapshot, and passes
  pictures and sounds on as a mailbox.

## Trying it on one computer

1. `pnpm tauri dev`: this window is Otto. Open or create a story, **Share**, copy the code.
2. In Chrome or Edge open `http://[::1]:1420`: that tab is Matias, with storage of its own.
   **Join a shared project**, paste the code. (Files and pictures need the app; a browser tab
   cannot save them.)
3. In the app: **Shared** → **Let in**. Edit in either, close one and reopen it from the start
   screen, and watch the other catch up.

## Maintaining the relay

```bash
cd cloud
pnpm install
pnpm dev          # local relay on http://127.0.0.1:8787
pnpm smoke        # in a second terminal: who gets in, who receives what, owner away
# With `pnpm dev --var PROJECT_LIMIT_BYTES:4000`: node scripts/full.mjs checks a full project.
pnpm run deploy   # publish (needs `npx wrangler login` once)
```

`SAMPO_LIVE_URL=wss://sampo-cloud.sampo-cloud.workers.dev pnpm smoke` runs the same check
against the published relay. To point a development build at a local relay, put
`VITE_SAMPO_LIVE_URL=ws://127.0.0.1:8787` in `.env.local`.
