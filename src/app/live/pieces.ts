/**
 * Large edits in pieces. Cloudflare takes WebSocket messages up to 1 MiB, so an edit bigger
 * than a piece (pasting a whole long script at once, a big snapshot) travels as several
 * messages and is put back together on arrival. Each piece is encrypted on its own; the
 * envelope inside the encryption says which edit it belongs to and where it goes:
 *
 *   "SP" 1 | edit id (8 bytes) | index u16 | count u16 | bytes
 *
 * A message without the envelope is a whole edit by itself.
 */

const MAGIC = [0x53, 0x50, 0x01];
const HEADER = MAGIC.length + 8 + 4;
/** Leaves room under 1 MiB for the encryption and the relay's own header. */
export const PIECE_BYTES = 700 * 1024;
const MAX_PIECES = 4096;

export function splitEdit(edit: Uint8Array, pieceBytes = PIECE_BYTES): Uint8Array[] {
  const id = crypto.getRandomValues(new Uint8Array(8));
  const count = Math.max(1, Math.ceil(edit.length / pieceBytes));
  return Array.from({ length: count }, (_, index) => {
    const bytes = edit.subarray(index * pieceBytes, (index + 1) * pieceBytes);
    const piece = new Uint8Array(HEADER + bytes.length);
    piece.set(MAGIC);
    piece.set(id, MAGIC.length);
    const view = new DataView(piece.buffer, MAGIC.length + 8, 4);
    view.setUint16(0, index);
    view.setUint16(2, count);
    piece.set(bytes, HEADER);
    return piece;
  });
}

interface Partial {
  readonly parts: (Uint8Array | undefined)[];
  got: number;
  /** The stored number of its first piece seen; nothing at or after it counts as received. */
  firstSeq: number;
  lastActivity: number;
}

/** Puts pieces back together, in whatever order they come. */
export class Assembler {
  private readonly partials = new Map<string, Partial>();

  /** The whole edit once its last piece is in; `null` while pieces are missing. */
  add(piece: Uint8Array, seq: number, now = Date.now()): Uint8Array | null {
    if (piece.length < HEADER || MAGIC.some((byte, i) => piece[i] !== byte)) return piece;
    const id = [...piece.subarray(MAGIC.length, MAGIC.length + 8)].join(",");
    const view = new DataView(piece.buffer, piece.byteOffset + MAGIC.length + 8, 4);
    const index = view.getUint16(0);
    const count = view.getUint16(2);
    if (count === 0 || count > MAX_PIECES || index >= count) return null;
    if (count === 1) return piece.subarray(HEADER);

    const partial = this.partials.get(id) ?? {
      parts: new Array<Uint8Array | undefined>(count),
      got: 0,
      firstSeq: seq,
      lastActivity: now,
    };
    if (partial.parts.length !== count) return null;
    if (partial.parts[index] === undefined) partial.got += 1;
    partial.parts[index] = piece.slice(HEADER);
    partial.firstSeq = Math.min(partial.firstSeq, seq);
    partial.lastActivity = now;
    this.partials.set(id, partial);
    if (partial.got < count) return null;

    this.partials.delete(id);
    const size = partial.parts.reduce((sum, part) => sum + (part?.length ?? 0), 0);
    const whole = new Uint8Array(size);
    let offset = 0;
    for (const part of partial.parts) {
      whole.set(part ?? new Uint8Array(), offset);
      offset += part?.length ?? 0;
    }
    return whole;
  }

  /**
   * The first stored number of an edit still missing pieces. Progress is only recorded up to
   * just before it, so if the app closes now, those pieces are fetched again next time.
   */
  oldestIncomplete(): number | null {
    let oldest: number | null = null;
    for (const partial of this.partials.values()) {
      oldest = oldest === null ? partial.firstSeq : Math.min(oldest, partial.firstSeq);
    }
    return oldest;
  }

  /** Drops edits whose sender stopped halfway; their sender sends them whole again. */
  dropStale(olderThan: number): void {
    for (const [id, partial] of this.partials) {
      if (partial.lastActivity < olderThan) this.partials.delete(id);
    }
  }
}
