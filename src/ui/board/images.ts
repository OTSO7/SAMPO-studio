/** Longest edge kept: sharp on a full HD screen, small enough that saves stay quick. */
const MAX_EDGE = 1920;
const QUALITY = 0.85;

/** The pictures among dropped or pasted files. */
export function imageFiles(files: FileList | null | undefined): File[] {
  return [...(files ?? [])].filter((file) => file.type.startsWith("image/"));
}

/**
 * Shrinks a picture to at most 1920 px on its long edge and re-encodes it as WebP, so a
 * story full of references stays a file that saves in a blink. Resolves to a data URL.
 */
export async function readImage(file: Blob): Promise<string> {
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

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("The picture could not be read"));
    };
    reader.readAsDataURL(encoded);
  });
}
