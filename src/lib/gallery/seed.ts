import type { GalleryItem } from "@/app/api/gallery/route";
import type { SeedTuple } from "./seeds/types";
import { education } from "./seeds/education";
import { coding } from "./seeds/coding";
import { business } from "./seeds/business";
import { marketing } from "./seeds/marketing";
import { writing } from "./seeds/writing";
import { life } from "./seeds/life";
import { finance } from "./seeds/finance";
import { legal } from "./seeds/legal";
import { health } from "./seeds/health";
import { science } from "./seeds/science";
import { design } from "./seeds/design";

const sys = { uid: "aetheris", name: "Aetheris" };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);

function expand(list: SeedTuple[], category: string): GalleryItem[] {
  return list.map(([title, description, prompt, agents, tags], i) => ({
    id: `seed-${category}-${slug(title) || `item-${i + 1}`}`,
    title, description, prompt, agents,
    tags: Array.from(new Set([category, ...tags])),
    author: sys, createdAt: 1_750_000_000_000 - i * 1000, uses: 0, likes: Math.max(0, 12 - i), likedBy: [],
  }));
}

/**
 * Starter gallery: hand-written, domain-organised prompt recipes so the page is never empty.
 * Placeholders use {{double braces}}; the composer leaves them for the user to fill in.
 */
export const SEED: GalleryItem[] = [
  ...expand(education, "education"),
  ...expand(coding, "coding"),
  ...expand(business, "business"),
  ...expand(marketing, "marketing"),
  ...expand(writing, "writing"),
  ...expand(life, "life"),
  ...expand(finance, "finance"),
  ...expand(legal, "legal"),
  ...expand(health, "health"),
  ...expand(science, "science"),
  ...expand(design, "design"),
];
