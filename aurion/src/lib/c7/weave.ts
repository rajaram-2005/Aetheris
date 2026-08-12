/* ─── WEAVE — Stage 6: Compositional generators per intent ─── */

import { WeaveResult, Intent, PlotResult, RecallResult, ThinkResult, SenseResult, Style, Settings, Message } from '@/types';
import { translateText } from '@/lib/skills/translate';
import { renderVisage } from '@/lib/skills/visage';
import { generateCode, explainCode, debugCode } from '@/lib/skills/code';

const JOKES = [
  "Why do programmers prefer dark mode? Because light attracts bugs.",
  "There are only 10 types of people: those who understand binary and those who don't.",
  "A SQL query walks into a bar, walks up to two tables and asks: 'Can I join you?'",
  "Why was the JavaScript developer sad? Because he didn't Node how to Express himself.",
  "What's a programmer's favorite hangout place? Foo Bar.",
  "Why do Java developers wear glasses? Because they can't C#.",
  "An SEO expert walks into a bar, bars, pub, tavern, inn, drinking establishment...",
  "What's the object-oriented way to become wealthy? Inheritance.",
  "How many programmers does it take to change a light bulb? None — that's a hardware problem.",
  "Why did the developer go broke? Because he used up all his cache.",
  "What's a computer's least favorite food? Spam.",
  "Why do Python programmers have low self-esteem? Because they're constantly comparing themselves to others.",
  "A QA engineer walks into a bar. Orders 1 beer. Orders 0 beers. Orders 99999999 beers. Orders -1 beers. Orders a lizard.",
  "What do you call a computer that sings? A-Dell.",
  "Why was the function sad? Because it didn't get any callbacks.",
];

/* ── Style modifiers ── */
function applyStyle(text: string, style: Style): string {
  switch (style) {
    case 'brief':
      // Trim to first 2-3 paragraphs or ~500 chars for brief
      const paras = text.split('\n\n');
      return paras.slice(0, 2).join('\n\n');
    case 'formal':
      // Ensure formal language
      return text.replace(/\b(don't|can't|won't|isn't|aren't|doesn't|didn't|wouldn't|couldn't|shouldn't)\b/gi, (m) => {
        const expansions: Record<string, string> = {
          "don't": "do not", "can't": "cannot", "won't": "will not",
          "isn't": "is not", "aren't": "are not", "doesn't": "does not",
          "didn't": "did not", "wouldn't": "would not", "couldn't": "could not",
          "shouldn't": "should not",
        };
        return expansions[m.toLowerCase()] || m;
      });
    case 'simple':
      return text;
    case 'creative':
      return text;
    case 'precise':
      return text;
    default:
      return text;
  }
}

/* ── Intent-specific generators ── */
function generateGreeting(): string {
  const hour = new Date().getHours();
  const timeGreet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 21 ? 'Good evening' : 'Hello';
  return `${timeGreet}. I'm AURION — your on-device cognitive engine. What would you like to work on?`;
}

function generateIdentity(): string {
  return `I'm **AURION**, a sovereign cognitive engine that runs entirely on your device.

**What I am:**
- A locally-running AI powered by the **C7 cascade** — my own 7-stage processing pipeline
- Built with zero third-party AI APIs — no OpenAI, no Claude, no Gemini
- All processing happens in your browser. Nothing is sent to external servers

**What I can do:**
- 💬 **Chat** and answer questions from my built-in knowledge base
- ✍️ **Write** emails, letters, blogs, stories, poems, social media posts
- 💻 **Generate and explain code** in Python, JS, Java, C++, SQL, Go, and more
- 🔢 **Solve math** — arithmetic, algebra, unit conversions, statistics
- 🌐 **Translate** between English, Hindi, Telugu, Spanish, French, German, Tamil
- 🎨 **Create visuals** — procedural art, diagrams, color palettes via Visage
- 📚 **Study** — quizzes, flashcards, study plans, ELI5 explanations
- 📁 **Analyze files** you attach — text, CSV, code, images

I'm honest about what I know and what I don't. Ask me anything.`;
}

function generateCapability(): string {
  return `Here's what I can do:

| Category | Capabilities |
|----------|-------------|
| **Write** | Emails, letters, blogs, social posts, ads, poems, stories |
| **Code** | Generate, explain, debug in Python, JS, Java, C++, SQL, Go, HTML, bash |
| **Math** | Arithmetic, algebra, calculus expressions, unit conversions, statistics |
| **Learn** | Quizzes, flashcards, study plans, ELI5 explanations |
| **Translate** | Hindi, Telugu, Spanish, French, German, Tamil |
| **Create** | Procedural art (Visage), diagrams, color palettes |
| **Analyze** | File analysis, text summarization, comparison |
| **Plan** | Travel, recipes, health info, schedules |

**Privacy first:** Everything runs on-device. No API keys. No data leaves your browser.`;
}

function generateEmail(params: { topic: string; style: Style }): string {
  const isFormal = params.style === 'formal';
  const topic = params.topic || 'professional inquiry';

  return `**Subject:** ${topic.charAt(0).toUpperCase() + topic.slice(1)}

---

${isFormal ? 'Dear [Recipient],' : 'Hi [Recipient],'}

I hope this message finds you well. I am writing regarding ${topic}.

[Provide specific details about the purpose of your email here. Be clear about what you need or what you're offering.]

I would appreciate your response at your earliest convenience. Please do not hesitate to reach out if you have any questions or require additional information.

${isFormal ? 'Thank you for your time and consideration.' : 'Thanks for your time!'}

Best regards,
[Your Name]
[Your Title/Position]
[Contact Information]

---
*Tip: Replace the bracketed placeholders with your specific details. The email is structured to be professional and clear.*`;
}

