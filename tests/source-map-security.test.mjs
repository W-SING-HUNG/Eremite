import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Bound execution even if a future dependency change reintroduces synchronous DoS.
if (!process.argv.includes("--worker")) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--worker"], {
    encoding: "utf8", timeout: 10_000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  console.log(result.stdout.trim());
} else {
  const require = createRequire(import.meta.url);
  // Resolve through the actual Next -> PostCSS dependency path, including nesting.
  const fromNext = createRequire(require.resolve("next/package.json"));
  const fromPostcss = createRequire(fromNext.resolve("postcss/package.json"));
  const { SourceMapConsumer, SourceMapGenerator, SourceNode } = fromPostcss("source-map-js");
  const postcss = fromNext("postcss");
  const flat = { version: 3, sources: ["input.css"], names: [], mappings: "AAAA", sourcesContent: ["a { color: red }"] };
  const indexed = (line, column = 0, map = flat) => ({ version: 3, sections: [{ offset: { line, column }, map }] });

  for (const value of [-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    for (const field of ["line", "column"]) {
      const map = indexed(0);
      map.sections[0].offset[field] = value;
      assert.throws(() => new SourceMapConsumer(map), /non-negative integers/, `invalid ${field}: ${value}`);
    }
  }
  assert.throws(() => new SourceMapConsumer(indexed(10_000_001)), /must not exceed/);
  assert.throws(() => new SourceMapConsumer(indexed(6_000_000, 0, indexed(6_000_000))), /including offsets of nested sections/);

  const consumer = new SourceMapConsumer(indexed(2));
  assert.equal(consumer.originalPositionFor({ line: 3, column: 1 }).source, "input.css");
  const node = SourceNode.fromStringWithSourceMap("\n\na { color: red }", consumer);
  assert.equal(node.toString(), "\n\na { color: red }");
  const roundTrip = node.toStringWithSourceMap({ file: "output.css" });
  assert.equal(new SourceMapConsumer(roundTrip.map.toJSON()).originalPositionFor({ line: 3, column: 0 }).line, 1);
  const generator = SourceMapGenerator.fromSourceMap(new SourceMapConsumer(flat));
  generator.addMapping({ generated: { line: 10_001, column: 0 }, original: { line: 1, column: 0 }, source: "input.css" });
  assert.equal((generator.toJSON().mappings.match(/;/g) ?? []).length, 10_000);

  // A valid but distant mapping must not make SourceNode walk empty code lines.
  assert.equal(SourceNode.fromStringWithSourceMap("x", new SourceMapConsumer(indexed(10_000_000))).toString(), "x");
  const transform = { postcssPlugin: "security-regression", Declaration(decl) { if (decl.prop === "color") decl.value = "blue"; } };
  const result = postcss([transform]).process(flat.sourcesContent[0], {
    from: "input.css", to: "output.css", map: { inline: false, annotation: false, prev: flat },
  });
  assert.match(result.css, /color: blue/);
  const cssMap = new SourceMapConsumer(result.map.toJSON());
  assert.equal(cssMap.originalPositionFor({ line: 1, column: 4 }).line, 1);
  assert.equal(cssMap.sourceContentFor(cssMap.sources[0]), flat.sourcesContent[0]);
  assert.throws(() => postcss([transform]).process("a { color: red }", {
    from: "input.css", to: "output.css", map: { inline: false, prev: indexed(10_000_001) },
  }).css, /must not exceed/);
  console.log("Source-map security regression passed: invalid and nested offsets reject; SourceNode, generator and PostCSS mappings remain functional.");
}
