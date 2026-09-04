function parseSafeCss(source, options = {}) {
  if (typeof source !== "string") {
    throw new TypeError("Safe CSS source must be a string");
  }
  const maxBytes = options.maxBytes ?? MAX_SAFE_CSS_BYTES;
  const bytes = new TextEncoder().encode(source).length;
  if (bytes < 1 || bytes > maxBytes) {
    throw new SafeCssValidationError(
      "limit/bytes",
      `Safe CSS must be between 1 and ${maxBytes} UTF-8 bytes`,
      1,
      1,
    );
  }
  const forbidden = source.search(FORBIDDEN_CONTROL);
  if (forbidden !== -1) {
    const parser = new Parser(source);
    parser.fail("syntax/control", "Safe CSS contains a forbidden control character", forbidden);
  }
  const comment = source.indexOf("/*");
  if (comment !== -1 || source.includes("*/")) {
    const parser = new Parser(source);
    parser.fail("syntax/comment", "Safe CSS comments are not allowed", comment === -1 ? source.indexOf("*/") : comment);
  }
  const escape = source.indexOf("\\");
  if (escape !== -1) {
    const parser = new Parser(source);
    parser.fail("syntax/escape", "Safe CSS escapes are not allowed", escape);
  }
  const parser = new Parser(source);
  return { bytes, ...parser.parse() };
}

function validationResult(parsed) {
  return Object.freeze({
    contract: "dreamskin-safe-css/1",
    status: "validated",
    bytes: parsed.bytes,
    ruleCount: parsed.ruleCount,
    declarationCount: parsed.declarationCount,
  });
}

function compileRuntimeCss(parsed) {
  const compiledRules = [];
  for (const { selector: selectorRecord, declarations } of parsed.rules) {
    const { part, selector } = selectorRecord;
    const runtimeDeclarations = [];
    for (const declaration of declarations) {
      runtimeDeclarations.push(declaration);
      if (
        declaration.property === "background-color"
        && CORE_BACKGROUND_IMAGE_PARTS.has(part)
      ) {
        runtimeDeclarations.push({ property: "background-image", value: "none" });
      }
    }
    const body = runtimeDeclarations
      .map(({ property, value }) => `    ${property}: ${value} !important;`)
      .join("\n");
    compiledRules.push(`  ${selector} {\n${body}\n  }`);

    if (part === "root") {
      const bodyDeclarations = [];
      for (const declaration of declarations) {
        if (![
          "background-color", "color", "font-family", "font-size", "font-weight",
          "letter-spacing", "line-height",
        ].includes(declaration.property)) continue;
        bodyDeclarations.push(declaration);
      }
      if (bodyDeclarations.length > 0) {
        const bodyBridge = bodyDeclarations
          .map(({ property, value }) => `    ${property}: ${value} !important;`)
          .join("\n");
        compiledRules.push(`  ${selector} body {\n${bodyBridge}\n  }`);
      }
    }

    const toolbarColor = part === "composer-toolbar"
      ? declarations.find(({ property }) => property === "color") : null;
    if (toolbarColor) {
      const controls = `${selector} :where(button:not([class~="bg-token-foreground"]), ` +
        `button:not([class~="bg-token-foreground"]) *)`;
      compiledRules.push(`  ${controls} {\n    color: ${toolbarColor.value} !important;\n  }`);
    }
  }
  const rules = compiledRules.join("\n");
  return `@layer ${RUNTIME_CASCADE_LAYER} {\n${rules}\n}\n`;
}

export function validateSafeCss(source, options = {}) {
  return validationResult(parseSafeCss(source, options));
}

export function compileSafeCss(source, options = {}) {
  return compileRuntimeCss(parseSafeCss(source, options));
}

export function decodeAndValidateSafeCss(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Safe CSS bytes must be a Uint8Array");
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SafeCssValidationError("syntax/utf8", "Safe CSS is not valid UTF-8", 1, 1);
  }
  const parsed = parseSafeCss(source, options);
  return {
    source,
    runtimeSource: compileRuntimeCss(parsed),
    validation: validationResult(parsed),
  };
}

export const SAFE_CSS_CONTRACT = Object.freeze({
  contract: "dreamskin-safe-css/1",
  maxBytes: MAX_SAFE_CSS_BYTES,
  maxRules: MAX_RULES,
  maxDeclarations: MAX_DECLARATIONS,
  maxValueCharacters: MAX_VALUE_CHARACTERS,
  parts: SAFE_CSS_PARTS,
  states: SAFE_CSS_STATES,
  variables: SAFE_CSS_VARIABLES,
  properties: Object.freeze([...SAFE_PROPERTIES].sort()),
});
import {
  CORE_BACKGROUND_IMAGE_PARTS,
  FORBIDDEN_CONTROL,
  MAX_DECLARATIONS,
  MAX_RULES,
  MAX_SAFE_CSS_BYTES,
  MAX_VALUE_CHARACTERS,
  RUNTIME_CASCADE_LAYER,
  SAFE_CSS_PARTS,
  SAFE_CSS_STATES,
  SAFE_CSS_VARIABLES,
  SAFE_PROPERTIES,
  SafeCssValidationError,
} from "./safe-css-contract.mjs";
import { Parser } from "./safe-css-parser.mjs";
