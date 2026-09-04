import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPaintStyle,
  effectivePaintBackground,
} from "../regression/visual-paint.mjs";

const style = (backgroundColor, backgroundImage = "none") => ({
  backgroundColor, backgroundImage,
});

test("visual paint classifies theme, transparent, black, and missing surfaces", () => {
  assert.equal(classifyPaintStyle(style("rgba(0, 0, 0, 0)")), "transparent");
  assert.equal(classifyPaintStyle(style("rgb(17, 17, 17)")), "opaque-black");
  assert.equal(classifyPaintStyle(style("rgb(30, 40, 50)")), "theme");
  assert.equal(classifyPaintStyle(style("rgba(0, 0, 0, 0)", "linear-gradient(red, blue)")), "theme");
  assert.equal(classifyPaintStyle(null, { missing: "missing" }), "missing");
});

test("transparent composer content inherits its isolated paint plane classification", () => {
  assert.equal(effectivePaintBackground(
    style("rgba(0, 0, 0, 0)"),
    style("rgba(11, 36, 42, 0.76)"),
  ), "theme");
  assert.equal(effectivePaintBackground(
    style("rgb(17, 17, 17)"),
    style("rgba(11, 36, 42, 0.76)"),
  ), "opaque-black");
});
