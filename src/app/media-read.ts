/** The asset protocol answers at most about a megabyte per range request. */
const PIECE_BYTES = 1000 * 1024;

/**
 * Reads a media file one piece at a time. Without a range, the desktop app's asset protocol
 * loads the whole file into memory first, which a long WAV must never do during a song.
 * `pauseMs` rests between pieces, so the disk stays free for whatever is playing.
 */
export async function* readPieces(url: string, pauseMs = 0): AsyncGenerator<Uint8Array> {
  for (let at = 0; ;) {
    const response = await fetch(url, {
      headers: { Range: `bytes=${at}-${at + PIECE_BYTES - 1}` },
    });
    if (response.status === 416) return; // The file ended exactly on the last piece.
    if (!response.ok) throw new Error(`Could not read ${url}: ${response.status}`);
    const piece = new Uint8Array(await response.arrayBuffer());
    if (piece.length > 0) yield piece;
    if (response.status !== 206 || piece.length < PIECE_BYTES) return;
    at += piece.length;
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
}

/** A whole file in memory, or `null` as soon as it proves larger than `limit` bytes. */
export async function readUpTo(url: string, limit: number): Promise<Uint8Array | null> {
  const pieces: Uint8Array[] = [];
  let size = 0;
  for await (const piece of readPieces(url)) {
    size += piece.length;
    if (size > limit) return null;
    pieces.push(piece);
  }
  return new Uint8Array(await new Blob(pieces as BlobPart[]).arrayBuffer());
}
