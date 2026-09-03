export type Feature = "video" | "factory_enterprise" | "unlimited_chat" | "mcp_premium";

export interface Plan {
  id: string;
  name: string;
  priceInr: number;
  days: number;
  features: Feature[];
  blurb: string;
}

export const PLANS: Plan[] = [
  {
    id: "pro-month",
    name: "Aetheris Pro",
    priceInr: 299,
    days: 30,
    features: ["video", "unlimited_chat", "mcp_premium"],
    blurb: "Pro Video Generation, unlimited chat, premium MCP connectors.",
  },
  {
    id: "enterprise-month",
    name: "Aetheris Enterprise",
    priceInr: 999,
    days: 30,
    features: ["video", "unlimited_chat", "mcp_premium", "factory_enterprise"],
    blurb: "Everything in Pro plus the Enterprise GitHub Automation MCP.",
  },
];

export const FREE_DAILY_MESSAGES = Number(process.env.AETHERIS_FREE_DAILY_MESSAGES ?? 50);

export function planById(id: string) {
  return PLANS.find((p) => p.id === id);
}

/** Hardcoded payee — all payments route to the founder. */
export const PAYEE = {
  vpa: process.env.AETHERIS_UPI_VPA ?? "9488407998@upi",
  name: process.env.AETHERIS_UPI_NAME ?? "Rajaram",
  phone: "+919488407998",
  email: "ramkpraja175@gmail.com",
};
