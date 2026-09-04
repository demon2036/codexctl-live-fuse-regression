import {
  MAX_DECLARATIONS,
  MAX_RULES,
  MAX_VALUE_CHARACTERS,
  PARTS,
  PROPERTY_NAME,
  SAFE_PROPERTIES,
  SIMPLE_SELECTOR,
  STATES,
  SafeCssValidationError,
} from "./safe-css-contract.mjs";
import { validatePropertyValue } from "./safe-css-values.mjs";

export class Parser {
  constructor(source) {
    this.source = source;
    this.index = 0;
    this.ruleCount = 0;
    this.declarationCount = 0;
    this.rules = [];
    this.lineStarts = [0];
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === "\n") this.lineStarts.push(index + 1);
    }
  }

  position(offset = this.index) {
    let low = 0;
    let high = this.lineStarts.length;
    while (low + 1 < high) {
      const middle = (low + high) >> 1;
      if (this.lineStarts[middle] <= offset) low = middle;
      else high = middle;
    }
    return { line: low + 1, column: offset - this.lineStarts[low] + 1 };
  }

  fail(code, message, offset = this.index) {
    const { line, column } = this.position(offset);
    throw new SafeCssValidationError(code, message, line, column);
  }

  skipWhitespace() {
    while (this.index < this.source.length && /[\t\n\r\f ]/u.test(this.source[this.index])) {
      this.index += 1;
    }
  }

  parseSelector(prelude, offset) {
    const selectors = prelude.split(",");
    if (selectors.length !== 1) {
      this.fail("selector/list", "Safe CSS rules must contain exactly one registered selector", offset);
    }
    for (const rawSelector of selectors) {
      const selector = rawSelector.trim();
      const match = selector.match(SIMPLE_SELECTOR);
      if (!match || !PARTS.has(match[1]) || (match[2] && !STATES.has(match[2]))) {
        this.fail(
          "selector/unsupported",
          'Selectors must be an exact registered [data-ds-part="..."] with optional :hover or :focus-visible',
          offset + Math.max(0, prelude.indexOf(rawSelector)),
        );
      }
      return {
        part: match[1],
        selector,
        state: match[2] ?? null,
      };
    }
    return null;
  }

  parseRule() {
    const selectorOffset = this.index;
    while (this.index < this.source.length && this.source[this.index] !== "{") {
      const char = this.source[this.index];
      if (char === "}" || char === ";" || char === "@") {
        this.fail("syntax/rule", "Safe CSS accepts qualified rules only");
      }
      this.index += 1;
    }
    if (this.index >= this.source.length) this.fail("syntax/block", "Safe CSS rule is missing an opening brace", selectorOffset);
    const prelude = this.source.slice(selectorOffset, this.index).trim();
    if (!prelude) this.fail("selector/empty", "Safe CSS rule has an empty selector", selectorOffset);
    const selector = this.parseSelector(prelude, selectorOffset);
    this.index += 1;
    this.ruleCount += 1;
    if (this.ruleCount > MAX_RULES) this.fail("limit/rules", `Safe CSS exceeds ${MAX_RULES} rules`, selectorOffset);
    const declarations = this.parseDeclarations();
    this.rules.push({ selector, declarations });
  }

  parseDeclarations() {
    const seen = new Set();
    const declarations = [];
    let count = 0;
    while (true) {
      this.skipWhitespace();
      if (this.index >= this.source.length) this.fail("syntax/block", "Safe CSS rule is missing a closing brace");
      if (this.source[this.index] === "}") {
        if (count === 0) this.fail("declaration/empty", "Safe CSS rules must contain at least one declaration");
        this.index += 1;
        return declarations;
      }
      const propertyOffset = this.index;
      while (this.index < this.source.length && this.source[this.index] !== ":") {
        const char = this.source[this.index];
        if (char === ";" || char === "{" || char === "}" || char === "@" || char === "!") {
          this.fail("syntax/declaration", "Safe CSS declaration is missing a property/value separator");
        }
        this.index += 1;
      }
      if (this.index >= this.source.length) this.fail("syntax/declaration", "Safe CSS declaration is incomplete", propertyOffset);
      const property = this.source.slice(propertyOffset, this.index).trim().toLowerCase();
      if (!PROPERTY_NAME.test(property)) this.fail("property/name", "Safe CSS property name is invalid", propertyOffset);
      if (!SAFE_PROPERTIES.has(property)) this.fail("property/unsupported", `Safe CSS property is not allowed: ${property}`, propertyOffset);
      if (seen.has(property)) this.fail("property/duplicate", `Safe CSS rule repeats property: ${property}`, propertyOffset);
      seen.add(property);
      this.index += 1;
      const valueOffset = this.index;
      let depth = 0;
      while (this.index < this.source.length) {
        const char = this.source[this.index];
        if (char === "(") depth += 1;
        else if (char === ")") {
          depth -= 1;
          if (depth < 0) this.fail("syntax/function", "Safe CSS value has an unmatched closing parenthesis");
        } else if ((char === ";" || char === "}") && depth === 0) break;
        if (char === "{" || char === "[" || char === "]" || char === "@" || char === "!" || char === "\"" || char === "'") {
          this.fail("value/token", "Safe CSS value contains a forbidden token");
        }
        this.index += 1;
      }
      if (depth !== 0) this.fail("syntax/function", "Safe CSS value has an unclosed function", valueOffset);
      const value = this.source.slice(valueOffset, this.index).trim();
      if (!value) this.fail("value/empty", `Safe CSS property has an empty value: ${property}`, valueOffset);
      if (value.length > MAX_VALUE_CHARACTERS) {
        this.fail(
          "limit/value",
          `Safe CSS declaration value exceeds ${MAX_VALUE_CHARACTERS} characters`,
          valueOffset,
        );
      }
      if (!validatePropertyValue(property, value)) {
        this.fail("value/unsupported", `Safe CSS value is not allowed for ${property}`, valueOffset);
      }
      declarations.push({ property, value });
      count += 1;
      this.declarationCount += 1;
      if (this.declarationCount > MAX_DECLARATIONS) {
        this.fail("limit/declarations", `Safe CSS exceeds ${MAX_DECLARATIONS} declarations`, propertyOffset);
      }
      if (this.source[this.index] === ";") this.index += 1;
    }
  }

  parse() {
    this.skipWhitespace();
    while (this.index < this.source.length) {
      this.parseRule();
      this.skipWhitespace();
    }
    if (this.ruleCount === 0) this.fail("stylesheet/empty", "Safe CSS must contain at least one rule", 0);
    return {
      ruleCount: this.ruleCount,
      declarationCount: this.declarationCount,
      rules: this.rules,
    };
  }
}
