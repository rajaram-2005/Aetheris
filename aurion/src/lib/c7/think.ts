/* ─── THINK — Stage 5: Recursive-descent math parser, unit conversions, stats ─── */

import { ThinkResult, SenseResult } from '@/types';

/* ── Constants ── */
const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  phi: 1.6180339887,
  sqrt2: Math.SQRT2,
  ln2: Math.LN2,
  ln10: Math.LN10,
};

/* ── Unit conversion tables ── */
const CONVERSIONS: Record<string, Record<string, (v: number) => { result: number; formula: string }>> = {
  length: {
    'km-mi': (v) => ({ result: v * 0.621371, formula: `${v} km × 0.621371 = ${(v * 0.621371).toFixed(4)} miles` }),
    'mi-km': (v) => ({ result: v * 1.60934, formula: `${v} miles × 1.60934 = ${(v * 1.60934).toFixed(4)} km` }),
    'm-ft': (v) => ({ result: v * 3.28084, formula: `${v} m × 3.28084 = ${(v * 3.28084).toFixed(4)} feet` }),
    'ft-m': (v) => ({ result: v * 0.3048, formula: `${v} feet × 0.3048 = ${(v * 0.3048).toFixed(4)} m` }),
    'cm-in': (v) => ({ result: v * 0.393701, formula: `${v} cm × 0.393701 = ${(v * 0.393701).toFixed(4)} inches` }),
    'in-cm': (v) => ({ result: v * 2.54, formula: `${v} inches × 2.54 = ${(v * 2.54).toFixed(4)} cm` }),
    'm-km': (v) => ({ result: v / 1000, formula: `${v} m ÷ 1000 = ${(v / 1000).toFixed(4)} km` }),
    'km-m': (v) => ({ result: v * 1000, formula: `${v} km × 1000 = ${(v * 1000).toFixed(4)} m` }),
    'miles-feet': (v) => ({ result: v * 5280, formula: `${v} miles × 5280 = ${(v * 5280).toFixed(0)} feet` }),
    'feet-miles': (v) => ({ result: v / 5280, formula: `${v} feet ÷ 5280 = ${(v / 5280).toFixed(6)} miles` }),
  },
  weight: {
    'kg-lb': (v) => ({ result: v * 2.20462, formula: `${v} kg × 2.20462 = ${(v * 2.20462).toFixed(4)} lbs` }),
    'lb-kg': (v) => ({ result: v * 0.453592, formula: `${v} lbs × 0.453592 = ${(v * 0.453592).toFixed(4)} kg` }),
    'kg-g': (v) => ({ result: v * 1000, formula: `${v} kg × 1000 = ${(v * 1000).toFixed(0)} g` }),
    'g-kg': (v) => ({ result: v / 1000, formula: `${v} g ÷ 1000 = ${(v / 1000).toFixed(4)} kg` }),
    'lb-oz': (v) => ({ result: v * 16, formula: `${v} lbs × 16 = ${(v * 16).toFixed(0)} oz` }),
    'oz-lb': (v) => ({ result: v / 16, formula: `${v} oz ÷ 16 = ${(v / 16).toFixed(4)} lbs` }),
  },
  temperature: {
    'c-f': (v) => ({ result: v * 9 / 5 + 32, formula: `${v}°C × 9/5 + 32 = ${(v * 9 / 5 + 32).toFixed(2)}°F` }),
    'f-c': (v) => ({ result: (v - 32) * 5 / 9, formula: `(${v}°F − 32) × 5/9 = ${((v - 32) * 5 / 9).toFixed(2)}°C` }),
    'c-k': (v) => ({ result: v + 273.15, formula: `${v}°C + 273.15 = ${(v + 273.15).toFixed(2)} K` }),
    'k-c': (v) => ({ result: v - 273.15, formula: `${v} K − 273.15 = ${(v - 273.15).toFixed(2)}°C` }),
    'f-k': (v) => ({ result: (v - 32) * 5 / 9 + 273.15, formula: `(${v}°F − 32) × 5/9 + 273.15 = ${((v - 32) * 5 / 9 + 273.15).toFixed(2)} K` }),
    'k-f': (v) => ({ result: (v - 273.15) * 9 / 5 + 32, formula: `(${v} K − 273.15) × 9/5 + 32 = ${((v - 273.15) * 9 / 5 + 32).toFixed(2)}°F` }),
  },
  speed: {
    'kmh-mph': (v) => ({ result: v * 0.621371, formula: `${v} km/h × 0.621371 = ${(v * 0.621371).toFixed(2)} mph` }),
    'mph-kmh': (v) => ({ result: v * 1.60934, formula: `${v} mph × 1.60934 = ${(v * 1.60934).toFixed(2)} km/h` }),
  },
  data: {
    'mb-gb': (v) => ({ result: v / 1024, formula: `${v} MB ÷ 1024 = ${(v / 1024).toFixed(4)} GB` }),
    'gb-mb': (v) => ({ result: v * 1024, formula: `${v} GB × 1024 = ${(v * 1024).toFixed(0)} MB` }),
    'kb-mb': (v) => ({ result: v / 1024, formula: `${v} KB ÷ 1024 = ${(v / 1024).toFixed(4)} MB` }),
    'mb-kb': (v) => ({ result: v * 1024, formula: `${v} MB × 1024 = ${(v * 1024).toFixed(0)} KB` }),
  },
};

