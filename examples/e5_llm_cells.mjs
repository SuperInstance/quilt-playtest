// E5 — "A SPREADSHEET THAT THINKS": real LLM cells wired into the reactive graph.
//
// The core engine's `kind: 'ai'` cells need an AIEngineLike — the repo ships
// interfaces for zai/kimi/deepseek/cloudflare but no working provider in this
// repo. This demo wires z-ai-web-dev-sdk (real GLM calls) into the engine and
// builds a support-ticket triage sheet:
//
//   ticket.text (value)  ──invalidates──▶  ai.urgency (real LLM call)
//        │                                     │
//        ▼                                     ▼
//   triage.workflow (program) ◀── reads ── policy.escalate (formula)
//        └─ escalates: ai.reply (real LLM call, only for urgent tickets)
//
// Reactive invalidation means every new ticket text automatically invalidates
// the AI cells' caches — the next pull makes fresh model calls. No manual
// cache management.
import { QuiltEngine } from '/home/z/my-project/quilt-playtest/packages/core/dist/index.js';
import ZAI from 'z-ai-web-dev-sdk';

// ── the missing AI provider: z-ai-web-dev-sdk as an AIEngineLike ─────
class ZaiAIEngine {
  constructor() { this.zai = null; this.calls = 0; }
  async init() { if (!this.zai) this.zai = await ZAI.create(); return this; }

  async call(config) {
    this.calls++;
    const system = config.system ?? 'You are precise and terse. Reply with only what is asked.';
    let user;
    switch (config.ai_kind) {
      case 'ai.sentiment':
        user = `Classify the sentiment of this text as JSON {\"label\":\"positive|neutral|negative\",\"score\":0-1}:\n"""${config.input ?? config.prompt ?? ''}"""`;
        break;
      case 'ai.summarize':
        user = `Summarize in at most ${config.max_words ?? 30} words:\n"""${config.input ?? ''}"""`;
        break;
      default: // ai.llm and friends
        user = config.prompt ?? config.input ?? '';
    }
    const completion = await this.zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: system },
        { role: 'user', content: user },
      ],
      thinking: { type: 'disabled' },
    });
    const text = completion.choices[0]?.message?.content ?? '';
    if (config.ai_kind === 'ai.sentiment') {
      const m = text.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : { label: 'unknown', score: 0, raw: text };
    }
    if (config.ai_kind === 'ai.llm' && /^\d+(\.\d+)?$/.test(text.trim())) return Number(text.trim());
    return text.trim();
  }
}

const ai = await new ZaiAIEngine().init();

const engine = new QuiltEngine('ticket-triage', { eager: true, ai });

engine.loadSheet({
  id: 'ticket-triage',
  title: 'LLM-powered support triage as a sheet',
  cells: [
    // -- inputs --
    { id: 'ticket.text', kind: 'value', value: '', description: 'current ticket body' },

    // -- REAL AI cells (each evaluation is an actual GLM call) --
    { id: 'ai.urgency', kind: 'ai', ai_kind: 'ai.llm', provider: 'zai', model: 'default',
      system: 'You rate support tickets. Reply with ONLY an integer 1-10 urgency.',
      prompt: 'Ticket: {{ticket.text}}',
      description: 'LLM-scored urgency (1-10)' },

    { id: 'ai.sentiment', kind: 'ai', ai_kind: 'ai.sentiment', provider: 'zai', model: 'default',
      input: '{{ticket.text}}',
      description: 'LLM sentiment of the ticket' },

    { id: 'ai.reply', kind: 'ai', ai_kind: 'ai.llm', provider: 'zai', model: 'default',
      system: 'You are a senior support engineer. Write a 2-sentence, empathetic reply.',
      prompt: 'Ticket: {{ticket.text}}\nSentiment: {{ai.sentiment}}\nUrgency: {{ai.urgency}}',
      description: 'LLM-drafted customer reply' },

    // -- pure policy --
    { id: 'policy.escalate', kind: 'formula', expr: 'ai.urgency >= 8',
      description: 'escalate when the model scores >= 8' },

    // -- orchestration: the effectful workflow cell --
    { id: 'triage.workflow', kind: 'program', deps: ['ticket.text'],
      description: 'runs the whole triage: score -> sentiment -> policy -> reply',
      code: `
        const text = (await runtime.get('ticket.text')).data;
        const urgency = await runtime.call('ai.urgency');
        const sentiment = await runtime.call('ai.sentiment');
        const escalate = urgency.data >= 8;
        let reply = null;
        if (escalate) reply = (await runtime.call('ai.reply')).data;
        return {
          urgency: urgency.data,
          sentiment: sentiment.data,
          escalated: escalate,
          reply,
        };
      ` },
  ],
});

// ── drive three tickets through the thinking sheet ──
const tickets = [
  'Hi, I noticed a small typo on your pricing page. No rush at all, just a heads up!',
  'Our production cluster is DOWN and we are losing customers RIGHT NOW. This is critical!',
  'I have asked three times about my refund and nobody answers. I am beyond frustrated.',
];

for (const [i, text] of tickets.entries()) {
  const before = ai.calls;
  await engine.set('ticket.text', text);           // invalidates dependent AI caches
  const out = (await engine.call('triage.workflow')).data;
  console.log(`\n━━━ ticket ${i + 1} ━━━`);
  console.log('  text      :', text.slice(0, 70) + (text.length > 70 ? '…' : ''));
  console.log('  urgency   :', out.urgency, '/10   (LLM calls used:', ai.calls - before, ')');
  console.log('  sentiment :', JSON.stringify(out.sentiment));
  console.log('  escalated :', out.escalated ? 'YES → drafted reply:' : 'no');
  if (out.reply) console.log('  reply     :', out.reply);
}

console.log('\n══ total real LLM calls:', ai.calls, '(escalation gate kept the cheap ticket reply-free) ══');
