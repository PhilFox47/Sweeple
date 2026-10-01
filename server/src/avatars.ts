import { db } from "./db.js";

const ALLOWED = new Map([
  ["image/jpeg", true],
  ["image/png", true],
  ["image/webp", true],
]);

/** Generous for a 256px square, small enough that nobody can fill the disk with one profile. */
const MAX_BYTES = 400_000;

export interface DecodedImage {
  bytes: Buffer;
  type: string;
}

/** Pulls the bytes out of a `data:image/jpeg;base64,…` URL, refusing anything else. */
export function decodeDataUrl(dataUrl: unknown): DecodedImage | { error: string } {
  if (typeof dataUrl !== "string") return { error: "Das Bild muss als Data-URL kommen." };
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) return { error: "Das sieht nicht nach einem Bild aus." };

  const type = match[1].toLowerCase();
  if (!ALLOWED.has(type)) return { error: "Bitte ein JPEG-, PNG- oder WebP-Bild." };

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0) return { error: "Das Bild ist leer." };
  if (bytes.length > MAX_BYTES) return { error: "Das Bild ist zu groß." };
  return { bytes, type };
}

/** The URL an avatar is served from, versioned so a changed picture is never served from cache. */
export function avatarUrl(userId: number, version: number | null): string | null {
  return version ? `/api/users/${userId}/avatar?v=${version}` : null;
}

export function readAvatar(userId: number): DecodedImage | null {
  const row = db.prepare("SELECT avatar, avatar_type FROM users WHERE id = ?").get(userId) as
    | { avatar: Buffer | null; avatar_type: string | null }
    | undefined;
  if (!row?.avatar || !row.avatar_type) return null;
  return { bytes: row.avatar, type: row.avatar_type };
}
