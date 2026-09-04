import type { GalleryItem } from "@/app/api/gallery/route";

const sys = { uid: "aetheris", name: "Aetheris" };
const mk = (id: string, title: string, description: string, prompt: string, agents: string[], tags: string[], likes = 0): GalleryItem => ({ id, title, description, prompt, agents, tags, author: sys, createdAt: 1_750_000_000_000, uses: 0, likes, likedBy: [] });

/** Starter gallery so the page is never empty. All remixable. */
export const SEED: GalleryItem[] = [
  mk("seed-exam", "Exam crash course", "Turn any syllabus into a 7-day study plan with daily quizzes.", "@tutor I have an exam on {{subject}} in 7 days. Build a day-by-day plan with 25-minute blocks, end each day with a 5-question quiz and grade my answers strictly.", ["tutor"], ["education", "students"], 12),
  mk("seed-review", "Senior code review", "Reviewer + security pass on a pasted diff.", "@coder @security Review this diff as a senior engineer. List bugs first (with line refs), then security issues, then style. Finish with a corrected version.\n\n```diff\n{{paste diff}}\n```", ["coder", "security"], ["coding", "review"], 9),
  mk("seed-gtm", "Go-to-market in one page", "Strategist + marketer produce a launch plan.", "@strategist @marketer One-page GTM for {{product}} targeting {{audience}} in India. Include positioning, 3 channels with weekly budget in ₹, launch week timeline and 5 measurable KPIs.", ["strategist", "marketer"], ["business", "startup"], 7),
  mk("seed-research", "Deep research brief", "Research agent gathers sources and writes a cited brief.", "@researcher Produce a 600-word brief on {{topic}} with at least 6 recent sources, a table of pros/cons, and 3 open questions.", ["researcher"], ["research"], 6),
  mk("seed-tamil", "தமிழில் விளக்கு", "Explain any concept in simple Tamil with an example.", "@tutor {{concept}} என்பதை எளிய தமிழில், ஒரு அன்றாட உதாரணத்துடன் விளக்கு. இறுதியில் 3 கேள்விகள் கேள்.", ["tutor"], ["tamil", "education"], 5),
  mk("seed-hindi", "हिंदी में समझाओ", "Explain any concept in simple Hindi.", "@tutor {{concept}} को आसान हिंदी में एक रोज़मर्रा के उदाहरण के साथ समझाओ। अंत में 3 सवाल पूछो।", ["tutor"], ["hindi", "education"], 5),
  mk("seed-mvp", "Build an MVP with the Factory", "Coding Factory recipe: spec → repo → tests.", "Build a {{stack}} MVP for {{idea}}. Requirements: auth, one core CRUD screen, README with setup, unit tests for the API. Push to GitHub and open a PR with a summary.", [], ["coding", "factory"], 4),
  mk("seed-cold-email", "Cold email that gets replies", "Marketer writes 3 variants + subject lines.", "@marketer Write 3 cold emails (≤90 words) to {{persona}} about {{offer}}. Different angles each; 5 subject lines; one follow-up.", ["marketer"], ["sales", "writing"], 3),
];
