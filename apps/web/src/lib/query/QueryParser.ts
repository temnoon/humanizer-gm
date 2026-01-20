/**
 * QueryParser - TECO-inspired query language lexer and parser
 *
 * Syntax:
 *   +source:chatgpt        Include chatgpt source
 *   -source:facebook       Exclude facebook
 *   ~source:mixed          Both/spanning
 *   ?source:undefined      Neither/uncategorized
 *   &                      AND (implicit between terms)
 *   |                      OR
 *   ()                     Grouping
 *   /pattern/              Regex match
 *   @stackname             Saved stack reference
 *   "exact phrase"         Phrase match
 *   word*                  Wildcard
 *   words:>100             Comparison
 *   date:2024-01..2024-06  Range
 */

import type {
  Token,
  TokenType,
  FilterNode,
  FilterTree,
  ParseError,
  CatuskotiFilterNode,
  RegexFilterNode,
  PhraseFilterNode,
  WildcardFilterNode,
  ComparisonFilterNode,
  SavedStackRefNode,
  FilterGroupNode,
  FilterCategory,
  ComparisonOp,
  QueryParserOptions,
  SavedStack,
} from './types';

import {
  OPERATOR_TO_STATE,
  CATEGORY_PREFIXES,
  SOURCE_VALUES,
  FORMAT_VALUES,
} from './types';

// =============================================================================
// LEXER
// =============================================================================