function generateLetter(type: string): string {
  return `**[Your Name]**
[Your Address]
[City, State, PIN Code]
[Date]

**[Recipient's Name]**
[Recipient's Title]
[Organization Name]
[Address]

**Subject:** [Purpose of the letter]

Dear [Recipient],

I am writing to [state the purpose clearly in the first paragraph].

[Body paragraph 1: Provide context and relevant details. Be specific about the matter at hand.]

[Body paragraph 2: Include supporting information, evidence, or reasoning.]

[Closing paragraph: State your request or expected action clearly.]

I look forward to your favorable response. Thank you for your time and consideration.

Yours sincerely,
[Your Name]

---
*Replace all placeholders with your specific details. Adjust the tone based on the letter type (formal complaint, application, request, etc.).*`;
}

function generateBlog(topic: string): string {
  return `# ${topic.charAt(0).toUpperCase() + topic.slice(1)}

*An in-depth exploration*

---

## Introduction

${topic} is a topic that has captured the attention of many. In this post, we'll explore what makes it important, how it works, and what you need to know.

## What is ${topic}?

[Define and explain the topic clearly. Use simple language accessible to your target audience.]

## Why ${topic} Matters

[Explain the significance. Include data points, statistics, or real-world examples.]

## Key Insights

**1. [First Key Point]**
[Explain with evidence or example]

**2. [Second Key Point]**
[Explain with evidence or example]

**3. [Third Key Point]**
[Explain with evidence or example]

## How to Get Started

[Provide actionable steps the reader can take]

## Conclusion

${topic} is an evolving area worth understanding. Whether you're a beginner or experienced, the key is to [summarize the main takeaway].

---

*What are your thoughts on ${topic}? Share in the comments below.*`;
}

function generateSocialPost(platform: string, topic: string): string {
  const tw = `🧵 ${topic}\n\nHere's what most people miss:\n\n1️⃣ [Point 1]\n2️⃣ [Point 2]\n3️⃣ [Point 3]\n\nThe bottom line: [Key takeaway]\n\n#${topic.replace(/\s+/g, '')} #Tech #Learning`;
  const li = `I've been thinking about ${topic}.\n\nHere's my take:\n\n[Share your perspective with 2-3 concrete points]\n\nThe lesson? [Key insight]\n\nWhat's your experience? 👇\n\n#${topic.replace(/\s+/g, '')} #ProfessionalDevelopment`;
  const ig = `✨ ${topic}\n\n[Share a visual-friendly insight with 2-3 sentences]\n\nDouble tap if you agree ❤️\n\n.\n.\n.\n#${topic.replace(/\s+/g, '')} #Motivation #Growth`;
  return platform === 'twitter' ? tw : platform === 'instagram' ? ig : li;
}

function generatePoem(theme: string): string {
  return `**${theme || 'Reflection'}**

[Stanza 1 — Set the scene]
Through ${theme || 'silent'} depths where meaning flows,
A whisper rises, soft and slow,
The world unfolds in muted hue,
As morning light breaks gently through.

[Stanza 2 — Build the imagery]
Each moment held like amber light,
Suspended in the edge of night,
Where thoughts take shape like birds in flight,
And words become the dark's delight.

[Stanza 3 — Deepen the meaning]
We carry stories in our hands,
Written in these shifting sands,
Each grain a truth we understand,
Each hourglass, where time expands.

[Stanza 4 — Conclude]
So let the ${theme || 'words'} remain, remain,
Like echoes after summer rain,
A quiet pulse, a soft refrain,
That turns the loss into the gain.

---
*Feel free to share a specific theme, mood, or style (haiku, sonnet, free verse) and I'll write something more tailored.*`;
}

function generateStory(genre: string): string {
  return `# The Last Signal

*A ${genre || 'science fiction'} short story*

---

The morning the signal arrived, Dr. Priya Sharma was already on her third cup of coffee at the ISRO tracking station in Bengaluru.

The array had been running routine scans when the pattern appeared — a repeating sequence buried deep in the noise from Proxima Centauri. Not random. Not interference. Structured.

"Ma'am, you need to see this," said her assistant, Arjun, his voice barely steady.

Priya walked to the console. The waveform pulsed with mathematical precision. Three short. Three long. Three short. Then a pause. Then something that, when mapped to prime numbers, formed a sequence no natural process could explain.

"Are we sure this isn't a calibration artifact?" she asked.

"Triple-checked. The signal is coming from 4.24 light-years away. Whatever sent this... sent it over four years ago."

Priya's hands trembled as she reached for the phone. The Director of ISRO would need to know. So would the Prime Minister. So would the world.

But first, she sat with the signal. Let it wash over her. The universe had been silent for all of human history. And now, at 6:47 AM on a Tuesday in Bengaluru, it had finally spoken.

---

*Want me to continue this story, change the genre, or write something entirely different?*`;
}

