"use client";

/** Brand tile — the "logo" every provider/service/connector card shows. */
import { brandFor, monogramFor } from "@/lib/branding";

export default function BrandTile({
  name,
  id,
  category,
  size = 30,
  style,
}: {
  name: string;
  id?: string;
  category?: string;
  size?: number;
  style?: React.CSSProperties;
}) {
  const key = id ?? name;
  const b = brandFor(key, name, category);
  const glyph = id ? b.glyph : monogramFor(name);
  const fs = Math.max(9, Math.round(size * 0.42));
  return (
    <span
      className="brand-tile"
      aria-hidden
      title={name}
      style={{
        width: size,
        height: size,
        fontSize: fs,
        color: b.color,
        background: `color-mix(in srgb, ${b.color} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${b.color} 35%, transparent)`,
        ...style,
      }}
    >
      {glyph}
    </span>
  );
}