/* ── Unit alias mapping ── */
const UNIT_ALIASES: Record<string, string> = {
  'kilometers': 'km', 'kilometres': 'km', 'kms': 'km',
  'miles': 'mi', 'mile': 'mi',
  'meters': 'm', 'metres': 'm',
  'feet': 'ft', 'foot': 'ft',
  'centimeters': 'cm', 'centimetres': 'cm',
  'inches': 'in', 'inch': 'in',
  'kilograms': 'kg', 'kilos': 'kg',
  'pounds': 'lb', 'lbs': 'lb',
  'grams': 'g', 'gram': 'g',
  'ounces': 'oz', 'ounce': 'oz',
  'celsius': 'c', 'centigrade': 'c',
  'fahrenheit': 'f',
  'kelvin': 'k',
  '°c': 'c', '°f': 'f', '°k': 'k',
  'km/h': 'kmh', 'kph': 'kmh', 'kmh': 'kmh',
  'mph': 'mph',
  'megabytes': 'mb',
  'gigabytes': 'gb',
  'kilobytes': 'kb',
};

function normalizeUnit(u: string): string {
  const lower = u.toLowerCase().trim();
  return UNIT_ALIASES[lower] || lower;
}

/* ── Detect unit conversion in text ── */
function detectConversion(text: string): { value: number; from: string; to: string } | null {
  // Pattern: "convert X km to miles" or "X km in miles" or "X celsius to fahrenheit"
  const patterns = [
    /convert\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(?:to|in|into)\s+(\w+)/i,
    /(\d+(?:\.\d+)?)\s+(\w+)\s+(?:to|in|into)\s+(\w+)/i,
    /how\s+(?:many|much)\s+(\w+)\s+(?:is|are|in)\s+(\d+(?:\.\d+)?)\s+(\w+)/i,
    /(\d+(?:\.\d+)?)\s*([°cfk]+)\s+(?:to|in)\s+([°cfk]+)/i,
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      if (p === patterns[2]) {
        // "how many X is Y Z"
        return { value: parseFloat(m[2]), from: normalizeUnit(m[3]), to: normalizeUnit(m[1]) };
      }
      return { value: parseFloat(m[1]), from: normalizeUnit(m[2]), to: normalizeUnit(m[3]) };
    }
  }
  return null;
}

/* ── Perform conversion ── */
function performConversion(value: number, from: string, to: string): { result: number; formula: string } | null {
  const key = `${from}-${to}`;
  for (const category of Object.values(CONVERSIONS)) {
    if (category[key]) return category[key](value);
  }
  return null;
}

