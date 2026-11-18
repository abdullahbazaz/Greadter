// The AI check: reads a submitted PDF (text and diagrams) and returns a suggested mark,
// criteria, issues with page + exact quote, and an AI-written-text estimate.
// Everything provider-specific lives in this file, so switching provider means changing only this.
//
// Settings (Vercel environment variables):
//   ANTHROPIC_API_KEY  required; without it the "Run AI check" button reports that checks aren't set up
//   AI_MODEL           optional; defaults to claude-opus-5-5. claude-haiku-5-5 is far cheaper (see WARNINGS.md)
import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIES } from './annotations.js';

export const AI_MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
// Models that support server-side refusal fallback ("default" routes by refusal category).
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2', 'claude-fable-5-1'];

export const aiConfigured = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

// US$ per million tokens (Claude API list prices, Nov 2026). Used to estimate what each check cost,
// which the daily budget is enforced against. Update when prices or the model change.
const PRICES = {
  'claude-opus-5-5':   { in: 4.00, out: 20.00 },
  'claude-sonnet-5-5': { in: 2.00, out: 10.00 },
  'claude-haiku-5-5':  { in: 0.10, out: 0.50, over100k: { in: 0.50, out: 2.50 } },   // higher rate for prompts over 100K tokens
};
const UNKNOWN_PRICE = { in: 10.00, out: 50.00 };   // unknown model: assume expensive so the budget stays safe

// Spending limits, set as Vercel environment variables.
export function aiLimits() {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    dailyBudgetUsd: num(process.env.AI_DAILY_BUDGET_USD, 5),
    perTeacherPerDay: Math.floor(num(process.env.AI_CHECKS_PER_TEACHER_PER_DAY, 100)),
    maxConcurrent: Math.floor(num(process.env.AI_MAX_CONCURRENT, 5)),
  };
}

export function estimateCost(model, usage) {
  if (!usage) return 0;
  const input = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  const base = PRICES[model] || PRICES[AI_MODEL] || UNKNOWN_PRICE;
  const p = base.over100k && input > 100000 ? base.over100k : base;
  return Math.round(((input * p.in + (usage.output_tokens || 0) * p.out) / 1e6) * 10000) / 10000;
}

const REVIEW_TOOL = {
  name: 'record_review',
  description: 'Record the review of the student assignment: suggested mark, marks per criterion, every issue found, and an estimate of AI-written text.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['suggested_marks', 'summary', 'criteria', 'issues', 'ai_text'],
    properties: {
      suggested_marks: { type: 'integer', description: 'Whole-number mark out of the total marks.' },
      summary: { type: 'string', description: 'Two or three sentences for the teacher on the overall quality.' },
      criteria: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['name', 'marks', 'out_of', 'comment'],
          properties: {
            name: { type: 'string' }, marks: { type: 'integer' }, out_of: { type: 'integer' }, comment: { type: 'string' },
          },
        },
      },
      issues: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['page', 'location', 'kind', 'category', 'quote', 'note', 'suggestion', 'region'],
          properties: {
            page: { type: 'integer', description: '1-based page number.' },
            location: { type: 'string', description: 'Where on the page, in words a student can follow, e.g. "Paragraph 2, second sentence", "Heading of section 3", "Figure 1, the arrow from node B".' },
            kind: { type: 'string', enum: ['text', 'region'], description: '"text" for a mistake in the writing, "region" for a mistake in a diagram, figure, table or equation image.' },
            category: { type: 'string', enum: CATEGORIES },
            quote: { type: 'string', description: 'For text issues: the exact words from the page, copied character for character, 3 to 25 words, unique on that page. For region issues: a short label of the diagram part.' },
            note: { type: 'string', description: 'What is wrong, written to the student in plain language, 1-2 sentences.' },
            suggestion: { type: 'string', description: 'How to fix it, 1 sentence. Empty string if not applicable.' },
            region: {
              description: 'Box around the issue as fractions of page width/height from the top-left. Required for region issues. For text issues give an approximate box too when the page is a scanned image or the text may not be selectable; otherwise null.',
              anyOf: [
                { type: 'object', additionalProperties: false, required: ['x', 'y', 'w', 'h'],
                  properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } } },
                { type: 'null' },
              ],
            },
          },
        },
      },
      ai_text: {
        type: 'object', additionalProperties: false,
        required: ['likelihood', 'reasons', 'passages'],
        properties: {
          likelihood: { type: 'integer', description: '0-100 estimate that parts were written by an AI tool. Be conservative.' },
          reasons: { type: 'string' },
          passages: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, required: ['page', 'quote'],
              properties: { page: { type: 'integer' }, quote: { type: 'string' } } },
          },
        },
      },
    },
  },
};

