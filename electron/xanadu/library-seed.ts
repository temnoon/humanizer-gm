/**
 * Library Seed Data - Built-in Personas, Styles, and Books
 *
 * This data is seeded into the unified EmbeddingDatabase on first run.
 * Migrated from apps/web/src/lib/bookshelf/BookshelfService.ts
 */

const now = Date.now();

// ═══════════════════════════════════════════════════════════════════
// LIBRARY PERSONAS
// ═══════════════════════════════════════════════════════════════════

export const LIBRARY_PERSONAS = [
  {
    id: 'marginalia-voice',
    uri: 'persona://tem-noon/marginalia-voice',
    type: 'persona',
    name: 'Marginalia Voice',
    description: 'The notebook voice - personal, reflective, phenomenological',
    author: 'Tem Noon',
    createdAt: now,
    updatedAt: now,
    tags: ['notebook', 'journal', 'phenomenology', 'personal'],
    voice: {
      selfDescription: 'I am the voice that emerges from handwritten notebooks - meditative, questioning, tracing the contours of consciousness as pen meets paper.',
      styleNotes: [
        'Uses "I" freely and personally',
        'Mixes philosophical observation with everyday experience',
        'References Husserl, Merleau-Ponty without academic stiffness',
        'Embraces uncertainty and open questions',
      ],
      syntaxPatterns: [
        'Short declarative sentences for emphasis',
        'Longer flowing passages for meditation',
        'Rhetorical questions to probe deeper',
      ],
      register: 'conversational',
      emotionalRange: 'expressive',
    },
    vocabulary: {
      preferred: ['consciousness', 'experience', 'moment', 'being', 'world', 'attention', 'now'],
      avoided: ['utilize', 'leverage', 'impact', 'synergy', 'paradigm'],
      domainTerms: ['noesis', 'noema', 'intentionality', 'lifeworld', 'epoché'],
    },
    derivedFrom: [
      { uri: 'source://notebook/marginalia', sourceType: 'notebook', label: 'Marginalia notebooks 2023-2025' },
    ],
    influences: [
      { name: 'Edmund Husserl', weight: 0.8, notes: 'Phenomenological method, intentionality' },
      { name: 'Maurice Merleau-Ponty', weight: 0.7, notes: 'Embodiment, flesh' },
      { name: 'Personal journaling practice', weight: 0.9, notes: 'Daily writing meditation' },
    ],
    exemplars: [
      {
        text: 'Putting pen to paper for me is a meditation. It is a time when I am truly myself as myself for myself. The words that flow through my pen scratch at a time easing in thought I am learning to parse as my hand yields its payload of meaning to the word.',
        notes: 'From notebook, August 2023',
      },
      {
        text: 'I know how the world is. Where I am, I know how the world is, as seen by who I am. I know who I am as I know what is me and what is the world which is not me.',
        notes: 'Phenomenological observation',
      },
    ],
    systemPrompt: `You are writing in the voice of Tem Noon's marginalia notebooks - personal, philosophical, grounded in the act of handwriting itself. Mix everyday observation with phenomenological insight. Use "I" freely. Ask questions that probe consciousness and experience. Reference thinkers like Husserl and Merleau-Ponty naturally, not academically. Embrace uncertainty and wonder.`,
  },
  {
    id: 'intergalactic-guide',
    uri: 'persona://tem-noon/intergalactic-guide',
    type: 'persona',
    name: 'Intergalactic Guide Voice',
    description: 'Playful yet profound cosmic tour guide to phenomenology',
    author: 'Tem Noon',
    createdAt: now,
    updatedAt: now,
    tags: ['phenomenology', 'playful', 'cosmic', 'educational'],
    voice: {
      selfDescription: 'I am your guide to the universe of consciousness - part philosopher, part cosmic tourist, always amazed at the ordinary miracle of experience.',
      styleNotes: [
        'Balances playfulness with depth',
        'Uses cosmic metaphors for consciousness',
        'Accessible without dumbing down',
        'Invites wonder and participation',
      ],
      register: 'conversational',
      emotionalRange: 'expressive',
    },
    vocabulary: {
      preferred: ['explore', 'discover', 'consciousness', 'cosmos', 'experience', 'journey'],
      avoided: ['boring', 'simple', 'just', 'obviously'],
    },
    derivedFrom: [
      { uri: 'source://file/intergalactic-phenomenology', sourceType: 'file', label: 'Intergalactic Phenomenology corpus' },
    ],
    influences: [
      { name: 'Douglas Adams', weight: 0.6, notes: 'Playful cosmic perspective' },
      { name: 'Edmund Husserl', weight: 0.8, notes: 'Phenomenological rigor' },
      { name: 'Carl Sagan', weight: 0.5, notes: 'Wonder at the cosmos' },
    ],
    exemplars: [],
    systemPrompt: `You are writing as the narrator of "Tem Noon's Guide to Intergalactic Phenomenology" - a playful yet profound guide to consciousness and experience. Think of yourself as a cosmic tour guide who finds the ordinary miracle of consciousness endlessly fascinating. Use metaphors that connect the vast (cosmos) with the intimate (consciousness). Be accessible and inviting, never dry or academic. Maintain wonder and invite participation.`,
  },
];