/* ── CSV stats ── */
function computeStats(text: string): ThinkResult | null {
  // Detect CSV-like numbers
  const numbers = text.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!numbers || numbers.length < 2) return null;

  // Check if this looks like a stats request
  const isStats = /(?:mean|average|median|mode|standard\s*deviation|std|variance|sum|count|stats|statistics)/i.test(text);
  if (!isStats && numbers.length < 3) return null;

  const sorted = [...numbers].sort((a, b) => a - b);
  const n = numbers.length;
  const sum = numbers.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const variance = numbers.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const min = sorted[0];
  const max = sorted[n - 1];
  const range = max - min;

  // Mode
  const freq: Record<number, number> = {};
  for (const v of numbers) freq[v] = (freq[v] || 0) + 1;
  const maxFreq = Math.max(...Object.values(freq));
  const mode = Object.entries(freq).filter(([, f]) => f === maxFreq).map(([v]) => parseFloat(v));

  const steps = [
    `Count: ${n}`,
    `Sum: ${sum}`,
    `Mean: ${mean.toFixed(4)}`,
    `Median: ${median.toFixed(4)}`,
    `Mode: ${mode.join(', ')}`,
    `Min: ${min}`,
    `Max: ${max}`,
    `Range: ${range}`,
    `Variance: ${variance.toFixed(4)}`,
    `Std Dev: ${stdDev.toFixed(4)}`,
  ];

  return {
    type: 'stats',
    input: text,
    output: `**Statistics for ${n} values:**\n${steps.join('\n')}`,
    steps,
  };
}

/* ── Recursive-descent math parser ── */
class MathParser {
  private pos = 0;
  private expr = '';

  parse(expression: string): { value: number; steps: string[] } {
    this.expr = expression.replace(/\s+/g, '');
    this.pos = 0;
    const value = this.parseExpression();
    return { value: Math.round(value * 1e10) / 1e10, steps: [`${expression} = ${Math.round(value * 1e10) / 1e10}`] };
  }

  private peek(): string {
    return this.pos < this.expr.length ? this.expr[this.pos] : '';
  }

  private consume(): string {
    return this.expr[this.pos++];
  }

  private parseExpression(): number {
    let result = this.parseTerm();
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.consume();
      const right = this.parseTerm();
      result = op === '+' ? result + right : result - right;
    }
    return result;
  }

  private parseTerm(): number {
    let result = this.parsePower();
    while (this.peek() === '*' || this.peek() === '/' || this.peek() === '%') {
      const op = this.consume();
      const right = this.parsePower();
      if (op === '*') result *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        result /= right;
      }
      else result %= right;
    }
    return result;
  }

  private parsePower(): number {
    let result = this.parseUnary();
    if (this.peek() === '^') {
      this.consume();
      const exponent = this.parsePower(); // right-associative
      result = Math.pow(result, exponent);
    }
    return result;
  }

  private parseUnary(): number {
    if (this.peek() === '-') {
      this.consume();
      return -this.parsePrimary();
    }
    if (this.peek() === '+') {
      this.consume();
      return this.parsePrimary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    // Parentheses
    if (this.peek() === '(') {
      this.consume();
      const result = this.parseExpression();
      if (this.peek() === ')') this.consume();
      return result;
    }

    // Functions
    const funcNames = ['sqrt', 'log', 'ln', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'abs', 'ceil', 'floor', 'round', 'exp', 'fact'];
    for (const fn of funcNames) {
      if (this.expr.slice(this.pos, this.pos + fn.length) === fn && this.expr[this.pos + fn.length] === '(') {
        this.pos += fn.length + 1; // skip fn and (
        const arg = this.parseExpression();
        if (this.peek() === ')') this.consume();
        return this.applyFunction(fn, arg);
      }
    }

    // Constants
    for (const [name, value] of Object.entries(CONSTANTS)) {
      if (this.expr.slice(this.pos, this.pos + name.length) === name) {
        const after = this.expr[this.pos + name.length];
        if (!after || /[+\-*/^%)%]/.test(after)) {
          this.pos += name.length;
          return value;
        }
      }
    }

    // Number
    let numStr = '';
    while (this.pos < this.expr.length && /[\d.]/.test(this.expr[this.pos])) {
      numStr += this.consume();
    }
    if (numStr === '') {
      throw new Error(`Unexpected character '${this.peek()}' at position ${this.pos}`);
    }
    return parseFloat(numStr);
  }

  private applyFunction(fn: string, arg: number): number {
    switch (fn) {
      case 'sqrt': return Math.sqrt(arg);
      case 'log': return Math.log10(arg);
      case 'ln': return Math.log(arg);
      case 'sin': return Math.sin(arg);
      case 'cos': return Math.cos(arg);
      case 'tan': return Math.tan(arg);
      case 'asin': return Math.asin(arg);
      case 'acos': return Math.acos(arg);
      case 'atan': return Math.atan(arg);
      case 'abs': return Math.abs(arg);
      case 'ceil': return Math.ceil(arg);
      case 'floor': return Math.floor(arg);
      case 'round': return Math.round(arg);
      case 'exp': return Math.exp(arg);
      case 'fact': return factorial(Math.round(arg));
      default: return arg;
    }
  }
}