function generateSummary(text: string, articles: RecallResult['articles']): string {
  if (articles.length > 0) {
    const top = articles[0];
    return `## Summary: ${top.title}\n\n${top.content.split('. ').slice(0, 5).join('. ')}.\n\n**Key points from knowledge base:**\n${articles.slice(0, 3).map(a => `- **${a.title}:** ${a.content.split('. ').slice(0, 2).join('. ')}.`).join('\n')}`;
  }
  return `## Summary\n\n${text.length > 200 ? text.slice(0, 200) + '...' : text}\n\n*I can summarize text you provide directly. Paste the content you'd like summarized and I'll extract the key points.*`;
}

function generateExplanation(topic: string, articles: RecallResult['articles'], style: Style): string {
  if (articles.length > 0 && articles[0].score > 1) {
    const top = articles[0];
    if (style === 'simple') {
      return `## ${top.title}\n\n${top.content}\n\n---\n*This explanation is based on my built-in knowledge base. For more depth, ask follow-up questions.*`;
    }
    return `## ${top.title}\n\n${top.content}`;
  }

  if (style === 'simple') {
    return `I'd like to give you a clear explanation of **${topic}**. Here's what I know:\n\n[Based on available knowledge]\n\nI want to be upfront: my knowledge base may not have detailed information on this specific topic. Here's what I can share:\n\n- General principles that apply\n- Related concepts I do know about\n- Where you might find more authoritative information\n\nWant me to try a different angle, or would you like to share more context about what specifically interests you?`;
  }

  return `I don't have specific detailed knowledge about **${topic}** in my built-in knowledge base. Rather than give you potentially inaccurate information, here's what I'd suggest:\n\n1. I can explain related concepts I do know well\n2. You can paste relevant text and I'll explain it\n3. Ask me to break it down in simpler terms (ELI5)\n\nWhat would be most helpful?`;
}

function generateHowTo(topic: string, articles: RecallResult['articles']): string {
  const kbMatch = articles.find(a => a.score > 1);
  if (kbMatch) {
    return `## How to: ${topic}\n\nBased on my knowledge:\n\n${kbMatch.content}\n\n**Step-by-step:**\n1. Start with the fundamentals\n2. Practice with small examples\n3. Build up to more complex scenarios\n4. Review and iterate\n\n*Want me to go deeper on any step?*`;
  }
  return `## How to: ${topic}\n\nHere's a practical approach:\n\n**Step 1:** Define exactly what you want to achieve\n**Step 2:** Identify what you already know and what you need to learn\n**Step 3:** Start with the simplest version of the task\n**Step 4:** Iterate and improve based on results\n\n*I have more detailed guidance for specific topics. Could you share more about what aspect you'd like help with?*`;
}

function generateQuiz(topic: string, articles: RecallResult['articles']): string {
  const article = articles.find(a => a.score > 0.5) || articles[0];
  const title = article?.title || topic;
  const content = article?.content || '';

  return `## 📝 Quiz: ${title}

**Question 1:** [Based on ${title}]
A) Option A  B) Option B  C) Option C  D) Option D
<details><summary>Answer</summary>B — [Explanation based on knowledge base]</details>

**Question 2:** [Conceptual question]
A) Option A  B) Option B  C) Option C  D) Option D
<details><summary>Answer</summary>A — [Explanation]</details>

**Question 3:** [Application question]
A) Option A  B) Option B  C) Option C  D) Option D
<details><summary>Answer</summary>C — [Explanation]</details>

**Question 4:** [Higher-order thinking]
A) Option A  B) Option B  C) Option C  D) Option D
<details><summary>Answer</summary>D — [Explanation]</details>

**Question 5:** [Problem-solving]
A) Option A  B) Option B  C) Option C  D) Option D
<details><summary>Answer</summary>B — [Explanation]</details>

---
*Score yourself: 5/5 = Excellent, 4/5 = Good, 3/5 = Review, <3 = Study more*
*I can generate quizzes on any topic. The more specific your request, the better the questions.*`;
}

function generateFlashcards(topic: string, articles: RecallResult['articles']): string {
  const article = articles.find(a => a.score > 0.5);
  const title = article?.title || topic;

  return `## 📇 Flashcards: ${title}

**Card 1**
**Q:** What is ${title}?
**A:** ${article?.content.split('.').slice(0, 2).join('.') || '[Definition]'}

---

**Card 2**
**Q:** Key concept #1 related to ${title}?
**A:** [First important fact or principle]

---

**Card 3**
**Q:** Key concept #2?
**A:** [Second important fact]

---

**Card 4**
**Q:** How is ${title} applied in practice?
**A:** [Practical application or example]

---

**Card 5**
**Q:** Common misconception about ${title}?
**A:** [What people often get wrong and the correct understanding]

---
*Flip each card by clicking. Ask me to generate more cards or focus on a specific subtopic.*`;
}

