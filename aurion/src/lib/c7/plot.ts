/* ─── PLOT — Stage 3: Map intent → task-graph steps + style ─── */

import { PlotResult, Intent, Style, AlignResult, SenseResult, Settings } from '@/types';

const INTENT_PLANS: Record<Intent, { steps: { action: string; description: string }[]; defaultStyle: Style; format: string }> = {
  greet: {
    steps: [
      { action: 'detect_time', description: 'Determine time of day for greeting' },
      { action: 'generate_greeting', description: 'Craft warm, brief greeting' },
    ],
    defaultStyle: 'brief',
    format: 'text',
  },
  identity: {
    steps: [
      { action: 'state_identity', description: 'State AURION identity clearly' },
      { action: 'describe_capabilities', description: 'Brief capability overview' },
    ],
    defaultStyle: 'simple',
    format: 'text',
  },
  capability: {
    steps: [
      { action: 'list_capabilities', description: 'Enumerate main capabilities with examples' },
    ],
    defaultStyle: 'simple',
    format: 'list',
  },
  write_email: {
    steps: [
      { action: 'extract_params', description: 'Extract recipient, subject, tone, context' },
      { action: 'generate_email', description: 'Generate professional email with subject line, greeting, body, signature' },
    ],
    defaultStyle: 'formal',
    format: 'markdown',
  },
  write_letter: {
    steps: [
      { action: 'extract_params', description: 'Extract type, recipient, purpose' },
      { action: 'generate_letter', description: 'Generate letter with proper format' },
    ],
    defaultStyle: 'formal',
    format: 'markdown',
  },
  write_blog: {
    steps: [
      { action: 'extract_topic', description: 'Extract topic, audience, keywords' },
      { action: 'generate_outline', description: 'Create blog outline with headings' },
      { action: 'write_content', description: 'Write full blog post' },
    ],
    defaultStyle: 'formal',
    format: 'markdown',
  },
  write_social: {
    steps: [
      { action: 'extract_platform', description: 'Identify platform (Twitter, LinkedIn, Instagram)' },
      { action: 'generate_post', description: 'Write platform-appropriate post with hashtags' },
    ],
    defaultStyle: 'brief',
    format: 'text',
  },
  write_ad: {
    steps: [
      { action: 'extract_product', description: 'Extract product/service, audience, tone' },
      { action: 'generate_ad_copy', description: 'Write compelling ad copy' },
    ],
    defaultStyle: 'creative',
    format: 'text',
  },
  write_poem: {
    steps: [
      { action: 'extract_theme', description: 'Extract theme, style, form' },
      { action: 'generate_poem', description: 'Compose poem with rhythm and imagery' },
    ],
    defaultStyle: 'creative',
    format: 'text',
  },
  write_story: {
    steps: [
      { action: 'extract_elements', description: 'Extract genre, characters, setting, theme' },
      { action: 'generate_story', description: 'Write narrative with structure' },
    ],
    defaultStyle: 'creative',
    format: 'markdown',
  },
  rewrite: {
    steps: [
      { action: 'analyze_original', description: 'Analyze original text structure and intent' },
      { action: 'transform', description: 'Rewrite preserving meaning, improving clarity' },
    ],
    defaultStyle: 'formal',
    format: 'text',
  },
  summarize: {
    steps: [
      { action: 'identify_key_points', description: 'Extract main ideas and key facts' },
      { action: 'generate_summary', description: 'Write concise summary' },
    ],
    defaultStyle: 'brief',
    format: 'markdown',
  },
  code_gen: {
    steps: [
      { action: 'parse_requirements', description: 'Understand what code is needed' },
      { action: 'choose_language', description: 'Determine programming language' },
      { action: 'generate_code', description: 'Write clean, commented code' },
      { action: 'add_usage', description: 'Add usage example' },
    ],
    defaultStyle: 'precise',
    format: 'code',
  },
  code_explain: {
    steps: [
      { action: 'parse_code', description: 'Identify language, structure, and logic' },
      { action: 'explain_stepwise', description: 'Walk through code with explanations' },
    ],
    defaultStyle: 'simple',
    format: 'markdown',
  },
  code_debug: {
    steps: [
      { action: 'identify_error', description: 'Find the bug or error' },
      { action: 'explain_issue', description: 'Explain what went wrong and why' },
      { action: 'provide_fix', description: 'Show corrected code' },
    ],
    defaultStyle: 'precise',
    format: 'code',
  },
  translate: {
    steps: [
      { action: 'detect_target_lang', description: 'Determine target language' },
      { action: 'translate_text', description: 'Translate using phrase memory + lexicon' },
    ],
    defaultStyle: 'simple',
    format: 'text',
  },
  math: {
    steps: [
      { action: 'parse_expression', description: 'Parse mathematical expression' },
      { action: 'solve', description: 'Evaluate step by step' },
      { action: 'present_result', description: 'Show result with steps' },
    ],
    defaultStyle: 'precise',
    format: 'text',
  },
  explain: {
    steps: [
      { action: 'retrieve_knowledge', description: 'Find relevant knowledge base articles' },
      { action: 'structure_explanation', description: 'Organize: definition → context → details → example' },
    ],
    defaultStyle: 'simple',
    format: 'markdown',
  },
  howto: {
    steps: [
      { action: 'identify_task', description: 'Understand the task' },
      { action: 'generate_steps', description: 'Create numbered step-by-step guide' },
    ],
    defaultStyle: 'simple',
    format: 'list',
  },
  compare: {
    steps: [
      { action: 'identify_items', description: 'Identify items to compare' },
      { action: 'generate_comparison', description: 'Create structured comparison' },
    ],
    defaultStyle: 'simple',
    format: 'table',
  },
  quiz: {
    steps: [
      { action: 'identify_topic', description: 'Determine subject and difficulty' },
      { action: 'generate_questions', description: 'Create quiz questions with answers' },
    ],
    defaultStyle: 'simple',
    format: 'markdown',
  },
  flashcard: {
    steps: [
      { action: 'identify_topic', description: 'Determine subject' },
      { action: 'generate_cards', description: 'Create Q/A flashcard pairs' },
    ],
    defaultStyle: 'brief',
    format: 'markdown',
  },
  study: {
    steps: [
      { action: 'identify_exam', description: 'Determine exam/subject' },
      { action: 'generate_plan', description: 'Create study plan with schedule and resources' },
    ],
    defaultStyle: 'simple',
    format: 'markdown',
  },
  eli5: {
    steps: [
      { action: 'retrieve_knowledge', description: 'Find relevant information' },
      { action: 'simplify', description: 'Rewrite using simple words and analogies' },
    ],
    defaultStyle: 'simple',
    format: 'text',
  },
  resume: {
    steps: [
      { action: 'extract_details', description: 'Extract personal details, experience, skills' },
      { action: 'generate_resume', description: 'Create formatted resume' },
    ],
    defaultStyle: 'formal',
    format: 'markdown',
  },
  interview: {
    steps: [
      { action: 'identify_role', description: 'Determine role/company/type' },
      { action: 'generate_questions', description: 'Create interview questions with answer guides' },
    ],
    defaultStyle: 'formal',
    format: 'markdown',
  },
  analyze: {
    steps: [
      { action: 'parse_subject', description: 'Understand what to analyze' },
      { action: 'perform_analysis', description: 'Break down with structured insights' },
    ],
    defaultStyle: 'formal',
    format: 'markdown',
  },
  brainstorm: {
    steps: [
      { action: 'identify_domain', description: 'Understand the creative domain' },
      { action: 'generate_ideas', description: 'Generate diverse ideas with brief descriptions' },
    ],
    defaultStyle: 'creative',
    format: 'list',
  },
  plan: {
    steps: [
      { action: 'identify_goal', description: 'Understand the objective' },
      { action: 'create_plan', description: 'Build timeline with milestones and tasks' },
    ],
    defaultStyle: 'formal',
    format: 'markdown',
  },
  image: {
    steps: [
      { action: 'parse_description', description: 'Understand the visual to create' },
      { action: 'render_visage', description: 'Generate procedural canvas art via Visage' },
    ],
    defaultStyle: 'creative',
    format: 'text',
  },
  diagram: {
    steps: [
      { action: 'parse_structure', description: 'Understand the diagram type and data' },
      { action: 'render_diagram', description: 'Create diagram via Visage canvas' },
    ],
    defaultStyle: 'precise',
    format: 'text',
  },
  palette: {
    steps: [
      { action: 'identify_mood', description: 'Determine mood/theme/context' },
      { action: 'generate_palette', description: 'Create harmonious color palette' },
    ],
    defaultStyle: 'creative',
    format: 'text',
  },
  recipe: {
    steps: [
      { action: 'identify_dish', description: 'Determine the dish' },
      { action: 'retrieve_recipe', description: 'Find recipe from knowledge base' },
      { action: 'format_recipe', description: 'Format with ingredients, steps, tips' },
    ],
    defaultStyle: 'simple',
    format: 'markdown',
  },
  travel: {
    steps: [
      { action: 'identify_destination', description: 'Determine location and preferences' },
      { action: 'generate_itinerary', description: 'Create travel plan with recommendations' },
    ],
    defaultStyle: 'simple',
    format: 'markdown',
  },
  health: {
    steps: [
      { action: 'identify_topic', description: 'Understand health query' },
      { action: 'provide_educational_info', description: 'Provide educational information with disclaimer' },
    ],
    defaultStyle: 'simple',
    format: 'markdown',
  },
  convert: {
    steps: [
      { action: 'parse_units', description: 'Identify value and conversion units' },
      { action: 'perform_conversion', description: 'Calculate conversion with formula' },
    ],
    defaultStyle: 'precise',
    format: 'text',
  },
  datetime: {
    steps: [
      { action: 'get_current_datetime', description: 'Determine current date/time' },
      { action: 'format_response', description: 'Present date/time info' },
    ],
    defaultStyle: 'brief',
    format: 'text',
  },
  joke: {
    steps: [
      { action: 'select_joke', description: 'Choose appropriate joke from collection' },
    ],
    defaultStyle: 'brief',
    format: 'text',
  },
  file_qa: {
    steps: [
      { action: 'parse_file_content', description: 'Read attached file content' },
      { action: 'answer_from_file', description: 'Answer question using file content' },
    ],
    defaultStyle: 'simple',
    format: 'markdown',
  },
  chat: {
    steps: [
      { action: 'generate_response', description: 'Conversational response based on context' },
    ],
    defaultStyle: 'simple',
    format: 'text',
  },
};

export function plot(alignResult: AlignResult, senseResult: SenseResult, settings: Settings): PlotResult {
  const plan = INTENT_PLANS[alignResult.intent];

  // Override style based on settings persona
  let style = plan.defaultStyle;
  switch (settings.persona) {
    case 'precise': style = 'precise'; break;
    case 'imaginative': style = 'creative'; break;
    case 'concise': style = 'brief'; break;
    case 'mentor': style = 'simple'; break;
    case 'balanced': break; // keep default
  }

  // Adjust for detected language (non-English → simpler style)
  if (senseResult.language !== 'en') {
    if (style === 'precise') style = 'formal';
  }

  return {
    steps: plan.steps,
    style,
    format: plan.format,
  };
}