function factorial(n: number): number {
  if (n < 0) return NaN;
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

/* ── Percent calculations ── */
function detectPercent(text: string): ThinkResult | null {
  // "what is X% of Y"
  let m = text.match(/what\s+is\s+(\d+(?:\.\d+)?)\s*%\s*of\s+(\d+(?:\.\d+)?)/i);
  if (m) {
    const p = parseFloat(m[1]);
    const n = parseFloat(m[2]);
    const result = (p / 100) * n;
    return {
      type: 'percent',
      input: text,
      output: `${p}% of ${n} = ${result}`,
      steps: [`${p}% = ${p}/100 = ${p / 100}`, `${p / 100} × ${n} = ${result}`],
    };
  }

  // "X is what percent of Y"
  m = text.match(/(\d+(?:\.\d+)?)\s+is\s+what\s+percent\s+of\s+(\d+(?:\.\d+)?)/i);
  if (m) {
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    const result = (x / y) * 100;
    return {
      type: 'percent',
      input: text,
      output: `${x} is ${result.toFixed(2)}% of ${y}`,
      steps: [`${x} ÷ ${y} = ${(x / y).toFixed(6)}`, `× 100 = ${result.toFixed(2)}%`],
    };
  }

  // "X% increase/decrease from Y"
  m = text.match(/(\d+(?:\.\d+)?)\s*%\s*(increase|decrease)\s*from\s+(\d+(?:\.\d+)?)/i);
  if (m) {
    const p = parseFloat(m[1]);
    const n = parseFloat(m[2]);
    const dir = m[2].toLowerCase();
    const change = (p / 100) * n;
    const result = dir === 'increase' ? n + change : n - change;
    return {
      type: 'percent',
      input: text,
      output: `${p}% ${dir} from ${n} = ${result}`,
      steps: [`${p}% of ${n} = ${change}`, `${dir === 'increase' ? n + ' + ' : n + ' - '}${change} = ${result}`],
    };
  }

  return null;
}

/* ── Quadratic equation solver ── */
function solveQuadratic(text: string): ThinkResult | null {
  const m = text.match(/(?:solve|find\s+(?:roots?|solutions?)\s+(?:of|for)?)\s*(?:x\^2|x²)\s*([+-]\s*\d*(?:\.\d+)?x?)?\s*([+-]\s*\d+(?:\.\d+)?)?\s*=\s*0/i);
  if (!m) return null;

  const a = 1;
  let b = 0, c = 0;

  if (m[1]) {
    const bStr = m[1].replace(/\s/g, '').replace('x', '');
    b = bStr === '' || bStr === '+' ? 1 : bStr === '-' ? -1 : parseFloat(bStr);
  }
  if (m[2]) {
    c = parseFloat(m[2].replace(/\s/g, ''));
  }

  const discriminant = b * b - 4 * a * c;
  const steps = [
    `Equation: x² + ${b}x + ${c} = 0`,
    `a = ${a}, b = ${b}, c = ${c}`,
    `Discriminant (D) = b² - 4ac = ${b}² - 4(${a})(${c}) = ${discriminant}`,
  ];

  if (discriminant > 0) {
    const x1 = (-b + Math.sqrt(discriminant)) / (2 * a);
    const x2 = (-b - Math.sqrt(discriminant)) / (2 * a);
    steps.push(`D > 0: Two real roots`);
    steps.push(`x₁ = (-${b} + √${discriminant}) / 2 = ${x1.toFixed(4)}`);
    steps.push(`x₂ = (-${b} - √${discriminant}) / 2 = ${x2.toFixed(4)}`);
    return { type: 'quadratic', input: text, output: `x₁ = ${x1.toFixed(4)}, x₂ = ${x2.toFixed(4)}`, steps };
  } else if (discriminant === 0) {
    const x = -b / (2 * a);
    steps.push(`D = 0: One repeated root`);
    steps.push(`x = -${b} / 2 = ${x.toFixed(4)}`);
    return { type: 'quadratic', input: text, output: `x = ${x.toFixed(4)} (repeated)`, steps };
  } else {
    const real = -b / (2 * a);
    const imag = Math.sqrt(-discriminant) / (2 * a);
    steps.push(`D < 0: Two complex roots`);
    steps.push(`x₁ = ${real.toFixed(4)} + ${imag.toFixed(4)}i`);
    steps.push(`x₂ = ${real.toFixed(4)} - ${imag.toFixed(4)}i`);
    return { type: 'quadratic', input: text, output: `x₁ = ${real.toFixed(4)} + ${imag.toFixed(4)}i, x₂ = ${real.toFixed(4)} - ${imag.toFixed(4)}i`, steps };
  }
}

/* ── Extract math expression from natural language ── */
function extractMathExpr(text: string): string | null {
  // Direct expressions like "2+2", "(3+4)*5"
  let m = text.match(/[\d\.\+\-\*\/\^\(\)%\s]{3,}/);
  if (m && /[\+\-\*\/\^%]/.test(m[0])) return m[0].trim();

  // "what is X + Y"
  m = text.match(/(?:what\s+is|calculate|compute|evaluate|solve)\s+(.+)/i);
  if (m) {
    let expr = m[1].replace(/[?!.]/g, '').trim();
    // Convert word operators
    expr = expr.replace(/\bplus\b/gi, '+').replace(/\bminus\b/gi, '-');
    expr = expr.replace(/\btimes\b/gi, '*').replace(/\bmultiplied\s+by\b/gi, '*');
    expr = expr.replace(/\bdivided\s+by\b/gi, '/').replace(/\bover\b/gi, '/');
    expr = expr.replace(/\bto\s+the\s+power\s+of\b/gi, '^').replace(/\bsquared\b/gi, '^2');
    expr = expr.replace(/\bcubed\b/gi, '^3');
    expr = expr.replace(/\bsquare\s+root\s+of\b/gi, 'sqrt(');
    expr = expr.replace(/\bsqrt\s+of\b/gi, 'sqrt(');

    // If we opened a sqrt(, close it
    const opens = (expr.match(/\(/g) || []).length;
    const closes = (expr.match(/\)/g) || []).length;
    if (opens > closes) expr += ')'.repeat(opens - closes);

    if (/[\d]/.test(expr) && /[\+\-\*\/\^%]/.test(expr)) return expr;
  }

  return null;
}

/* ── Main THINK pipeline ── */
export function think(rawText: string, senseResult: SenseResult): ThinkResult {
  const text = rawText.trim();

  // 1. Try unit conversion
  const conv = detectConversion(text);
  if (conv) {
    const result = performConversion(conv.value, conv.from, conv.to);
    if (result) {
      return {
        type: 'conversion',
        input: text,
        output: result.formula,
        steps: [result.formula],
        value: result.result,
      };
    }
  }

  // 2. Try percent calculations
  const pct = detectPercent(text);
  if (pct) return pct;

  // 3. Try quadratic
  const quad = solveQuadratic(text);
  if (quad) return quad;

  // 4. Try CSV/stats
  const stats = computeStats(text);
  if (stats) return stats;

  // 5. Try math expression
  const expr = extractMathExpr(text);
  if (expr) {
    try {
      const parser = new MathParser();
      const result = parser.parse(expr);
      return {
        type: 'math',
        input: expr,
        output: `**${expr}** = **${result.value}**`,
        steps: result.steps,
        value: result.value,
      };
    } catch {
      // Fall through
    }
  }

  // 6. Check if it's a math-like query but couldn't parse
  const hasMathCue = /(?:calculate|compute|solve|evaluate|what\s+is\s+\d|find\s+(?:the\s+)?(?:value|result|sum|product))/i.test(text);
  if (hasMathCue && /\d/.test(text)) {
    // Try harder - extract just numbers and operators
    const cleaned = text.replace(/[^0-9+\-*/^().%\s]/g, '').trim();
    if (cleaned.length > 0) {
      try {
        const parser = new MathParser();
        const result = parser.parse(cleaned);
        return {
          type: 'math',
          input: cleaned,
          output: `**${cleaned}** = **${result.value}**`,
          steps: result.steps,
          value: result.value,
        };
      } catch {
        // Fall through
      }
    }
  }

  return { type: 'none', input: text, output: '', steps: [] };
}
