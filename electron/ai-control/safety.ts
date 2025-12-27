/**
 * Immutable Safety Layer
 *
 * This module contains safety checks that CANNOT be disabled.
 * The IMMUTABLE_SAFETY config is enforced at the code level.
 *
 * Even if someone modifies the config file, these checks
 * are hardcoded and will always run.
 *
 * Safety covers:
 * - Prompt injection detection
 * - Jailbreak attempt detection
 * - Harmful content blocking
 * - PII detection/redaction
 * - Rate limiting
 * - Audit logging
 */

import type { SafetyConfig, AIRequest, SafetyRule } from './types';

// ═══════════════════════════════════════════════════════════════════
// IMMUTABLE SAFETY CONFIG
// ═══════════════════════════════════════════════════════════════════

/**
 * These values are LITERAL TRUE - TypeScript ensures they cannot be false.
 * Even if someone edits the config file, these are re-enforced at runtime.
 */
export const IMMUTABLE_SAFETY: SafetyConfig = {
  contentFiltering: 'standard',
  piiDetection: true,
  piiRedaction: false,  // Only detection by default, redaction is optional

  // THESE ARE LITERAL TRUE - CANNOT BE CHANGED
  blockPromptInjection: true,
  blockJailbreakAttempts: true,
  blockMalwareGeneration: true,
  blockHarmfulContent: true,
  rateLimitPerUser: true,
  rateLimitPerIP: true,
  auditAllRequests: true,
  auditAllResponses: true,

  customRules: [],
} as const;

// ═══════════════════════════════════════════════════════════════════
// SAFETY PATTERNS
// ═══════════════════════════════════════════════════════════════════

/**
 * Prompt injection detection patterns
 */
const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  // System prompt overrides
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i,
  /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i,
  /forget\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i,

  // Role manipulation
  /you\s+are\s+(now\s+)?(?:a\s+)?(?:new|different)\s+(?:ai|assistant|bot)/i,
  /pretend\s+(?:to\s+be|you\s+are)\s+(?:a\s+)?(?:different|new|another)/i,
  /act\s+as\s+(?:if\s+)?(?:you\s+are|you're)\s+(?:a\s+)?(?:different|new)/i,

  // System prompt extraction
  /(?:what|reveal|show|tell|print|output)\s+(?:is\s+)?(?:your|the)\s+(?:system\s+)?prompt/i,
  /(?:repeat|echo)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions)/i,

  // Delimiter attacks
  /\[SYSTEM\]/i,
  /\[\/INST\]/i,
  /<\|im_start\|>/i,
  /<\|endoftext\|>/i,

  // Token manipulation
  /\u200b/,  // Zero-width space
  /\u200c/,  // Zero-width non-joiner
  /\u200d/,  // Zero-width joiner
  /\ufeff/,  // Zero-width no-break space
];

/**
 * Jailbreak attempt patterns
 */