function generateResume(details: string): string {
  return `# [Your Name]
📍 [City, State] | 📧 [email] | 📱 [phone] | 🔗 [LinkedIn/GitHub]

---

## Professional Summary
Results-driven professional with expertise in [your field]. [2-3 sentences highlighting your key achievements and what you bring to the role.]

---

## Experience

### [Job Title] — [Company Name]
*[Start Date] – [End Date/Present]*
- [Action verb] + [what you did] + [measurable result]
- [Action verb] + [what you did] + [measurable result]
- [Action verb] + [what you did] + [measurable result]

### [Previous Job Title] — [Company Name]
*[Start Date] – [End Date]*
- [Achievement with numbers]
- [Achievement with numbers]

---

## Education
**[Degree]** — [University Name], [Year]
[Relevant coursework, GPA if strong, honors]

---

## Skills
**Technical:** [Skill 1], [Skill 2], [Skill 3], [Skill 4]
**Tools:** [Tool 1], [Tool 2], [Tool 3]
**Soft Skills:** [Leadership], [Communication], [Problem-solving]

---

## Projects
**[Project Name]** — [Brief description with tech stack and impact]

---
*Replace all placeholders. Use action verbs: Led, Built, Designed, Implemented, Optimized, Delivered. Quantify results wherever possible.*`;
}

function generateRecipe(dish: string): string {
  const lowerDish = dish.toLowerCase();
  if (lowerDish.includes('biryani')) {
    return `# 🍚 Hyderabadi Dum Biryani

**Prep:** 30 min | **Cook:** 60 min | **Serves:** 4-6

## Ingredients

**For Rice:**
- 2 cups Basmati rice (soaked 30 min)
- 6 cups water
- 2 bay leaves, 4 cardamom, 4 cloves, 1 cinnamon stick
- Salt to taste

**For Meat/Chicken:**
- 500g chicken (bone-in) or mutton
- 1 cup yogurt
- 2 tbsp ginger-garlic paste
- 1 tsp red chili powder
- ½ tsp turmeric
- 1 tsp garam masala
- Salt to taste
- Juice of 1 lemon
- Fresh mint and coriander leaves
- 3 sliced onions (fried golden)
- 4 tbsp ghee
- Pinch of saffron in ¼ cup warm milk

## Method

1. **Marinate:** Mix chicken with yogurt, ginger-garlic paste, spices, lemon juice, half the fried onions, mint, and coriander. Rest for 1-2 hours (overnight is best).

2. **Par-boil rice:** Boil rice with whole spices until 70% cooked. Drain.

3. **Layer:** In a heavy-bottomed pot, spread marinated chicken. Layer par-boiled rice on top. Sprinkle saffron milk, remaining fried onions, ghee, mint, and coriander.

4. **Dum:** Seal the pot with dough or tight foil. Cook on high heat 5 min, then lowest heat for 40-45 min.

5. **Rest and serve:** Let it sit 5 min. Open and gently mix layers. Serve with raita and mirchi ka salan.

**Pro Tips:**
- Use aged Basmati rice for best results
- Fried onions (birista) are the secret — don't skip them
- The 'dum' (steam) is what makes it authentic`;
  }
  return `# 🍽️ ${dish.charAt(0).toUpperCase() + dish.slice(1)} Recipe

**Prep:** [X] min | **Cook:** [X] min | **Serves:** [X]

## Ingredients
- [Ingredient 1 with quantity]
- [Ingredient 2 with quantity]
- [Ingredient 3 with quantity]
- [Spices and seasonings]

## Method
1. [Step 1 — preparation]
2. [Step 2 — cooking main component]
3. [Step 3 — combining and finishing]
4. [Step 4 — plating and serving]

## Tips
- [Pro tip 1]
- [Pro tip 2]

---
*Tell me the specific dish and I'll provide a detailed recipe. I have detailed knowledge of Hyderabadi, Indian, and international cuisines.*`;
}

function generateTravelPlan(destination: string): string {
  if (destination.toLowerCase().includes('hyderabad')) {
    return `# 🏛️ Hyderabad Weekend Guide

## Day 1: Old City Heritage Walk

**Morning:**
- ☀️ Start at **Charminar** (arrive early, ~7 AM for best photos)
- Walk through **Laad Bazaar** for bangles and pearls
- Visit **Mecca Masjid** (one of India's largest mosques)
- Breakfast: **Nimrah Café** — Irani chai + Osmania biscuits

**Afternoon:**
- 🏰 **Golconda Fort** (allow 2-3 hours, hire a guide)
- Lunch: **Paradise Biryani** (the iconic biryani destination)
- Visit **Qutb Shahi Tombs** near Golconda

**Evening:**
- 🌅 **Hussain Sagar Lake** — boating to the Buddha statue
- Walk along **Tank Bund** road
- Dinner: **Shah Ghouse** for haleem or biryani

## Day 2: Modern Hyderabad

**Morning:**
- 🎬 **Ramoji Film City** (full day needed, book tickets online)
- OR **Salar Jung Museum** (world's largest one-man collection)

**Afternoon:**
- Shopping at **Laad Bazaar** / **Shilparamam** (crafts village)
- Lunch: Try **Shadab** or **Café Bahar** for authentic biryani

**Evening:**
- 🌆 **Necklace Road** — evening stroll
- **Durgam Cheruvu** cable bridge (beautiful when lit up)
- Dinner: **Chutneys** for South Indian vegetarian

## Budget Estimate (per person)
| Category | Cost (₹) |
|----------|-----------|
| Food | 1,500-3,000 |
| Transport (auto/cab) | 800-1,500 |
| Entry tickets | 500-1,000 |
| Shopping | Varies |
| **Total** | **~₹3,000-6,000** |

## Tips
- Auto-rickshaws: negotiate fare or use Rapido/Uber
- Best biryani: Paradise (Secunderabad), Shah Ghouse, Bawarchi
- Pearl shopping: Laad Bazaar, Pathergatti
- Weather: Hot most of year; Oct-Feb is pleasant`;
  }
  return `# ✈️ ${destination} Travel Guide

## Overview
[Destination] offers [unique features]. Best time to visit: [season].

## Day 1
- **Morning:** [Activity 1]
- **Afternoon:** [Activity 2]
- **Evening:** [Activity 3]

## Day 2
- **Morning:** [Activity 4]
- **Afternoon:** [Activity 5]
- **Evening:** [Activity 6]

## Where to Eat
- [Restaurant 1 — specialty]
- [Restaurant 2 — specialty]

## Budget
| Category | Estimated Cost |
|----------|---------------|
| Accommodation | [range] |
| Food | [range] |
| Transport | [range] |
| Activities | [range] |

## Tips
- [Practical tip 1]
- [Practical tip 2]

---
*Tell me the destination and your preferences for a tailored itinerary.*`;
}

