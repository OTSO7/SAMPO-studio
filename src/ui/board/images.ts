/** Longest edge kept: sharp on a full HD screen, small enough that saves stay quick. */
const MAX_EDGE = 1920;
const QUALITY = 0.85;

/** Sound formats the desktop side accepts, by file extension. */
const SOUND_EXTENSIONS = ["mp3", "ogg", "opus", "wav", "m4a", "webm", "flac"];

/** The pictures and sounds among dropped, pasted or picked files. */
export function mediaFiles(files: FileList | null | undefined): File[] {
  return [...(files ?? [])].filter((file) => isImage(file) || soundExtension(file) !== null);
}

export function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

/** `mp3` for "Tuuli.MP3", or `null` when the file is not a sound the story can hold. */
export function soundExtension(file: File): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return SOUND_EXTENSIONS.includes(extension) ? extension : null;
}

/**
 * Shrinks a picture to at most 1920 px on its long edge and re-encodes it as WebP, so a
 * story full of references stays a file that saves in a blink.
 */
export async function readImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const encoded = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/webp", QUALITY);
  });
  if (encoded === null) throw new Error("The picture could not be encoded");
  return encoded;
}