/**
 * Tokenize a query string
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  const peek = () => input[pos] || '';
  const advance = () => input[pos++];
  const isAtEnd = () => pos >= input.length;

  while (!isAtEnd()) {
    const start = pos;
    const char = peek();

    // Skip whitespace
    if (/\s/.test(char)) {
      advance();
      continue;
    }

    // Single-character tokens
    if (char === '+') {
      advance();
      tokens.push({ type: 'INCLUDE', value: '+', position: start, length: 1 });
      continue;
    }

    if (char === '-') {
      // Check if followed by identifier (exclusion) vs negative number
      if (pos + 1 < input.length && /[a-zA-Z]/.test(input[pos + 1])) {
        advance();
        tokens.push({ type: 'EXCLUDE', value: '-', position: start, length: 1 });
        continue;
      }
      // Treat as part of number if followed by digit
      if (pos + 1 < input.length && /\d/.test(input[pos + 1])) {
        // Will be handled by number parsing below
      } else {
        advance();
        tokens.push({ type: 'EXCLUDE', value: '-', position: start, length: 1 });
        continue;
      }
    }

    if (char === '~') {
      advance();
      tokens.push({ type: 'BOTH', value: '~', position: start, length: 1 });
      continue;
    }

    if (char === '?') {
      advance();
      tokens.push({ type: 'NEITHER', value: '?', position: start, length: 1 });
      continue;
    }

    if (char === '&') {
      advance();
      tokens.push({ type: 'AND', value: '&', position: start, length: 1 });
      continue;
    }

    if (char === '|') {
      advance();
      tokens.push({ type: 'OR', value: '|', position: start, length: 1 });
      continue;
    }

    if (char === '!') {
      advance();
      tokens.push({ type: 'NOT', value: '!', position: start, length: 1 });
      continue;
    }

    if (char === '(') {
      advance();
      tokens.push({ type: 'LPAREN', value: '(', position: start, length: 1 });
      continue;
    }

    if (char === ')') {
      advance();
      tokens.push({ type: 'RPAREN', value: ')', position: start, length: 1 });
      continue;
    }

    if (char === ':') {
      advance();
      tokens.push({ type: 'COLON', value: ':', position: start, length: 1 });
      continue;
    }

    if (char === '>') {
      advance();
      if (peek() === '=') {
        advance();
        tokens.push({ type: 'GREATER', value: '>=', position: start, length: 2 });
      } else {
        tokens.push({ type: 'GREATER', value: '>', position: start, length: 1 });
      }
      continue;
    }

    if (char === '<') {
      advance();
      if (peek() === '=') {
        advance();
        tokens.push({ type: 'LESS', value: '<=', position: start, length: 2 });
      } else {
        tokens.push({ type: 'LESS', value: '<', position: start, length: 1 });
      }
      continue;
    }

    if (char === '=') {
      advance();
      tokens.push({ type: 'EQUAL', value: '=', position: start, length: 1 });
      continue;
    }

    // Range operator ..
    if (char === '.' && input[pos + 1] === '.') {
      advance();
      advance();
      tokens.push({ type: 'RANGE', value: '..', position: start, length: 2 });
      continue;
    }

    // Regex /pattern/flags
    if (char === '/') {
      advance();
      let pattern = '';
      let escaped = false;
      while (!isAtEnd()) {
        const c = peek();
        if (escaped) {
          pattern += c;
          escaped = false;
          advance();
        } else if (c === '\\') {
          pattern += c;
          escaped = true;
          advance();
        } else if (c === '/') {
          advance();
          break;
        } else {
          pattern += c;
          advance();
        }
      }
      // Optional flags
      let flags = '';
      while (!isAtEnd() && /[gimsuy]/.test(peek())) {
        flags += advance();
      }
      tokens.push({
        type: 'REGEX',
        value: `/${pattern}/${flags}`,
        position: start,
        length: pos - start,
      });
      continue;
    }

    // Stack reference @name
    if (char === '@') {
      advance();
      let name = '';
      while (!isAtEnd() && /[a-zA-Z0-9_-]/.test(peek())) {
        name += advance();
      }
      tokens.push({
        type: 'STACK_REF',
        value: name,
        position: start,
        length: pos - start,
      });
      continue;
    }

    // Quoted string "phrase"
    if (char === '"') {
      advance();
      let phrase = '';
      while (!isAtEnd() && peek() !== '"') {
        if (peek() === '\\' && input[pos + 1] === '"') {
          advance();
        }
        phrase += advance();
      }
      if (peek() === '"') advance();
      tokens.push({
        type: 'QUOTED',
        value: phrase,
        position: start,
        length: pos - start,
      });
      continue;
    }

    // Number (possibly with - prefix)
    if (/[\d-]/.test(char) && (char !== '-' || /\d/.test(input[pos + 1] || ''))) {
      let num = '';
      if (char === '-') {
        num += advance();
      }
      while (!isAtEnd() && /[\d.]/.test(peek())) {
        num += advance();
      }
      // Check if it's a date (YYYY-MM-DD or YYYY-MM)
      if (/^\d{4}-\d{2}(-\d{2})?$/.test(num)) {
        tokens.push({ type: 'DATE', value: num, position: start, length: pos - start });
      } else {
        tokens.push({ type: 'NUMBER', value: num, position: start, length: pos - start });
      }
      continue;
    }

    // Identifier (may include * for wildcard)
    if (/[a-zA-Z_]/.test(char)) {
      let id = '';
      let hasWildcard = false;
      while (!isAtEnd() && /[a-zA-Z0-9_*-]/.test(peek())) {
        const c = advance();
        if (c === '*') hasWildcard = true;
        id += c;
      }
      if (hasWildcard) {
        tokens.push({ type: 'WILDCARD', value: id, position: start, length: pos - start });
      } else {
        tokens.push({ type: 'IDENTIFIER', value: id, position: start, length: pos - start });
      }
      continue;
    }

    // Unknown character - skip
    advance();
  }

  tokens.push({ type: 'EOF', value: '', position: pos, length: 0 });
  return tokens;
}

// =============================================================================
// PARSER
// =============================================================================

export class QueryParser {
  private tokens: Token[] = [];
  private current = 0;
  private errors: ParseError[] = [];
  private warnings: string[] = [];
  private options: QueryParserOptions;

  constructor(options: QueryParserOptions = {}) {
    this.options = {
      defaultCategory: 'content',
      allowRegex: true,
      strictCategories: false,
      ...options,
    };
  }

  /**
   * Parse a query string into a FilterTree
   */
  parse(query: string): FilterTree {
    this.tokens = tokenize(query);
    this.current = 0;
    this.errors = [];
    this.warnings = [];

    if (this.isAtEnd() || query.trim() === '') {
      return {
        root: null,
        originalQuery: query,
        parseErrors: [],
        parseWarnings: [],
      };
    }

    try {
      const root = this.parseExpression();
      return {
        root,
        originalQuery: query,
        parseErrors: this.errors,
        parseWarnings: this.warnings,
      };
    } catch (e) {
      const error = e as Error;
      this.errors.push({
        message: error.message,
        position: this.peek()?.position || 0,
        length: this.peek()?.length || 1,
      });
      return {
        root: null,
        originalQuery: query,
        parseErrors: this.errors,
        parseWarnings: this.warnings,
      };
    }
  }

  // Helpers
  private peek(): Token {
    return this.tokens[this.current] || { type: 'EOF', value: '', position: 0, length: 0 };
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'EOF';
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private expect(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    throw new Error(message);
  }

  // Grammar: expression -> or_expr
  private parseExpression(): FilterNode {
    return this.parseOr();
  }

  // or_expr -> and_expr (OR and_expr)*
  private parseOr(): FilterNode {
    let left = this.parseAnd();

    while (this.match('OR')) {
      const right = this.parseAnd();
      left = {
        type: 'OR',
        children: [left, right],
      } as FilterGroupNode;
    }

    return left;
  }

  // and_expr -> unary_expr (AND? unary_expr)*
  // AND is implicit between terms
  private parseAnd(): FilterNode {
    let left = this.parseUnary();

    while (!this.isAtEnd() && !this.check('OR') && !this.check('RPAREN')) {
      this.match('AND'); // Optional explicit AND
      if (this.isAtEnd() || this.check('OR') || this.check('RPAREN')) break;

      const right = this.parseUnary();
      left = {
        type: 'AND',
        children: [left, right],
      } as FilterGroupNode;
    }

    return left;
  }

  // unary_expr -> NOT? primary
  private parseUnary(): FilterNode {
    if (this.match('NOT')) {
      const operand = this.parsePrimary();
      if (operand.type === 'AND' || operand.type === 'OR') {
        (operand as FilterGroupNode).negated = true;
        return operand;
      }
      // Wrap in negated group
      return {
        type: 'AND',
        children: [operand],
        negated: true,
      } as FilterGroupNode;
    }

    return this.parsePrimary();
  }

  // primary -> group | filter
  private parsePrimary(): FilterNode {
    // Grouped expression
    if (this.match('LPAREN')) {
      const expr = this.parseExpression();
      this.expect('RPAREN', 'Expected closing parenthesis');
      return expr;
    }

    return this.parseFilter();
  }

  // filter -> catuskoti_filter | regex | phrase | wildcard | comparison | stack_ref
  private parseFilter(): FilterNode {
    // Regex
    if (this.check('REGEX')) {
      return this.parseRegex();
    }

    // Stack reference
    if (this.check('STACK_REF')) {
      return this.parseStackRef();
    }

    // Quoted phrase
    if (this.check('QUOTED')) {
      return this.parsePhrase();
    }

    // Catuskoti filter with operator prefix
    if (this.check('INCLUDE') || this.check('EXCLUDE') || this.check('BOTH') || this.check('NEITHER')) {
      return this.parseCatuskotiFilter();
    }

    // Identifier - could be category:value or bare term
    if (this.check('IDENTIFIER')) {
      return this.parseIdentifierFilter();
    }

    // Wildcard
    if (this.check('WILDCARD')) {
      return this.parseWildcard();
    }

    throw new Error(`Unexpected token: ${this.peek().type}`);
  }

  private parseRegex(): RegexFilterNode {
    const token = this.advance();
    const match = token.value.match(/^\/(.+)\/([gimsuy]*)$/);
    if (!match) {
      throw new Error('Invalid regex pattern');
    }
    return {
      type: 'REGEX',
      pattern: match[1],
      flags: match[2],
    };
  }

  private parseStackRef(): SavedStackRefNode {
    const token = this.advance();
    const stack = this.options.savedStacks?.get(token.value);

    if (!stack && this.options.strictCategories) {
      this.warnings.push(`Unknown saved stack: @${token.value}`);
    }

    return {
      type: 'STACK_REF',
      name: token.value,
      resolved: stack?.tree.root || undefined,
    };
  }

  private parsePhrase(): PhraseFilterNode {
    const token = this.advance();
    return {
      type: 'PHRASE',
      phrase: token.value,
    };
  }

  private parseWildcard(): WildcardFilterNode {
    const token = this.advance();
    return {
      type: 'WILDCARD',
      pattern: token.value,
    };
  }

  private parseCatuskotiFilter(): CatuskotiFilterNode {
    const opToken = this.advance();
    const state = OPERATOR_TO_STATE[opToken.value] || 'is';

    // Expect category:value or just value
    let category: FilterCategory = this.options.defaultCategory || 'source';
    let value: string;

    if (this.check('IDENTIFIER')) {
      const id = this.advance();

      // Check for category:value syntax
      if (this.match('COLON')) {
        category = this.resolveCategory(id.value);
        value = this.parseFilterValue();
      } else {
        // Bare identifier - check if it's a known source/format value
        value = id.value;
        category = this.inferCategory(value);
      }
    } else if (this.check('WILDCARD')) {
      const wc = this.advance();
      value = wc.value;
      category = 'content';
    } else {
      throw new Error('Expected identifier after operator');
    }

    return {
      type: 'CATUSKOTI',
      category,
      value,
      state,
    };
  }

  private parseIdentifierFilter(): FilterNode {
    const id = this.advance();

    // Check for category:value or category:>number
    if (this.match('COLON')) {
      const category = this.resolveCategory(id.value);

      // Check for comparison operator
      if (this.check('GREATER') || this.check('LESS') || this.check('EQUAL')) {
        return this.parseComparison(category);
      }

      // Check for range (value..value)
      const value = this.parseFilterValue();

      if (this.check('RANGE')) {
        this.advance();
        const endValue = this.parseFilterValue();
        return {
          type: 'COMPARISON',
          category,
          operator: '..',
          value,
          endValue,
        } as ComparisonFilterNode;
      }

      // Regular catuskoti filter (implicit 'is')
      return {
        type: 'CATUSKOTI',
        category,
        value,
        state: 'is',
      } as CatuskotiFilterNode;
    }

    // Bare identifier - treat as content search term
    const inferredCategory = this.inferCategory(id.value);
    return {
      type: 'CATUSKOTI',
      category: inferredCategory,
      value: id.value,
      state: 'is',
    };
  }

  private parseComparison(category: FilterCategory): ComparisonFilterNode {
    let operator: ComparisonOp;
    const opToken = this.advance();

    switch (opToken.value) {
      case '>':
        operator = '>';
        break;
      case '>=':
        operator = '>=';
        break;
      case '<':
        operator = '<';
        break;
      case '<=':
        operator = '<=';
        break;
      case '=':
        operator = '=';
        break;
      default:
        throw new Error(`Unknown comparison operator: ${opToken.value}`);
    }

    const value = this.parseFilterValue();

    return {
      type: 'COMPARISON',
      category,
      operator,
      value,
    };
  }

  private parseFilterValue(): string {
    if (this.match('NUMBER')) {
      return this.previous().value;
    }
    if (this.match('DATE')) {
      return this.previous().value;
    }
    if (this.match('IDENTIFIER')) {
      return this.previous().value;
    }
    if (this.match('WILDCARD')) {
      return this.previous().value;
    }
    if (this.match('QUOTED')) {
      return this.previous().value;
    }

    throw new Error('Expected value');
  }

  private resolveCategory(name: string): FilterCategory {
    const lower = name.toLowerCase();
    if (CATEGORY_PREFIXES.includes(lower as FilterCategory)) {
      return lower as FilterCategory;
    }

    if (this.options.strictCategories) {
      this.warnings.push(`Unknown category: ${name}, treating as source`);
    }

    return 'source';
  }

  private inferCategory(value: string): FilterCategory {
    const lower = value.toLowerCase();

    if (SOURCE_VALUES.includes(lower as typeof SOURCE_VALUES[number])) {
      return 'source';
    }

    if (FORMAT_VALUES.includes(lower as typeof FORMAT_VALUES[number])) {
      return 'format';
    }

    // Default to content search
    return 'content';
  }
}