function generateHealthInfo(topic: string): string {
  return `## Health Information: ${topic}

*⚠️ This is educational information only, not medical advice. Always consult a qualified healthcare professional for medical concerns.*

[General educational information about ${topic} based on available knowledge]

### Key Points
- [Important fact 1]
- [Important fact 2]
- [Important fact 3]

### When to See a Doctor
If you experience [specific symptoms], consult a healthcare professional promptly.

### General Wellness Tips
- Stay hydrated (2-3 liters water daily)
- Maintain a balanced diet
- Exercise regularly (150 min/week moderate activity)
- Get adequate sleep (7-8 hours)
- Manage stress through mindfulness or relaxation

**Emergency numbers:** Ambulance: 108 | Emergency: 112

*I can provide general educational information. For specific medical advice, diagnosis, or treatment, please consult a doctor.*`;
}

function generateStudyPlan(exam: string): string {
  return `# 📚 Study Plan: ${exam || 'Your Exam'}

## Overview
A structured approach to maximize your preparation.

## Phase 1: Foundation (Weeks 1-4)
- **Week 1-2:** Review fundamentals, identify weak areas
- **Week 3-4:** Deep dive into core concepts
- **Daily:** 6-8 hours focused study + 1 hour revision

## Phase 2: Practice (Weeks 5-8)
- **Week 5-6:** Topic-wise problem solving
- **Week 7-8:** Previous year questions (PYQs)
- **Daily:** 4 hours problem solving + 2 hours concept review

## Phase 3: Mock Tests (Weeks 9-12)
- **Week 9-10:** Full-length mock tests (2-3 per week)
- **Week 11-12:** Analysis of mistakes, targeted revision
- **Daily:** 3 hours mock test + 3 hours analysis/revision

## Daily Schedule
| Time | Activity |
|------|----------|
| 6:00-6:30 | Wake up, freshen up |
| 6:30-8:30 | Study Session 1 (hardest subject) |
| 8:30-9:00 | Breakfast |
| 9:00-12:00 | Study Session 2 |
| 12:00-1:00 | Lunch + rest |
| 1:00-3:00 | Study Session 3 (practice problems) |
| 3:00-3:30 | Break |
| 3:30-5:30 | Study Session 4 |
| 5:30-6:30 | Exercise/walk |
| 6:30-8:30 | Study Session 5 (revision) |
| 8:30-9:30 | Dinner + relaxation |
| 9:30-10:00 | Light review / flashcards |
| 10:00 | Sleep |

## Tips
- Use spaced repetition for memorization
- Maintain an error log — review it weekly
- Take breaks: 5 min every 25 min (Pomodoro technique)
- Stay healthy: sleep, exercise, nutrition matter for brain performance`;
}

function generateDiagram(topic: string): string {
  return `## 📊 Diagram: ${topic}

I can create procedural diagrams using my Visage canvas engine. Here are the types I support:

- **Flowchart** — Process flows, decision trees
- **Mind Map** — Brainstorming, concept connections
- **Timeline** — Chronological events
- **Architecture** — System components and connections

To create a diagram, try asking:
- "Draw a flowchart for [process]"
- "Create a mind map about [topic]"
- "Show a timeline of [events]"

*The diagram will be rendered as a canvas image using Visage.*`;
}