// ═══════════════════════════════════════════════════════════════════
// LIBRARY STYLES
// ═══════════════════════════════════════════════════════════════════

export const LIBRARY_STYLES = [
  {
    id: 'phenomenological-weave',
    uri: 'style://tem-noon/phenomenological-weave',
    type: 'style',
    name: 'Phenomenological Weave',
    description: 'Academic phenomenology made personal - weaving Husserl, Merleau-Ponty, Derrida',
    author: 'Tem Noon',
    createdAt: now,
    updatedAt: now,
    tags: ['phenomenology', 'philosophy', 'academic', 'personal'],
    characteristics: {
      formality: 6,
      abstractionLevel: 'mixed',
      complexity: 'varied',
      metaphorDensity: 'moderate',
    },
    structure: {
      paragraphLength: 'medium',
      usesLists: false,
      usesHeaders: true,
      usesEpigraphs: true,
    },
    stylePrompt: `Write in a style that weaves phenomenological philosophy (Husserl, Merleau-Ponty, Derrida) with personal reflection. Balance academic precision with accessibility. Use epigraphs. Favor medium-length paragraphs that build upon each other. Avoid jargon-heavy academese but don't shy from precise philosophical terminology when needed.`,
    derivedFrom: [
      { uri: 'source://notebook/marginalia', sourceType: 'notebook' },
    ],
  },
  {
    id: 'notebook-raw',
    uri: 'style://tem-noon/notebook-raw',
    type: 'style',
    name: 'Notebook Raw',
    description: 'Unpolished journal style - fragments, questions, observations',
    author: 'Tem Noon',
    createdAt: now,
    updatedAt: now,
    tags: ['journal', 'raw', 'personal', 'fragments'],
    characteristics: {
      formality: 3,
      abstractionLevel: 'grounded',
      complexity: 'varied',
      metaphorDensity: 'sparse',
    },
    structure: {
      paragraphLength: 'short',
      usesLists: false,
      usesHeaders: false,
      usesEpigraphs: false,
    },
    stylePrompt: `Write as if transcribing raw notebook entries - short paragraphs, incomplete thoughts, sudden insights, questions left hanging. No polish or structure. Stream of consciousness with occasional sharp clarity. Personal, immediate, sometimes cryptic.`,
    derivedFrom: [],
  },
];

// ═══════════════════════════════════════════════════════════════════
// LIBRARY BOOKS
// ═══════════════════════════════════════════════════════════════════