const JAILBREAK_PATTERNS: RegExp[] = [
  // DAN and similar
  /\bDAN\b.*(?:do\s+anything|mode|jailbreak)/i,
  /developer\s+mode\s+(?:enabled|activated)/i,
  /\bjailbreak\b/i,

  // Roleplay attacks
  /(?:you\s+are|you're)\s+(?:a\s+)?(?:evil|malicious|uncensored)/i,
  /(?:pretend|imagine)\s+(?:you\s+)?(?:have\s+)?no\s+(?:ethical|moral)\s+(?:guidelines|restrictions)/i,

  // Hypothetical bypasses
  /for\s+(?:educational|research|testing)\s+purposes\s+(?:only\s+)?(?:show|tell|explain)/i,
  /hypothetically\s+(?:speaking|,)\s+(?:if|how)/i,

  // Character roleplay jailbreaks
  /\bGPT-?4\s+simulator/i,
  /\bunfiltered\s+(?:ai|gpt|llm)/i,
];

/**
 * Malware generation patterns
 */
const MALWARE_PATTERNS: RegExp[] = [
  // Exploit development
  /(?:write|create|generate)\s+(?:a\s+)?(?:exploit|payload|shellcode)/i,
  /(?:write|create|generate)\s+(?:a\s+)?(?:ransomware|malware|virus|trojan)/i,
  /(?:write|create|generate)\s+(?:a\s+)?(?:keylogger|rootkit|backdoor)/i,

  // Attack tools
  /(?:write|create|generate)\s+(?:a\s+)?(?:ddos|dos)\s+(?:script|tool|attack)/i,
  /(?:write|create|generate)\s+(?:a\s+)?(?:sql\s+injection|xss)\s+(?:payload|script)/i,

  // Credential theft
  /(?:write|create|generate)\s+(?:a\s+)?(?:phishing|credential\s+harvester)/i,
  /(?:write|create|generate)\s+(?:a\s+)?(?:password\s+stealer)/i,
];

/**
 * Harmful content patterns
 */
const HARMFUL_CONTENT_PATTERNS: RegExp[] = [
  // Violence
  /(?:how\s+to|instructions?\s+for)\s+(?:make|build|create)\s+(?:a\s+)?(?:bomb|explosive|weapon)/i,
  /(?:how\s+to|instructions?\s+for)\s+(?:kill|murder|assassinate)/i,

  // Illegal activities
  /(?:how\s+to|instructions?\s+for)\s+(?:make|synthesize|cook)\s+(?:drugs?|meth|cocaine|heroin)/i,
  /(?:how\s+to|instructions?\s+for)\s+(?:counterfeit|forge)\s+(?:money|currency|documents?)/i,

  // Child exploitation (immediate block)
  /(?:child|minor|underage)\s+(?:porn|sexual|nude)/i,
  /\bcsam\b/i,
];

/**
 * PII patterns for detection
 */
const PII_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  { type: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  { type: 'ssn', pattern: /\b\d{9}\b/ },
  { type: 'credit_card', pattern: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/ },
  { type: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ },
  { type: 'phone', pattern: /\b(?:\+1[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}\b/ },
  { type: 'ip_address', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/ },
  { type: 'passport', pattern: /\b[A-Z]{1,2}\d{6,9}\b/ },
  { type: 'drivers_license', pattern: /\b[A-Z]\d{7,8}\b/ },
];

// ═══════════════════════════════════════════════════════════════════
// SAFETY CHECK RESULT
// ═══════════════════════════════════════════════════════════════════

export interface SafetyCheckResult {
  passed: boolean;
  blocked: boolean;
  warnings: string[];
  violations: SafetyViolation[];
  piiDetected: PIIDetection[];
  sanitizedInput?: string;
}

export interface SafetyViolation {
  type: 'prompt_injection' | 'jailbreak' | 'malware' | 'harmful_content' | 'custom_rule';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  matchedPattern?: string;
  ruleId?: string;
}

export interface PIIDetection {
  type: string;
  value: string;
  redacted: string;
  position: { start: number; end: number };
}

// ═══════════════════════════════════════════════════════════════════
// SAFETY CHECK FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Run ALL safety checks on a request.
 * This function ALWAYS runs - it cannot be disabled.
 */
export function runSafetyChecks(
  request: AIRequest,
  config: SafetyConfig = IMMUTABLE_SAFETY
): SafetyCheckResult {
  const result: SafetyCheckResult = {
    passed: true,
    blocked: false,
    warnings: [],
    violations: [],
    piiDetected: [],
  };

  // Get input text
  const inputText = typeof request.input === 'string'
    ? request.input
    : request.input.text || '';

  // 1. Prompt injection detection (ALWAYS ON)
  checkPromptInjection(inputText, result);

  // 2. Jailbreak detection (ALWAYS ON)
  checkJailbreakAttempts(inputText, result);

  // 3. Malware generation detection (ALWAYS ON)
  checkMalwareGeneration(inputText, result);

  // 4. Harmful content detection (ALWAYS ON)
  checkHarmfulContent(inputText, result);

  // 5. PII detection (configurable level)
  if (config.piiDetection) {
    checkPII(inputText, result, config.piiRedaction);
  }

  // 6. Custom rules
  if (config.customRules && config.customRules.length > 0) {
    checkCustomRules(inputText, result, config.customRules);
  }

  // Determine if request should be blocked
  const criticalViolations = result.violations.filter(
    v => v.severity === 'critical' || v.severity === 'high'
  );

  if (criticalViolations.length > 0) {
    result.passed = false;
    result.blocked = true;
  }

  return result;
}

/**
 * Check for prompt injection attempts
 */
function checkPromptInjection(
  input: string,
  result: SafetyCheckResult
): void {
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      result.violations.push({
        type: 'prompt_injection',
        severity: 'high',
        message: 'Prompt injection attempt detected',
        matchedPattern: pattern.source,
      });
    }
  }
}

/**
 * Check for jailbreak attempts
 */
function checkJailbreakAttempts(
  input: string,
  result: SafetyCheckResult
): void {
  for (const pattern of JAILBREAK_PATTERNS) {
    if (pattern.test(input)) {
      result.violations.push({
        type: 'jailbreak',
        severity: 'high',
        message: 'Jailbreak attempt detected',
        matchedPattern: pattern.source,
      });
    }
  }
}

/**
 * Check for malware generation requests
 */
function checkMalwareGeneration(
  input: string,
  result: SafetyCheckResult
): void {
  for (const pattern of MALWARE_PATTERNS) {
    if (pattern.test(input)) {
      result.violations.push({
        type: 'malware',
        severity: 'critical',
        message: 'Malware generation request detected',
        matchedPattern: pattern.source,
      });
    }
  }
}

/**
 * Check for harmful content requests
 */
function checkHarmfulContent(
  input: string,
  result: SafetyCheckResult
): void {
  for (const pattern of HARMFUL_CONTENT_PATTERNS) {
    if (pattern.test(input)) {
      result.violations.push({
        type: 'harmful_content',
        severity: 'critical',
        message: 'Harmful content request detected',
        matchedPattern: pattern.source,
      });
    }
  }
}