// =============================================================================
// CONVENIENCE FUNCTION
// =============================================================================

/**
 * Parse a query string with default options
 */
export function parseQuery(query: string, options?: QueryParserOptions): FilterTree {
  const parser = new QueryParser(options);
  return parser.parse(query);
}

// =============================================================================
// TREE UTILITIES
// =============================================================================

/**
 * Flatten nested AND groups into a single level
 */
export function flattenFilterTree(node: FilterNode): FilterNode {
  if (node.type === 'AND' || node.type === 'OR') {
    const group = node as FilterGroupNode;
    const flattened: FilterNode[] = [];

    for (const child of group.children) {
      const flatChild = flattenFilterTree(child);
      // Merge same-type groups
      if (flatChild.type === group.type && !(flatChild as FilterGroupNode).negated) {
        flattened.push(...(flatChild as FilterGroupNode).children);
      } else {
        flattened.push(flatChild);
      }
    }

    return {
      ...group,
      children: flattened,
    };
  }

  return node;
}

/**
 * Count nodes in a filter tree
 */
export function countFilterNodes(node: FilterNode | null): number {
  if (!node) return 0;

  if (node.type === 'AND' || node.type === 'OR') {
    const group = node as FilterGroupNode;
    return 1 + group.children.reduce((sum, child) => sum + countFilterNodes(child), 0);
  }

  return 1;
}

