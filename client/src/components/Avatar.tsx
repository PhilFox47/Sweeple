import { useEffect, useState } from "react";

/**
 * A profile picture, falling back to the initial. The image is squared and shrunk before upload,
 * so it is small enough to drop straight into an <img>.
 */
export default function Avatar({
  name,
  src,
  isAdmin = true,
  className = "",
}: {
  name: string;
  src?: string | null;
  isAdmin?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  // A new picture comes with a new URL; retry rather than staying on the fallback forever.
  useEffect(() => setFailed(false), [src]);

  const classes = `avatar ${isAdmin ? "" : "avatar-guest"} ${src && !failed ? "avatar-photo" : ""} ${className}`;
  return (
    <span className={classes.trim()}>
      {src && !failed ? (
        <img src={src} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </span>
  );
}