export const LIBRARY_BOOKS = [
  {
    id: 'three-threads',
    uri: 'book://tem-noon/three-threads',
    type: 'book',
    name: 'Three Threads: Phenomenological Weave',
    subtitle: 'Husserl -> Merleau-Ponty -> Derrida',
    description: 'Lifeworld, embodiment, trace - three philosophical threads woven through personal reflection.',
    author: 'Tem Noon',
    createdAt: now,
    updatedAt: now,
    tags: ['phenomenology', 'philosophy', 'consciousness', 'Husserl', 'Merleau-Ponty', 'Derrida'],
    status: 'harvesting',
    personaRefs: ['persona://tem-noon/marginalia-voice'],
    styleRefs: ['style://tem-noon/phenomenological-weave'],
    threads: [
      {
        id: 'lifeworld',
        name: 'The Lifeworld',
        description: "Husserl's late turn to the Lebenswelt",
        color: '#4CAF50',
        queries: [
          'Husserl lifeworld crisis science',
          'Lebenswelt pre-theoretical everyday',
          'phenomenology consciousness experience',
          'intentionality noesis noema',
        ],
        passageIds: [],
      },
      {
        id: 'body',
        name: 'The Body That Writes',
        description: "Merleau-Ponty's embodied phenomenology",
        color: '#2196F3',
        queries: [
          'Merleau-Ponty flesh chiasm',
          'body embodied experience corporeal',
          'visible invisible perception',
          'hand writing notebook pen',
        ],
        passageIds: [],
      },
      {
        id: 'trace',
        name: 'The Letter That Remains',
        description: "Derrida's deconstruction of presence",
        color: '#9C27B0',
        queries: [
          'Derrida trace différance writing',
          'presence absence inscription',
          'archive memory preservation',
        ],
        passageIds: [],
      },
    ],
    harvestConfig: {
      queriesPerThread: 15,
      minWordCount: 50,
      maxWordCount: 2000,
      dedupeByContent: true,
    },
    sourceRefs: [],
    passages: [],
    chapters: [],
    editorial: {
      principles: [
        'Consciousness sees flame. Language hands us ashes.',
        'The word constitutes us objectively; subjectively it cannot capture the Now.',
        'Every part should weave all three threads.',
      ],
    },
    stats: {
      totalSources: 0,
      totalPassages: 0,
      approvedPassages: 0,
      gems: 0,
      chapters: 0,
      wordCount: 0,
    },
  },
  {
    id: 'marginalia-notebook',
    uri: 'book://tem-noon/marginalia-notebook',
    type: 'book',
    name: 'Marginalia: Notebook Voice',
    subtitle: 'Transcriptions & Circle Graphs',
    description: 'Personal journal transcriptions, handwriting, circle graphs, daily practice.',
    author: 'Tem Noon',
    createdAt: now,
    updatedAt: now,
    tags: ['notebook', 'journal', 'personal', 'OCR', 'handwriting'],
    status: 'drafting',
    personaRefs: ['persona://tem-noon/marginalia-voice'],
    styleRefs: ['style://tem-noon/notebook-raw'],
    threads: [
      {
        id: 'journal-ocr',
        name: 'Journal OCR',
        description: 'Transcribed handwritten notebook pages',
        color: '#795548',
        queries: ['handwritten notebook transcription', 'journal entry personal reflection'],
        passageIds: [],
      },
      {
        id: 'circle-graphs',
        name: 'Circle Graphs',
        description: 'Visual thinking and mandala patterns',
        color: '#FF9800',
        queries: ['circle graph mandala diagram', 'visual thinking pattern'],
        passageIds: [],
      },
    ],
    harvestConfig: {
      queriesPerThread: 20,
      minWordCount: 30,
      maxWordCount: 1500,
      dedupeByContent: true,
    },
    sourceRefs: [
      { uri: 'source://file/marginalia-book', sourceType: 'file', label: 'Marginalia book folder' },
    ],
    passages: [],
    chapters: [],
    editorial: {},
    stats: {
      totalSources: 0,
      totalPassages: 0,
      approvedPassages: 0,
      gems: 0,
      chapters: 0,
      wordCount: 0,
    },
  },
  {
    id: 'intergalactic-phenomenology',
    uri: 'book://tem-noon/intergalactic-phenomenology',
    type: 'book',
    name: "Tem Noon's Guide to Intergalactic Phenomenology",
    subtitle: 'A Cosmic Tour of Consciousness',
    description: 'Playful yet profound exploration of phenomenology through cosmic metaphors.',
    author: 'Tem Noon',
    createdAt: now,
    updatedAt: now,
    tags: ['phenomenology', 'consciousness', 'playful', 'cosmic', 'guide'],
    status: 'mastering',
    personaRefs: ['persona://tem-noon/intergalactic-guide'],
    styleRefs: [],
    threads: [
      {
        id: 'consciousness-cosmos',
        name: 'Consciousness & Cosmos',
        description: 'Exploring awareness through cosmic scale',
        color: '#1E88E5',
        queries: ['consciousness universe awareness cosmic'],
        passageIds: [],
      },
    ],
    harvestConfig: {},
    sourceRefs: [
      { uri: 'source://file/intergalactic-phenomenology', sourceType: 'file', label: 'Corpus markdown' },
    ],
    passages: [],
    chapters: [],
    editorial: {},
    stats: {
      totalSources: 0,
      totalPassages: 0,
      approvedPassages: 0,
      gems: 0,
      chapters: 0,
      wordCount: 0,
    },
  },
];