const SYSTEM = `You mark university assignments for a teacher. The teacher reviews everything you produce before the student sees it.

Mark against the assignment's requirements and total marks. Point out real mistakes only: factual errors, faulty reasoning, missed requirements, wrong or unclear diagrams, and spelling or grammar errors that matter. Do not flag style preferences.

Go through the work page by page. For every issue give the page and say where on it in "location" (for example "Paragraph 2, second sentence" or "Figure 1, the arrow from node B"), so a student can find it even on a scanned page.

For each text issue, copy the exact words from the page into "quote", character for character, so the mistake can be highlighted. Keep quotes short and unique on their page. If the page is a scanned image, also give an approximate "region" box around the words. For a mistake in a diagram, figure, table or image, use kind "region" and give the box around it.

Write each note to the student, in plain language: what is wrong and why. Keep the suggested mark a whole number no higher than the total.

The AI-written-text estimate is a weak signal that teachers treat with caution, because detectors often misjudge genuine writing, especially by non-native English speakers. Only give a high likelihood with clear signs, and list the passages that show them.

Call the record_review tool exactly once with your review.`;

export async function runAiCheck({ pdfBase64, topicTitle, requirements, overview, customSummary, totalMarks }) {
  // Checks are capped below the function limit (vercel.json maxDuration: 180s), with no retries,
  // so a slow check ends as "took too long" instead of being cut off mid-way.
  const client = new Anthropic({ timeout: 160_000, maxRetries: 0 });
  const brief = [
    `Topic: ${topicTitle || 'Untitled'}`,
    overview ? `Overview: ${overview}` : '',
    customSummary ? `The student proposed this topic and summary, mark against it: ${customSummary}` : '',
    requirements ? `Requirements:\n${requirements}` : 'No written requirements: mark on accuracy, completeness and clarity for the topic.',
    `Total marks: ${totalMarks ?? 'not set (use 20)'}`,
  ].filter(Boolean).join('\n\n');

  const params = {
    model: AI_MODEL,
    max_tokens: 32000,
    system: SYSTEM,
    tools: [REVIEW_TOOL],
    tool_choice: { type: 'auto' },   // forced tool choice isn't supported on current models; the prompt asks for the call
    output_config: { effort: 'medium' },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: `${brief}\n\nReview the attached assignment and call record_review.` },
      ],
    }],
  };
  if (FALLBACK_MODELS.includes(AI_MODEL)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  let message;
  try {
    const stream = FALLBACK_MODELS.includes(AI_MODEL) ? client.beta.messages.stream(params) : client.messages.stream(params);
    message = await stream.finalMessage();
  } catch (e) {
    // Most specific first. APIConnectionError also covers our 160-second timeout.
    if (e instanceof Anthropic.RateLimitError) throw new Error('The AI service is busy. Wait a minute and run the check again.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('The AI check took too long or couldn\'t connect. Run it again, or mark this one yourself.');
    if (e instanceof Anthropic.AuthenticationError) throw new Error('The AI key is wrong or expired. Check ANTHROPIC_API_KEY in the Vercel settings.');
    if (e instanceof Anthropic.APIError) throw new Error(`The AI service returned an error (${e.status}). Try again in a minute.`);
    throw e;
  }

  const model = message.model || AI_MODEL;
  const usage = {
    input_tokens: message.usage?.input_tokens || 0, output_tokens: message.usage?.output_tokens || 0,
    cache_creation_input_tokens: message.usage?.cache_creation_input_tokens || 0,
    cache_read_input_tokens: message.usage?.cache_read_input_tokens || 0,
  };
  const costUsd = estimateCost(model, usage);
  // These failures happen after the model has run, so the tokens were paid for: report the cost too.
  const paidFailure = msg => Object.assign(new Error(msg), { model, usage, costUsd });
  if (message.stop_reason === 'refusal') throw paidFailure('The AI declined to review this file. Mark it yourself.');
  if (message.stop_reason === 'max_tokens') throw paidFailure('The review was too long to finish. Try again, or mark it yourself.');
  const call = message.content.find(b => b.type === 'tool_use' && b.name === 'record_review');
  if (!call || !call.input || typeof call.input !== 'object') throw paidFailure("The AI didn't return a review. Try again.");
  return { review: call.input, model, usage, costUsd };
}