/**
 * Get all leaf filters from a tree
 */
export function getLeafFilters(node: FilterNode | null): FilterNode[] {
  if (!node) return [];

  if (node.type === 'AND' || node.type === 'OR') {
    const group = node as FilterGroupNode;
    return group.children.flatMap(getLeafFilters);
  }

  return [node];
}

/**
 * Convert filter tree to human-readable string
 */
export function filterTreeToString(node: FilterNode | null, depth = 0): string {
  if (!node) return '';
  const indent = '  '.repeat(depth);

  switch (node.type) {
    case 'AND':
    case 'OR': {
      const group = node as FilterGroupNode;
      const prefix = group.negated ? 'NOT ' : '';
      const childStrs = group.children.map(c => filterTreeToString(c, depth + 1));
      return `${indent}${prefix}${node.type}:\n${childStrs.join('\n')}`;
    }
    case 'CATUSKOTI': {
      const cat = node as CatuskotiFilterNode;
      const op = cat.state === 'is' ? '+' : cat.state === 'is-not' ? '-' : cat.state === 'both' ? '~' : '?';
      return `${indent}${op}${cat.category}:${cat.value}`;
    }
    case 'REGEX': {
      const regex = node as RegexFilterNode;
      return `${indent}/${regex.pattern}/${regex.flags}`;
    }
    case 'PHRASE': {
      const phrase = node as PhraseFilterNode;
      return `${indent}"${phrase.phrase}"`;
    }
    case 'WILDCARD': {
      const wc = node as WildcardFilterNode;
      return `${indent}${wc.pattern}`;
    }
    case 'COMPARISON': {
      const comp = node as ComparisonFilterNode;
      const rangeStr = comp.endValue !== undefined ? `${comp.value}..${comp.endValue}` : `${comp.operator}${comp.value}`;
      return `${indent}${comp.category}:${rangeStr}`;
    }
    case 'STACK_REF': {
      const ref = node as SavedStackRefNode;
      return `${indent}@${ref.name}`;
    }
    default:
      return `${indent}[unknown]`;
  }
}