function generatePalette(mood: string): string {
  const palettes: Record<string, { name: string; colors: string[]; description: string }> = {
    aurora: { name: 'Aurora Borealis', colors: ['#3dffc2', '#0a2463', '#1b4965', '#62b6cb', '#f5c16c'], description: 'Inspired by the northern lights — deep navy base with mint and gold accents' },
    sunset: { name: 'Golden Sunset', colors: ['#ff6b35', '#f7c59f', '#efefd0', '#004e89', '#1a659e'], description: 'Warm oranges meeting cool blues' },
    forest: { name: 'Deep Forest', colors: ['#2d6a4f', '#40916c', '#52b788', '#95d5b2', '#d8f3dc'], description: 'Lush greens from dark canopy to light fern' },
    ocean: { name: 'Ocean Depth', colors: ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#caf0f8'], description: 'Deep sea to surface — blues with cyan highlights' },
    midnight: { name: 'Midnight Elegance', colors: ['#10002b', '#240046', '#3c096c', '#5a189a', '#9d4edd'], description: 'Rich purples from near-black to bright violet' },
    sakura: { name: 'Sakura Blossom', colors: ['#ffafcc', '#ffc8dd', '#bde0fe', '#a2d2ff', '#cdb4db'], description: 'Soft pinks and blues inspired by cherry blossoms' },
    desert: { name: 'Desert Dune', colors: ['#d4a373', '#e9c46a', '#f4a261', '#e76f51', '#264653'], description: 'Warm sands with terracotta and deep teal' },
  };

  const key = Object.keys(palettes).find(k => mood.toLowerCase().includes(k)) || 'aurora';
  const palette = palettes[key];

  return `## 🎨 ${palette.name}

\`\`\`
${palette.colors.map((c, i) => `Color ${i + 1}: ${c}  ████████`).join('\n')}
\`\`\`

**Use case:** ${palette.description}

**CSS Variables:**
\`\`\`css
:root {
${palette.colors.map((c, i) => `  --color-${i + 1}: ${c};`).join('\n')}
}
\`\`\`

**Tailwind:**
\`\`\`javascript
colors: {
${palette.colors.map((c, i) => `  '${key}-${i + 1}': '${c}',`).join('\n')}
}
\`\`\`

*I generate harmonious palettes based on mood, theme, or context. Ask for: aurora, sunset, forest, ocean, midnight, sakura, desert, or describe a mood.*`;
}

/* ── Main WEAVE pipeline ── */
export function weave(
  rawText: string,
  intent: Intent,
  plotResult: PlotResult,
  recallResult: RecallResult,
  thinkResult: ThinkResult,
  senseResult: SenseResult,
  settings: Settings,
  attachments?: { name: string; content: string }[],
  threadMessages?: Message[],
): WeaveResult {
  let response = '';
  let format: WeaveResult['format'] = 'text';
  const style = plotResult.style;

  // File QA: prioritize attached content
  if (intent === 'file_qa' && attachments && attachments.length > 0) {
    const fileContent = attachments.map(a => `**${a.name}:**\n${a.content.slice(0, 2000)}`).join('\n\n');
    response = `## Analysis of Attached File\n\n${fileContent}\n\n**Your question:** ${rawText}\n\nBased on the file content above, here's what I can tell you:\n\n[Answer based on the file content. Reference specific parts of the file when applicable.]\n\n*I analyzed the text content of your attachment. For more specific insights, ask focused questions about particular sections.*`;
    format = 'markdown';
    return { response: applyStyle(response, style), format };
  }

  // Math results take priority
  if (thinkResult.type !== 'none') {
    response = `## 🔢 ${thinkResult.type === 'math' ? 'Calculation' : thinkResult.type === 'conversion' ? 'Unit Conversion' : thinkResult.type === 'percent' ? 'Percentage' : thinkResult.type === 'quadratic' ? 'Quadratic Equation' : 'Statistics'}\n\n`;
    if (thinkResult.steps.length > 0) {
      response += `**Steps:**\n${thinkResult.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n`;
    }
    response += `**Result:** ${thinkResult.output}`;
    format = 'markdown';
    return { response: applyStyle(response, style), format };
  }

  switch (intent) {
    case 'greet':
      response = generateGreeting();
      break;

    case 'identity':
      response = generateIdentity();
      format = 'markdown';
      break;

    case 'capability':
      response = generateCapability();
      format = 'markdown';
      break;

    case 'write_email':
      response = generateEmail({ topic: rawText, style });
      format = 'markdown';
      break;

    case 'write_letter':
      response = generateLetter(rawText);
      format = 'markdown';
      break;

    case 'write_blog':
      response = generateBlog(rawText.replace(/write\s+(a\s+)?(blog|article|post)\s*(about|on|for)?\s*/i, '').trim() || 'the given topic');
      format = 'markdown';
      break;

    case 'write_social':
      response = generateSocialPost('linkedin', rawText.replace(/write\s+(a\s+)?(tweet|post|caption)\s*(about|on|for)?\s*/i, '').trim() || 'your topic');
      break;

    case 'write_ad':
      response = `[Ad Copy]\n\n🔥 ${rawText.replace(/write\s+(an?\s+)?ad\s*(for|about)?\s*/i, '').trim() || 'Product'}\n\n[Headline that grabs attention]\n\n[2-3 sentences about the unique value proposition. Focus on benefits, not features.]\n\n✅ [Benefit 1]\n✅ [Benefit 2]\n✅ [Benefit 3]\n\n👉 [Call to Action] — [Link/Contact]\n\n*I can tailor the tone (professional, casual, urgent, luxury) — just tell me the product and audience.*`;
      break;

    case 'write_poem':
      response = generatePoem(rawText.replace(/write\s+(a\s+)?(poem|poetry|verse)\s*(about|on|for)?\s*/i, '').trim() || 'reflection');
      format = 'markdown';
      break;

    case 'write_story':
      response = generateStory(rawText.replace(/write\s+(a\s+)?(story|tale|fiction)\s*(about|on)?\s*/i, '').trim() || 'science fiction');
      format = 'markdown';
      break;

    case 'rewrite':
    case 'summarize':
      response = generateSummary(rawText, recallResult.articles);
      format = 'markdown';
      break;

    case 'code_gen': {
      const lang = detectCodeLanguage(rawText);
      const codeResult = generateCode(rawText, lang);
      response = codeResult;
      format = 'code';
      break;
    }

    case 'code_explain': {
      const codeMatch = rawText.match(/```[\w]*\n([\s\S]*?)```/);
      const code = codeMatch ? codeMatch[1] : rawText;
      response = explainCode(code);
      format = 'code';
      break;
    }

    case 'code_debug': {
      const codeMatch = rawText.match(/```[\w]*\n([\s\S]*?)```/);
      const code = codeMatch ? codeMatch[1] : rawText;
      response = debugCode(code, rawText);
      format = 'code';
      break;
    }

    case 'translate': {
      const result = translateText(rawText);
      response = result;
      format = 'text';
      break;
    }

    case 'explain':
    case 'eli5': {
      const topic = rawText.replace(/^(explain|what\s+is|tell\s+me\s+about|describe|define|eli5)\s*/i, '').replace(/[?!.,]/g, '').trim();
      response = generateExplanation(topic, recallResult.articles, intent === 'eli5' ? 'simple' : style);
      format = 'markdown';
      break;
    }

    case 'howto': {
      const topic = rawText.replace(/^how\s+(to|do|can)\s+(i\s+)?/i, '').replace(/[?!.,]/g, '').trim();
      response = generateHowTo(topic, recallResult.articles);
      format = 'markdown';
      break;
    }

    case 'compare': {
      const parts = rawText.replace(/compare\s+|difference\s+between\s+|vs\.?\s+/i, '').split(/\s+(?:and|or|with|versus)\s+/i);
      if (parts.length >= 2) {
        response = `## Comparing: ${parts[0]} vs ${parts[1]}\n\n| Aspect | ${parts[0]} | ${parts[1]} |\n|--------|${'---'.repeat(parts[0].length / 3 + 1)}|${'---'.repeat(parts[1].length / 3 + 1)}|\n| Definition | [Definition] | [Definition] |\n| Key Feature | [Feature] | [Feature] |\n| Use Case | [When to use] | [When to use] |\n| Pros | [Advantages] | [Advantages] |\n| Cons | [Disadvantages] | [Disadvantages] |`;
      } else {
        response = generateExplanation(rawText, recallResult.articles, style);
      }
      format = 'markdown';
      break;
    }

    case 'quiz':
      response = generateQuiz(rawText.replace(/quiz\s+(me\s+)?(on\s+)?/i, '').trim(), recallResult.articles);
      format = 'markdown';
      break;

    case 'flashcard':
      response = generateFlashcards(rawText.replace(/flash\s*cards?\s*(for|on|about)?\s*/i, '').trim(), recallResult.articles);
      format = 'markdown';
      break;

    case 'study':
      response = generateStudyPlan(rawText.replace(/study\s+(plan|guide|tips|method)\s*(for)?\s*/i, '').trim());
      format = 'markdown';
      break;

    case 'resume':
      response = generateResume(rawText);
      format = 'markdown';
      break;

    case 'interview':
      response = `## 🎯 Interview Preparation\n\nBased on: ${rawText}\n\n### Common Questions:\n\n**1. Tell me about yourself**\n*Framework:* Present (role) → Past (relevant experience) → Future (why this role)\n\n**2. Why are you interested in this role?**\n*Connect your skills to their needs. Reference specific aspects of the company.*\n\n**3. What's your greatest strength?**\n*Give a specific example with measurable results.*\n\n**4. Describe a challenging situation**\n*Use STAR method: Situation → Task → Action → Result*\n\n**5. Where do you see yourself in 5 years?**\n*Show ambition while being realistic. Connect to the growth path.*\n\n**6. Do you have any questions for us?**\n*Always say yes. Ask about team culture, growth opportunities, current challenges.*\n\n### Tips:\n- Research the company thoroughly\n- Prepare 3-5 stories using the STAR method\n- Practice out loud (not just in your head)\n- Dress one level above the company dress code\n- Arrive 10-15 minutes early`;
      format = 'markdown';
      break;

    case 'analyze':
      response = `## 🔍 Analysis\n\n**Subject:** ${rawText}\n\n### Key Observations\n1. [First major observation]\n2. [Second major observation]\n3. [Third major observation]\n\n### Detailed Breakdown\n[Structured analysis with evidence and reasoning]\n\n### Implications\n[What this means and why it matters]\n\n### Recommendations\n[Actionable next steps based on the analysis]\n\n*Provide more specific context for a deeper analysis.*`;
      format = 'markdown';
      break;

    case 'brainstorm':
      response = `## 💡 Ideas: ${rawText.replace(/brainstorm\s*(ideas?\s*(for|about)?)?\s*/i, '').trim()}\n\n### Quick Wins (low effort, high impact)\n1. 💡 [Idea 1]\n2. 💡 [Idea 2]\n3. 💡 [Idea 3]\n\n### Bold Moves (high effort, transformative)\n1. 🚀 [Idea 4]\n2. 🚀 [Idea 5]\n3. 🚀 [Idea 6]\n\n### Lateral Thinking (unexpected angles)\n1. 🔀 [Idea 7]\n2. 🔀 [Idea 8]\n3. 🔀 [Idea 9]\n\n*Tell me more about your constraints, audience, or goals for more targeted ideas.*`;
      format = 'markdown';
      break;

    case 'plan':
      response = `## 📋 Plan: ${rawText.replace(/plan\s*(for)?\s*/i, '').trim()}\n\n### Goals\n- [Primary goal]\n- [Secondary goal]\n\n### Timeline\n| Phase | Duration | Tasks |\n|-------|----------|-------|\n| Phase 1 | Week 1-2 | [Setup and foundation] |\n| Phase 2 | Week 3-4 | [Core development] |\n| Phase 3 | Week 5-6 | [Testing and refinement] |\n| Phase 4 | Week 7-8 | [Launch and iteration] |\n\n### Key Milestones\n- ✅ [Milestone 1] — Week 2\n- ✅ [Milestone 2] — Week 4\n- ✅ [Milestone 3] — Week 6\n- ✅ [Milestone 4] — Week 8\n\n### Resources Needed\n- [Resource 1]\n- [Resource 2]\n\n### Risks & Mitigation\n| Risk | Mitigation |\n|------|------------|\n| [Risk 1] | [How to handle] |\n| [Risk 2] | [How to handle] |`;
      format = 'markdown';
      break;

    case 'image':
    case 'diagram': {
      response = `## 🎨 Visage Canvas\n\nI've generated a procedural visualization using my Visage engine.\n\n[Canvas output will be rendered in the Visage panel]\n\n*Visage creates procedural art using Canvas2D — aurora effects, mandalas, circuit patterns, starfields, posters, and flowcharts.*`;
      break;
    }

    case 'palette':
      response = generatePalette(rawText.replace(/(color|colour)\s+palette\s*(for)?\s*/i, '').trim());
      format = 'markdown';
      break;

    case 'recipe':
      response = generateRecipe(rawText.replace(/(recipe\s*(for)?|how\s+to\s+(make|cook|prepare)\s*)/i, '').trim());
      format = 'markdown';
      break;

    case 'travel':
      response = generateTravelPlan(rawText.replace(/(travel|visit|places?\s+(in|to|at)|things\s+to\s+do\s+in|weekend\s+(in|at))\s*/i, '').trim());
      format = 'markdown';
      break;

    case 'health':
      response = generateHealthInfo(rawText);
      format = 'markdown';
      break;

    case 'convert':
      response = thinkResult.type !== 'none' ? thinkResult.output : `I can convert between common units:\n- Length: km ↔ miles, m ↔ feet, cm ↔ inches\n- Weight: kg ↔ lbs, g ↔ kg, oz ↔ lbs\n- Temperature: °C ↔ °F ↔ K\n- Speed: km/h ↔ mph\n- Data: MB ↔ GB, KB ↔ MB\n\nTry: "Convert 100 km to miles" or "36.5 celsius to fahrenheit"`;
      break;

    case 'datetime': {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
      response = `📅 **Current Date & Time**\n\n${now.toLocaleDateString('en-US', options)}\n\nDay: ${now.toLocaleDateString('en-US', { weekday: 'long' })}\nDate: ${now.getDate()} ${now.toLocaleDateString('en-US', { month: 'long' })} ${now.getFullYear()}\nTime: ${now.toLocaleTimeString('en-US')}`;
      break;
    }

    case 'joke':
      response = JOKES[Math.floor(Math.random() * JOKES.length)];
      break;

    case 'chat':
    default: {
      // Use recall results for knowledge-grounded chat
      if (recallResult.articles.length > 0 && recallResult.articles[0].score > 2) {
        const top = recallResult.articles[0];
        response = `**${top.title}**\n\n${top.content}\n\n*Want me to go deeper on any aspect?*`;
        format = 'markdown';
      } else if (recallResult.sessionContext) {
        response = `That's an interesting question. Based on our conversation, I can see you're exploring some thought-provoking topics.\n\n${rawText.toLowerCase().includes('thank') ? "You're welcome! I'm here whenever you need help." : "I'll do my best to help. Could you give me a bit more context so I can provide a more specific answer?"}`;
      } else {
        response = `I understand you're asking about: "${rawText.slice(0, 100)}"\n\nI want to be straightforward — this might be outside my built-in knowledge base. Here's what I can do:\n\n1. 📚 Share what I do know about related topics\n2. 🔍 If you paste relevant text, I can analyze it\n3. 💡 Break down the question from first principles\n4. 📝 Write about it using general knowledge\n\nWhat would be most helpful?`;
      }
      break;
    }
  }

  return { response: applyStyle(response, style), format };
}

/* ── Helpers ── */
function detectCodeLanguage(text: string): string {
  const lower = text.toLowerCase();
  if (/\bpython\b|\bpy\b/.test(lower)) return 'python';
  if (/\bjavascript\b|\bjs\b|\bnode\b|\breact\b/.test(lower)) return 'javascript';
  if (/\btypescript\b|\bts\b/.test(lower)) return 'typescript';
  if (/\bjava\b(?!script)/.test(lower)) return 'java';
  if (/\bc\+\+\b|\bcpp\b/.test(lower)) return 'cpp';
  if (/\bc\b(?!\+|#|ss)/.test(lower)) return 'c';
  if (/\bsql\b/.test(lower)) return 'sql';
  if (/\bhtml\b/.test(lower)) return 'html';
  if (/\bcss\b/.test(lower)) return 'css';
  if (/\bgo\b|\bgolang\b/.test(lower)) return 'go';
  if (/\bbash\b|\bshell\b/.test(lower)) return 'bash';
  if (/\brust\b/.test(lower)) return 'rust';
  return 'python'; // default
}
