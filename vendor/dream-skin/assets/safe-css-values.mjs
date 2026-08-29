function splitTopLevel(value, separator) {
  const output = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === separator && depth === 0) {
      output.push(value.slice(start, index).trim());
      start = index + 1;
    }
    if (depth < 0) return null;
  }
  if (depth !== 0) return null;
  output.push(value.slice(start).trim());
  return output;
}

function splitWhitespace(value) {
  const output = [];
  let start = -1;
  let depth = 0;
  for (let index = 0; index <= value.length; index += 1) {
    const char = value[index] ?? " ";
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    const whitespace = SAFE_WHITESPACE.has(char);
    if (start === -1 && !whitespace) start = index;
    if (start !== -1 && whitespace && depth === 0) {
      output.push(value.slice(start, index));
      start = -1;
    }
    if (depth < 0) return null;
  }
  return depth === 0 ? output : null;
}

function numeric(value, min, max, unit = "") {
  const pattern = new RegExp(`^(?:${SIGNED_NUMBER})${unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  if (!pattern.test(value)) return false;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

function zeroOrPx(value, min, max) {
  return value === "0" || numeric(value, min, max, "px");
}

function registeredVar(value, allowed = VARIABLES) {
  const match = value.match(VAR_FUNCTION);
  return Boolean(match && allowed.has(match[1]));
}

function colorChannel(value) {
  if (/%$/.test(value)) return numeric(value.slice(0, -1), 0, 100);
  return /^(?:0|[1-9][0-9]{0,2})$/.test(value) && Number(value) <= 255;
}

function alphaChannel(value) {
  if (/%$/.test(value)) return numeric(value.slice(0, -1), 0, 100);
  return numeric(value, 0, 1);
}

function colorValue(value, property) {
  if (registeredVar(value, COLOR_VARIABLES)) return true;
  if (HEX_COLOR.test(value)) return true;
  const keyword = value.toLowerCase();
  if (keyword === "currentcolor") return true;
  if (keyword === "transparent") return property !== "color";
  const functionMatch = value.match(/^(rgb|rgba)\((.*)\)$/i);
  if (!functionMatch) return false;
  const components = splitTopLevel(functionMatch[2], ",");
  const expected = functionMatch[1].toLowerCase() === "rgb" ? 3 : 4;
  if (!components || components.length !== expected) return false;
  return components.slice(0, 3).every(colorChannel)
    && (expected === 3 || alphaChannel(components[3]));
}

function repeatedValues(value, minimum, maximum, validator) {
  const values = splitWhitespace(value);
  return Boolean(
    values
    && values.length >= minimum
    && values.length <= maximum
    && values.every(validator),
  );
}

function shadowValue(value) {
  if (value.toLowerCase() === "none") return true;
  const shadows = splitTopLevel(value, ",");
  if (!shadows || shadows.length < 1 || shadows.length > 2) return false;
  return shadows.every((shadow) => {
    const values = splitWhitespace(shadow);
    if (!values) return false;
    if (values[0]?.toLowerCase() === "inset") values.shift();
    if (values.length < 3 || values.length > 5) return false;
    const color = values.pop();
    if (!colorValue(color, "box-shadow")) return false;
    if (values.length < 2 || values.length > 4) return false;
    if (!zeroOrPx(values[0], -32, 32) || !zeroOrPx(values[1], -32, 32)) return false;
    if (values[2] !== undefined && !zeroOrPx(values[2], 0, 48)) return false;
    return values[3] === undefined || zeroOrPx(values[3], -8, 16);
  });
}

function fontFamilyValue(value) {
  const families = splitTopLevel(value, ",");
  const allowed = new Set([
    "system-ui",
    "-apple-system",
    "blinkmacsystemfont",
    "ui-sans-serif",
    "ui-rounded",
    "ui-serif",
    "ui-monospace",
    "sans-serif",
    "serif",
    "monospace",
  ]);
  return Boolean(families && families.length <= 4
    && families.every((family) => allowed.has(family.toLowerCase())));
}

function transitionDurationValue(value) {
  const durations = splitTopLevel(value, ",");
  return Boolean(durations && durations.length <= 4 && durations.every((duration) => {
    if (duration === "0") return true;
    if (/ms$/i.test(duration)) return numeric(duration.slice(0, -2), 0, 400);
    if (/s$/i.test(duration)) return numeric(duration.slice(0, -1), 0, 0.4);
    return false;
  }));
}

function transitionPropertyValue(value) {
  const properties = splitTopLevel(value, ",");
  return Boolean(properties && properties.length <= 4
    && properties.every((property) => TRANSITION_TARGETS.has(property.toLowerCase())));
}

function backdropFilterValue(value) {
  if (value.toLowerCase() === "none") return true;
  const filters = splitWhitespace(value);
  if (!filters || filters.length < 1 || filters.length > 4) return false;
  const seen = new Set();
  for (let index = 0; index < filters.length; index += 1) {
    const match = filters[index].match(FILTER_FUNCTION);
    if (!match) return false;
    const name = match[1].toLowerCase();
    const argument = match[2].trim();
    if (seen.has(name)) return false;
    seen.add(name);
    if (name === "blur") {
      if (index !== 0 || !(
        registeredVar(argument, new Set(["--ds-theme-surface-blur"]))
        || zeroOrPx(argument, 0, 30)
      )) return false;
    } else if (name === "saturate") {
      if (!numeric(argument, 0.5, 2)) return false;
    } else if (name === "brightness" || name === "contrast") {
      if (!numeric(argument, 0.8, 1.5)) return false;
    } else {
      return false;
    }
  }
  return seen.has("blur");
}

export function validatePropertyValue(property, value) {
  if (COLOR_PROPERTIES.has(property)) return colorValue(value, property);
  if (WIDTH_PROPERTIES.has(property)) return repeatedValues(value, 1, 4, (item) => zeroOrPx(item, 0, 4));
  if (STYLE_PROPERTIES.has(property)) {
    return repeatedValues(value, 1, 4, (item) => ["none", "solid", "dashed", "dotted"].includes(item.toLowerCase()));
  }
  if (RADIUS_PROPERTIES.has(property)) {
    if (registeredVar(value, new Set(["--ds-theme-surface-radius"]))) return true;
    return repeatedValues(value, 1, 4, (item) => zeroOrPx(item, 0, 28));
  }
  if (SPACING_PROPERTIES.has(property)) return zeroOrPx(value, 0, 24);
  if (property === "box-shadow") return shadowValue(value);
  if (property === "opacity") {
    return registeredVar(value, new Set(["--ds-theme-surface-opacity"])) || numeric(value, 0.65, 1);
  }
  if (property === "backdrop-filter") return backdropFilterValue(value);
  if (property === "font-family") return fontFamilyValue(value);
  if (property === "font-size") return numeric(value, 12, 20, "px");
  if (property === "font-weight") return /^(?:400|500|600|700|normal|bold)$/i.test(value);
  if (property === "line-height") return numeric(value, 1.1, 1.8);
  if (property === "letter-spacing") return value === "0" || numeric(value, 0, 2, "px");
  if (property === "transition-duration") return transitionDurationValue(value);
  if (property === "transition-property") return transitionPropertyValue(value);
  return false;
}
import {
  COLOR_PROPERTIES,
  COLOR_VARIABLES,
  FILTER_FUNCTION,
  HEX_COLOR,
  RADIUS_PROPERTIES,
  SAFE_WHITESPACE,
  SIGNED_NUMBER,
  SPACING_PROPERTIES,
  STYLE_PROPERTIES,
  TRANSITION_TARGETS,
  VARIABLES,
  VAR_FUNCTION,
  WIDTH_PROPERTIES,
} from "./safe-css-contract.mjs";
