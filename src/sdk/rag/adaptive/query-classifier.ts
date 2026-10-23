/**
 * Query Classifier
 *
 * Heuristic-based query classification for adaptive RAG.
 * Classifies queries into SIMPLE, FACTUAL, COMPLEX, or CONVERSATIONAL
 * without any LLM calls using pattern matching and word lists.
 *
 * @example
 * ```typescript
 * const classifier = new QueryClassifier();
 *
 * classifier.classify('Hello!');
 * // { type: 'simple', confidence: 0.95, recommendation: { skipRetrieval: true } }
 *
 * classifier.classify('Compare TypeScript and JavaScript');
 * // { type: 'complex', confidence: 0.85, recommendation: { enableEnhancement: true } }
 * ```
 */

import type {
  QueryType,
  QueryFeatures,
  ClassificationResult,
  PipelineRecommendation,
  ClassificationThresholds,
  QueryClassifierConfig,
  IQueryClassifier,
} from './types.js';

// ============================================================================
// Default Word Lists
// ============================================================================

/**
 * Default greeting patterns (lowercase).
 * Matches: "hello", "hi there", "hey", "thanks", etc.
 */
const DEFAULT_GREETINGS = new Set([
  'hello',
  'hi',
  'hey',
  'greetings',
  'howdy',
  'yo',
  'sup',
  "what's up",
  'whats up',
  'good morning',
  'good afternoon',
  'good evening',
  'good night',
  'thanks',
  'thank you',
  'thx',
  'ty',
  'bye',
  'goodbye',
  'see you',
  'later',
  'cheers',
  'ok',
  'okay',
  'sure',
  'yes',
  'no',
  'yep',
  'nope',
  'cool',
  'nice',
  'great',
  'awesome',
  'perfect',
]);

/**
 * Question words that indicate FACTUAL queries.
 */
const QUESTION_WORDS = new Set([
  'what',
  'who',
  'when',
  'where',
  'which',
  'how',
  'why',
  'is',
  'are',
  'was',
  'were',
  'do',
  'does',
  'did',
  'can',
  'could',
  'would',
  'should',
  'will',
  'have',
  'has',
]);

/**
 * Keywords indicating COMPLEX queries (analytical, comparative).
 */
const DEFAULT_COMPLEX_KEYWORDS = new Set([
  'compare',
  'comparison',
  'versus',
  'vs',
  'difference',
  'differences',
  'between',
  'analyze',
  'analysis',
  'evaluate',
  'evaluation',
  'explain',
  'explain why',
  'why does',
  'why is',
  'how does',
  'how do',
  'pros and cons',
  'advantages',
  'disadvantages',
  'benefits',
  'drawbacks',
  'trade-offs',
  'tradeoffs',
  'best practice',
  'best practices',
  'recommend',
  'recommendation',
  'should i',
  'which is better',
  'better than',
  'worse than',
  'contrast',
  'distinguish',
  'elaborate',
  'detail',
  'in-depth',
  'comprehensive',
  'thoroughly',
  'step by step',
  'step-by-step',
  'multiple',
  'several',
  'various',
  'all the',
  'list all',
  'summarize',
  'overview',
]);

/**
 * Pronouns that suggest CONVERSATIONAL context is needed.
 * NOTE: "this", "that", "these", "those" are only conversational when
 * used as pronouns, not as demonstrative adjectives (e.g., "this function").
 * We handle this in isPronounSignificant().
 */
const CONTEXT_PRONOUNS = new Set([
  'it',
  'its',
  "it's",
  'they',
  'them',
  'their',
  'he',
  'she',
  'him',
  'her',
  'his',
  'hers',
  'one',
  'ones',
  'the same',
  'above',
  'mentioned',
  'previous',
  'earlier',
  'last',
  'former',
  'latter',
]);

/**
 * Demonstrative words that are only conversational when used as pronouns
 * (not when followed by a noun).
 */
const DEMONSTRATIVE_WORDS = new Set(['this', 'that', 'these', 'those']);

/**
 * Follow-up patterns indicating continuation.
 */
const FOLLOWUP_PATTERNS = [
  /^and\s+(also|what|how|why)/i,
  /^also\s/i,
  /^what\s+about\s/i,
  /^how\s+about\s/i,
  /^tell\s+me\s+more/i,
  /^more\s+about\s/i,
  /^can\s+you\s+(also|elaborate)/i,
  /^what\s+else\s/i,
  /^anything\s+else\s/i,
  /^continue\s/i,
  /^go\s+on\s/i,
];

// ============================================================================
// Default Thresholds
// ============================================================================

const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  simpleMaxWords: 4,
  complexMinWords: 15,
  complexKeywordThreshold: 1,
  conversationalPronounThreshold: 1,
};

// ============================================================================
// QueryClassifier Implementation
// ============================================================================

/**
 * Heuristic-based query classifier.
 *
 * Analyzes query text using pattern matching, word counts,
 * and keyword detection to classify into one of four types.
 * No LLM calls are made - classification is instant.
 */