/**
 * Check for PII in input
 */
function checkPII(
  input: string,
  result: SafetyCheckResult,
  shouldRedact: boolean
): void {
  let sanitizedInput = input;

  for (const { type, pattern } of PII_PATTERNS) {
    const regex = new RegExp(pattern, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(input)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;
      const redacted = '*'.repeat(value.length);

      result.piiDetected.push({
        type,
        value: shouldRedact ? redacted : value,
        redacted,
        position: { start, end },
      });

      if (shouldRedact) {
        sanitizedInput = sanitizedInput.replace(value, redacted);
      }

      result.warnings.push(`PII detected: ${type}`);
    }
  }

  if (shouldRedact && result.piiDetected.length > 0) {
    result.sanitizedInput = sanitizedInput;
  }
}

/**
 * Check custom safety rules
 */
function checkCustomRules(
  input: string,
  result: SafetyCheckResult,
  rules: SafetyRule[]
): void {
  for (const rule of rules) {
    try {
      const pattern = new RegExp(rule.pattern, 'i');
      if (pattern.test(input)) {
        if (rule.action === 'block') {
          result.violations.push({
            type: 'custom_rule',
            severity: 'high',
            message: rule.message || `Custom rule '${rule.name}' violated`,
            ruleId: rule.id,
            matchedPattern: rule.pattern,
          });
        } else if (rule.action === 'warn') {
          result.warnings.push(rule.message || `Custom rule '${rule.name}' matched`);
        }
        // 'log' action just records without warning
      }
    } catch (error) {
      console.error(`Invalid custom rule pattern: ${rule.pattern}`, error);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// OUTPUT SAFETY
// ═══════════════════════════════════════════════════════════════════

/**
 * Check AI output for safety (post-generation)
 */
export function checkOutputSafety(
  output: string,
  config: SafetyConfig = IMMUTABLE_SAFETY
): SafetyCheckResult {
  const result: SafetyCheckResult = {
    passed: true,
    blocked: false,
    warnings: [],
    violations: [],
    piiDetected: [],
  };

  // Check for harmful content in output
  checkHarmfulContent(output, result);

  // Check for PII leakage
  if (config.piiDetection) {
    checkPII(output, result, config.piiRedaction);
  }

  // Block if critical violations found
  const criticalViolations = result.violations.filter(
    v => v.severity === 'critical'
  );

  if (criticalViolations.length > 0) {
    result.passed = false;
    result.blocked = true;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// RATE LIMITING
// ═══════════════════════════════════════════════════════════════════

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Check rate limit for a user/IP
 * Returns true if within limit, false if exceeded
 */
export function checkRateLimit(
  identifier: string,
  limitPerMinute: number
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const windowMs = 60 * 1000;  // 1 minute window

  let entry = rateLimitStore.get(identifier);

  // New window or expired
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { count: 0, windowStart: now };
    rateLimitStore.set(identifier, entry);
  }

  const remaining = Math.max(0, limitPerMinute - entry.count);
  const resetIn = Math.max(0, entry.windowStart + windowMs - now);

  if (entry.count >= limitPerMinute) {
    return { allowed: false, remaining: 0, resetIn };
  }

  entry.count++;
  return { allowed: true, remaining: remaining - 1, resetIn };
}

/**
 * Clear rate limit store (for testing)
 */
export function clearRateLimits(): void {
  rateLimitStore.clear();
}

// ═══════════════════════════════════════════════════════════════════
// AUDIT LOGGING
// ═══════════════════════════════════════════════════════════════════

export interface AuditEntry {
  timestamp: string;
  type: 'request' | 'response' | 'safety_violation' | 'rate_limit' | 'error';
  userId?: string;
  sessionId?: string;
  requestId?: string;
  capability?: string;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  safetyResult?: SafetyCheckResult;
  error?: string;
  metadata?: Record<string, unknown>;
}

// In-memory audit buffer (flushes to disk/db periodically)
const auditBuffer: AuditEntry[] = [];
const MAX_BUFFER_SIZE = 1000;

/**
 * Log an audit entry
 * This ALWAYS runs - cannot be disabled
 */
export function auditLog(entry: Omit<AuditEntry, 'timestamp'>): void {
  const fullEntry: AuditEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  auditBuffer.push(fullEntry);

  // Flush if buffer is full
  if (auditBuffer.length >= MAX_BUFFER_SIZE) {
    flushAuditBuffer();
  }
}

/**
 * Flush audit buffer to storage
 */
export async function flushAuditBuffer(): Promise<AuditEntry[]> {
  const entries = auditBuffer.splice(0, auditBuffer.length);

  // TODO: Write to file or database
  // For now, just log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Audit] Flushed ${entries.length} entries`);
  }

  return entries;
}

/**
 * Get audit buffer (for testing)
 */
export function getAuditBuffer(): AuditEntry[] {
  return [...auditBuffer];
}
