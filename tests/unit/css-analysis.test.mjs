import assert from 'node:assert/strict';
import test from 'node:test';
import { collectCssRules } from '../../scripts/lib/css-analysis.mjs';
import { renderUiBundle } from '../../scripts/build-ui-bundle.mjs';

test('CSS analysis preserves quoted delimiters, nested contexts and important flags', () => {
  const rules = collectCssRules('/* .fake { color: red } */ @media (width > 10px) { .a:is(.b, .c), [data-name="x,y"] { content: "};:"; color: var(--ink) ! /* reason */ important; } }');
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].selectors, ['.a:is(.b, .c)', '[data-name="x,y"]']);
  assert.equal(rules[0].context, '@media (width > 10px)');
  assert.deepEqual(rules[0].declarations.map(({ property, value, important }) => ({ property, value, important })), [
    { property: 'content', value: '"};:"', important: false },
    { property: 'color', value: 'var(--ink)', important: true },
  ]);
});

test('CSS analysis handles nesting and excludes animation steps from selector policies', () => {
  const rules = collectCssRules('.card { color: var(--ink); &:hover { opacity: .5 } } @keyframes spin { from { opacity: 0 } to { opacity: 1 } }');
  assert.deepEqual(rules.map(rule => rule.prelude), ['.card', '&:hover']);
  assert.equal(rules[1].context, '.card');
  assert.throws(() => collectCssRules('.broken { color: red', { filePath: 'broken.css' }), /broken\.css/);
});

test('bundle generation preserves source order and content without a copied source inventory', () => {
  const contents = new Map([['first.css', '  .a { content: "x;y"; }\r\n'], ['next.css', '.b { color: blue; }']]);
  const output = renderUiBundle(['next.css', 'first.css'], file => contents.get(file));
  assert.ok(output.indexOf('.b { color: blue; }') < output.indexOf('.a { content: "x;y"; }'));
  assert.match(output, /source-count: 2/);
  assert.ok(output.endsWith('\n\n'));
  assert.equal(output.includes('\r'), false);
  assert.match(renderUiBundle(['first.css'], file => contents.get(file), { modal: true }), /modal-source: first\.css/);
});
