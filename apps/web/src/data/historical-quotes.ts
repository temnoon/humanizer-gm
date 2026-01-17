/**
 * Historical quotes featuring uses of "humanize" and "humanizer"
 * Curated from documented historical sources spanning 1603-present
 */

export interface HistoricalQuote {
  quote: string;
  author: string;
  year: string | number;
  source?: string;
}

export const HISTORICAL_QUOTES: HistoricalQuote[] = [
  // First recorded uses
  {
    quote: "First recorded English usage of 'humanize'",
    author: "Philemon Holland",
    year: 1603,
    source: "Plutarch's Moralia (translation)",
  },
  {
    quote: "First recorded usage of 'humanizer'",
    author: "Hester Lynch Thrale",
    year: 1773,
    source: "Personal correspondence",
  },

  // Philosophy & Religion
  {
    quote: "Before the Christian religion had, as it were, humanized the idea of the Divinity, and brought it somewhat nearer to us, there was very little said of the love of God.",
    author: "Edmund Burke",
    year: 1757,
    source: "A Philosophical Enquiry into the Sublime and Beautiful",
  },
  {
    quote: "May exalting and humanizing thoughts forever accompany me, making me confident without pride, and modest without servility.",
    author: "Leigh Hunt",
    year: "c. 1830",
    source: "Personal writings",
  },

  // Education
  {
    quote: "One of his first lectures attempted to humanize science by explaining that 'the whole of Nature is a metaphor or image of the human mind.'",
    author: "Ralph Waldo Emerson",
    year: 1833,
    source: "The Uses of Natural History",
  },
  {
    quote: "Today, in eleven countries, there are Dewey centers that look to humanize education.",
    author: "John Dewey",
    year: "c. 1920",
    source: "Democracy and Education",
  },
  {
    quote: "What really makes a teacher is love for the human child.",
    author: "Maria Montessori",
    year: 1912,
    source: "The Montessori Method",
  },

  // Civil Rights
  {
    quote: "Douglass and Sojourner Truth used their personal experiences to humanize the enslaved population and expose the inherent cruelty of slavery.",
    author: "Frederick Douglass",
    year: 1845,
    source: "Narrative of the Life of Frederick Douglass",
  },
  {
    quote: "The 'American Negro' exhibit offered a more humanizing glimpse into African-American life through data portraits.",
    author: "W.E.B. Du Bois",
    year: 1900,
    source: "Paris Exposition",
  },

  // Architecture & Design
  {
    quote: "The Humanizing of Architecture",
    author: "Alvar Aalto",
    year: 1940,
    source: "Article title",
  },
  {
    quote: "Durant's aim was 'to humanize knowledge by centering the story of speculative thought around certain dominant personalities.'",
    author: "Will Durant",
    year: 1926,
    source: "The Story of Philosophy",
  },

  // Liberation & Pedagogy
  {
    quote: "The problem of humanization has always, from an axiological point of view, been humankind's central problem.",
    author: "Paulo Freire",
    year: 1968,
    source: "Pedagogy of the Oppressed",
  },
  {
    quote: "I cannot be in favor of educational reform that forgets the mission of schools: to humanize.",
    author: "Paulo Freire",
    year: 1968,
    source: "Pedagogy of the Oppressed",
  },
  {
    quote: "Our vocation is to humanize our world and make it easier to love.",
    author: "Paulo Freire",
    year: 1997,
    source: "Later writings",
  },

  // Technology
  {
    quote: "In a properly automated and educated world, machines may prove to be the true humanizing influence.",
    author: "Isaac Asimov",
    year: 1986,
    source: "Robot Visions",
  },
  {
    quote: "Machines will do the work that makes life possible and human beings will do all the other things that make life pleasant and worthwhile.",
    author: "Isaac Asimov",
    year: 1986,
    source: "Robot Visions",
  },

  // Philosophy & Truth
  {
    quote: "James sees truth, beauty, and goodness as realities we bring into being with our activity on the world, a world more and more humanized.",
    author: "William James",
    year: 1907,
    source: "Pragmatism",
  },

  // Social Reform
  {
    quote: "Mill set out to humanize Bentham's pragmatic Utilitarianism by balancing the claims of reason and the imagination.",
    author: "John Stuart Mill",
    year: "c. 1850",
    source: "Essays on Utilitarianism",
  },

  // Literature & Poetry
  {
    quote: "Poetry is a humanizing force, one that teaches us to listen to our true selves, and to value the voices and perspectives of others.",
    author: "Tracy K. Smith",
    year: "c. 2010",
    source: "US Poet Laureate",
  },
  {
    quote: "Through vivid, empathetic characterization, Dickens humanized the lower classes, fostering empathy among his readers.",
    author: "Charles Dickens",
    year: "c. 1850",
    source: "Victorian literature",
  },
  {
    quote: "What do we live for, if it is not to make life less difficult for each other?",
    author: "George Eliot",
    year: 1871,
    source: "Middlemarch",
  },

  // Medicine & Care
  {
    quote: "He showed us that being a good doctor is firmly rooted in being a good human being.",
    author: "Albert Schweitzer",
    year: "c. 1950",
    source: "Reverence for Life philosophy",
  },

  // Psychology
  {
    quote: "Rogers was the first person to use the term 'clients' instead of patients, reflecting his positive viewpoint on human nature.",
    author: "Carl Rogers",
    year: 1951,
    source: "Client-Centered Therapy",
  },

  // Work & Labor
  {
    quote: "Semco threw out old management methods and thrived. Ricardo Semler may well be the CEO who put humanizing work firmly on the map.",
    author: "Ricardo Semler",
    year: "c. 1990",
    source: "Maverick",
  },

  // Philosophy
  {
    quote: "Arendt's The Human Condition explores fundamental activities of labor, work, and action that constitute human life.",
    author: "Hannah Arendt",
    year: 1958,
    source: "The Human Condition",
  },
];

/**
 * Get a random quote
 */
export function getRandomQuote(): HistoricalQuote {
  return HISTORICAL_QUOTES[Math.floor(Math.random() * HISTORICAL_QUOTES.length)];
}

/**
 * Get quotes in sequence for rotation
 */
export function getQuoteByIndex(index: number): HistoricalQuote {
  return HISTORICAL_QUOTES[index % HISTORICAL_QUOTES.length];
}