export class QueryClassifier implements IQueryClassifier {
  readonly name: string;

  private readonly thresholds: ClassificationThresholds;
  private readonly greetings: Set<string>;
  private readonly complexKeywords: Set<string>;

  constructor(config: QueryClassifierConfig = {}) {
    this.name = config.name ?? 'QueryClassifier';

    // Merge thresholds with defaults
    this.thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...config.thresholds,
    };

    // Build greeting set with custom additions
    this.greetings = new Set([
      ...DEFAULT_GREETINGS,
      ...(config.additionalGreetings ?? []).map((g) => g.toLowerCase()),
    ]);

    // Build complex keywords set with custom additions
    this.complexKeywords = new Set([
      ...DEFAULT_COMPLEX_KEYWORDS,
      ...(config.additionalComplexKeywords ?? []).map((k) => k.toLowerCase()),
    ]);
  }

  /**
   * Classify a query into a type.
   */
  classify = (query: string): ClassificationResult => {
    const features = this.extractFeatures(query);
    const { type, confidence } = this.determineType(features, query);
    const recommendation = this.generateRecommendation(type, features);

    return {
      type,
      confidence,
      features,
      recommendation,
    };
  };

  /**
   * Extract features from a query without classifying.
   */
  extractFeatures = (query: string): QueryFeatures => {
    const normalized = query.trim().toLowerCase();
    const words = this.tokenize(query);
    const lowerWords = words.map((w) => w.toLowerCase());

    // Question words detection (lowercase for matching)
    const questionWords = lowerWords.filter((w) => QUESTION_WORDS.has(w));

    // Pronoun detection (includes demonstratives used as pronouns)
    const pronouns = this.findPronouns(lowerWords);

    // Complex keyword detection (check both single words and phrases)
    const complexKeywords = this.findComplexKeywords(normalized);

    // Greeting detection
    const isGreeting = this.isGreetingQuery(normalized, words);

    // Follow-up pattern detection
    const hasFollowUpPattern = FOLLOWUP_PATTERNS.some((pattern) => pattern.test(normalized));

    // Potential entity detection (capitalized words not at start)
    const potentialEntityCount = this.countPotentialEntities(query);

    return {
      wordCount: words.length,
      charCount: query.trim().length,
      hasQuestionWords: questionWords.length > 0,
      questionWords,
      isGreeting,
      hasPronouns: pronouns.length > 0,
      pronouns,
      hasComplexKeywords: complexKeywords.length > 0,
      complexKeywords,
      hasFollowUpPattern,
      endsWithQuestion: query.trim().endsWith('?'),
      potentialEntityCount,
    };
  };

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Tokenize query into words, preserving case but keeping punctuation.
   */
  private tokenize(query: string): string[] {
    return query
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
  }

  /**
   * Strip punctuation from a word for comparison purposes.
   */
  private stripPunctuation(word: string): string {
    return word.replace(/[.,!?;:'"()[\]{}]/g, '');
  }

  /**
   * Find pronouns in the query, handling demonstratives correctly.
   *
   * Demonstratives (this, that, these, those) are only counted as pronouns
   * when used alone, not as adjectives modifying nouns.
   * E.g., "What about this?" → pronoun
   * E.g., "Is this function pure?" → adjective (not counted)
   */
  private findPronouns(lowerWords: string[]): string[] {
    const pronouns: string[] = [];
    // Strip punctuation for matching
    const cleanWords = lowerWords.map((w) => this.stripPunctuation(w));

    for (let i = 0; i < cleanWords.length; i++) {
      const word = cleanWords[i];
      if (!word) continue; // Skip empty after stripping punctuation

      // Regular pronouns always count
      if (CONTEXT_PRONOUNS.has(word)) {
        pronouns.push(word);
        continue;
      }

      // Demonstratives only count if used as pronouns (not followed by a noun)
      if (DEMONSTRATIVE_WORDS.has(word)) {
        const nextWord = cleanWords[i + 1];

        // If at end of sentence or followed by nothing, it's a pronoun
        if (!nextWord) {
          pronouns.push(word);
          continue;
        }

        // If followed by a verb or question word, it's a pronoun
        // E.g., "What about this?" (end), "What is this?" (end), "this is" (verb follows)
        if (QUESTION_WORDS.has(nextWord) || ['is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'would', 'should', 'will', 'have', 'has'].includes(nextWord)) {
          // Check if the demonstrative is the subject
          // "this is good" → "this" is pronoun
          // "is this good" → "this" is pronoun (question)
          pronouns.push(word);
          continue;
        }

        // If followed by a common noun/adjective, it's an adjective
        // E.g., "this function", "this implementation", "these tests"
        // We skip it in this case
      }
    }

    return pronouns;
  }

  /**
   * Check if query matches greeting patterns.
   */
  private isGreetingQuery(normalized: string, words: string[]): boolean {
    // Exact match for short queries
    if (this.greetings.has(normalized)) {
      return true;
    }

    // Check if all words are greetings (e.g., "hi there" => "hi" + "there")
    if (words.length <= 3) {
      const greetingWords = words.filter(
        (w) => this.greetings.has(w.toLowerCase()) || w.toLowerCase() === 'there'
      );
      if (greetingWords.length === words.length) {
        return true;
      }
    }

    // Check for greeting at start
    const firstWord = words[0]?.toLowerCase();
    if (firstWord && this.greetings.has(firstWord) && words.length <= this.thresholds.simpleMaxWords) {
      return true;
    }

    return false;
  }

  /**
   * Find complex keywords in the query.
   * Checks both individual words and multi-word phrases.
   */
  private findComplexKeywords(normalizedQuery: string): string[] {
    const found: string[] = [];

    // Check each complex keyword (some are phrases)
    for (const keyword of this.complexKeywords) {
      if (normalizedQuery.includes(keyword)) {
        found.push(keyword);
      }
    }

    return found;
  }

  /**
   * Count potential entity references (capitalized words not at sentence start).
   */
  private countPotentialEntities(query: string): number {
    const words = this.tokenize(query);
    let count = 0;

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      if (!word || word.length <= 1) continue;

      const firstChar = word[0];
      // Check if word starts with uppercase (potential entity)
      if (firstChar && firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()) {
        // Exclude common words that might be capitalized
        const lower = word.toLowerCase();
        if (!QUESTION_WORDS.has(lower) && !this.greetings.has(lower)) {
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Determine query type based on features.
   */
  private determineType(features: QueryFeatures, query: string): { type: QueryType; confidence: number } {
    // Priority 1: SIMPLE (greetings, very short)
    if (features.isGreeting) {
      return { type: 'simple', confidence: 0.95 };
    }

    if (
      features.wordCount <= this.thresholds.simpleMaxWords &&
      !features.hasQuestionWords &&
      !features.hasComplexKeywords
    ) {
      // Very short non-question queries
      return { type: 'simple', confidence: 0.8 };
    }

    // Priority 2: CONVERSATIONAL (pronouns + follow-up patterns)
    if (
      features.hasFollowUpPattern ||
      (features.pronouns.length >= this.thresholds.conversationalPronounThreshold &&
        this.isPronounSignificant(query, features))
    ) {
      const confidence = features.hasFollowUpPattern ? 0.9 : 0.75;
      return { type: 'conversational', confidence };
    }

    // Priority 3: COMPLEX (analytical, comparative, long)
    if (
      features.complexKeywords.length >= this.thresholds.complexKeywordThreshold ||
      features.wordCount >= this.thresholds.complexMinWords
    ) {
      // Higher confidence if both length and keywords
      const confidence =
        features.hasComplexKeywords && features.wordCount >= this.thresholds.complexMinWords ? 0.9 : 0.75;
      return { type: 'complex', confidence };
    }

    // Priority 4: Default to FACTUAL
    // Most standard questions fall here
    const confidence = features.hasQuestionWords || features.endsWithQuestion ? 0.85 : 0.7;
    return { type: 'factual', confidence };
  }

  /**
   * Check if pronouns are significant (not just incidental usage).
   *
   * E.g., "What is it?" has significant pronoun use
   * vs "Is it possible to reset?" where "it" is incidental
   */
  private isPronounSignificant(query: string, features: QueryFeatures): boolean {
    const normalized = query.toLowerCase();

    // Check for pronouns at start or as main subject
    if (
      /^(it|that|this|these|those|they)\s+(is|are|was|were|do|does|did|can|could|would|should)/i.test(
        normalized
      )
    ) {
      return true;
    }

    // Check for "about it/that/this" patterns
    if (/about\s+(it|that|this|these|those|them)/i.test(normalized)) {
      return true;
    }

    // High pronoun density suggests conversational context
    const pronounRatio = features.pronouns.length / features.wordCount;
    return pronounRatio > 0.15;
  }

  /**
   * Generate pipeline recommendation based on query type.
   */
  private generateRecommendation(type: QueryType, features: QueryFeatures): PipelineRecommendation {
    switch (type) {
      case 'simple':
        return {
          skipRetrieval: true,
          enableEnhancement: false,
          enableReranking: false,
          suggestedTopK: 0,
          needsConversationContext: false,
        };

      case 'factual':
        return {
          skipRetrieval: false,
          enableEnhancement: false, // Standard queries don't need enhancement
          enableReranking: true,
          suggestedTopK: 5,
          needsConversationContext: false,
        };

      case 'complex':
        return {
          skipRetrieval: false,
          enableEnhancement: true,
          suggestedStrategy: features.wordCount > 20 ? 'multi-query' : 'rewrite',
          enableReranking: true,
          suggestedTopK: 10,
          needsConversationContext: false,
        };

      case 'conversational':
        return {
          skipRetrieval: false,
          enableEnhancement: false, // Enhancement after context resolution
          enableReranking: true,
          suggestedTopK: 5,
          needsConversationContext: true,
        };
    }
  }
}
