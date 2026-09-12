/** Longest edge of a stored profile picture. Plenty for a 54px circle on a 3× screen. */
const SIZE = 256;

/**
 * Turns a picked file into a small square JPEG data URL: centre-cropped, downscaled, re-encoded.
 * Doing it here means a 6MB phone photo never reaches the server.
 */
export async function toSquareDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read that image.");
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE);

    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}
