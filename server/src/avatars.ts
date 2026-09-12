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
  if (typeof dataUrl !== "string") return { error: "Send the image as a data URL." };
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) return { error: "That does not look like an image." };

  const type = match[1].toLowerCase();
  if (!ALLOWED.has(type)) return { error: "Use a JPEG, PNG or WebP image." };

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0) return { error: "That image is empty." };
  if (bytes.length > MAX_BYTES) return { error: "That image is too large." };
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
