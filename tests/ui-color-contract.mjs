import assert from 'node:assert/strict';

export function assertThemeReadability(styles) {
  const root = /:root\s*\{([\s\S]*?)\}/.exec(styles)?.[1];
  assert.ok(root, 'theme root exists');
  const values = new Map([...root.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
  const color = (name, seen = new Set()) => {
    assert.ok(!seen.has(name), `cyclic color alias ${name}`); seen.add(name);
    const value = values.get(name);
    const alias = /^var\((--[\w-]+)\)$/.exec(value ?? '');
    if (alias) return color(alias[1], seen);
    assert.match(value ?? '', /^#[\da-f]{6}$/i, `${name} must resolve to a concrete color`);
    return [1, 3, 5].map(index => Number.parseInt(value.slice(index, index + 2), 16));
  };
  const main = color('--color-text'), muted = color('--color-text-muted'), faint = color('--color-text-faint');
  assert.ok(luminance(faint) < luminance(muted) && luminance(muted) < luminance(main), 'faint/muted/primary establish a real luminance hierarchy');
  assert.ok(Math.max(...faint) - Math.min(...faint) <= 48, 'faint text remains a neutral semantic color');
  for (const role of ['--color-accent', '--color-danger', '--color-warning']) assert.notDeepEqual(faint, color(role), 'metadata cannot masquerade as an accent or alert');
  const surfaces = ['--color-canvas', '--color-surface-1', '--color-surface-2', '--color-surface-3', '--color-surface-raised', '--color-surface-hover'];
  for (const surface of surfaces) for (const text of [main, muted, faint]) assert.ok(contrast(text, color(surface)) >= 4.5, `AA text contrast on ${surface}`);
  const alpha = name => { const n = Number(values.get(name)); assert.ok(Number.isFinite(n) && n >= 0 && n <= 1, `bounded alpha ${name}`); return n; };
  const highlight = (values.get('--color-control-highlight-rgb') ?? '').split(/\s+/).map(Number);
  assert.equal(highlight.length, 3); assert.ok(highlight.every(n => Number.isInteger(n) && n >= 0 && n <= 255));
  for (const surface of ['--color-accent-strong', '--color-accent-hover']) {
    const background = mix(highlight, mix(highlight, color(surface), alpha('--control-sheen-opacity')), alpha('--control-sweep-opacity'));
    assert.ok(contrast(mix(highlight, color('--color-text-on-accent'), alpha('--control-sweep-opacity')), background) >= 4.5, 'stacked primary-button highlight peaks retain AA');
  }
  assert.match(styles, /\.action-complete-button\s*\{[^}]*color:\s*var\(--color-text-faint\)/, 'the action affordance follows the semantic metadata color');
  return { faint: '#' + faint.map(n => n.toString(16).padStart(2, '0')).join(''), minimum: 4.5 };
}

function mix(foreground, background, alpha) { return foreground.map((n, index) => Math.round(n * alpha + background[index] * (1 - alpha))); }
function luminance(rgb) { const [r, g, b] = rgb.map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b; }
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
