const TERRITORIES = {
  reduction: {
    name: 'Essential Reduction',
    thesis: 'Remove everything until only one ownable visual idea remains.',
    direction: 'radically simple geometric symbol, one continuous visual idea, precise negative space, Swiss restraint'
  },
  tension: {
    name: 'Constructive Tension',
    thesis: 'Create memorability through one controlled contradiction.',
    direction: 'bold asymmetric symbol, unexpected cut or counterform, balanced visual tension, unmistakable silhouette'
  },
  signature: {
    name: 'Human Signature',
    thesis: 'Turn a human gesture into a disciplined proprietary mark.',
    direction: 'confident custom-drawn gesture, refined organic geometry, warm but authoritative, never illustrative'
  }
};

export function createTerritories(brief) {
  const entries = Object.entries(TERRITORIES);
  return entries.map(([id, territory], index) => ({
    id,
    ...territory,
    seed: (brief.seed || 4107) + index * 997,
    prompt: buildPrompt(brief, territory, index)
  }));
}

export function buildPrompt(brief, territory, variant = 0) {
  const name = clean(brief.name, 'the brand');
  const category = clean(brief.category, 'modern company');
  const audience = clean(brief.audience, 'discerning global customers');
  const personality = clean(brief.personality, 'confident, intelligent, distinctive');
  const story = clean(brief.story, 'clarity and forward motion');
  const colors = clean(brief.colors, 'black and warm white');
  const avoid = clean(brief.avoid, 'generic swooshes, globes, shields, gradients, mockups, stock iconography');

  return [
    `Design a world-class identity symbol for \"${name}\", a ${category}.`,
    `Creative territory: ${territory.name}. ${territory.thesis}`,
    `Core idea: translate \"${story}\" into a single ownable visual metaphor.`,
    `Audience: ${audience}. Brand character: ${personality}.`,
    `Art direction: ${territory.direction}. Palette: ${colors}.`,
    `Variant ${variant + 1}: explore a fresh construction, not a cosmetic variation.`,
    'Show one isolated flat logo mark, centered on a plain warm-white background. Vector-like hard edges, immaculate spacing, strong figure-ground relationship, iconic silhouette, no texture, no lighting, no shadows, no 3D, no presentation mockup.',
    `Do not include letters, words, captions, watermarks, borders, or multiple options. Avoid: ${avoid}.`,
    'The result must remain recognizable at 16 pixels and work in solid one-color black.'
  ].join(' ');
}

export function negativePrompt(brief = {}) {
  return `text, letters, words, typography, watermark, signature, mockup, stationery, wall, paper texture, photo, 3d render, bevel, shadow, glow, gradient, clipart, stock logo, crowded, ornate, thin details, multiple logos, border, ${clean(brief.avoid, '')}`;
}

export function scoreConcept(concept = {}) {
  const scores = concept.scores || {};
  const weights = { distinction: .22, simplicity: .18, relevance: .16, memorability: .16, scalability: .12, balance: .09, longevity: .07 };
  const total = Object.entries(weights).reduce((sum, [key, weight]) => sum + clamp(scores[key]) * weight, 0);
  return Math.round(total * 10) / 10;
}

function clamp(value) {
  const number = Number(value) || 0;
  return Math.max(0, Math.min(10, number));
}

function clean(value, fallback) {
  return String(value || fallback).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}
