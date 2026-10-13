import postcss from 'postcss';

export function collectCssRules(source, { filePath = 'stylesheet.css' } = {}) {
  const rules = [];
  const tree = postcss.parse(source, { from: filePath });
  tree.walk(node => {
    if (!['rule', 'atrule'].includes(node.type)) return;
    const ancestors = [];
    for (let parent = node.parent; parent && parent.type !== 'root'; parent = parent.parent) ancestors.unshift(parent);
    if (ancestors.some(parent => parent.type === 'atrule' && /(?:^|-)keyframes$/i.test(parent.name))) return;
    const declarations = (node.nodes || []).filter(child => child.type === 'decl').map(child => ({
      property: child.prop.toLowerCase(), value: child.value, important: Boolean(child.important), line: child.source.start.line,
    }));
    if (node.type === 'atrule' && !declarations.length) return;
    const prelude = item => item.type === 'atrule' ? `@${item.name} ${item.params}`.trim() : item.selector;
    rules.push({ prelude: prelude(node), selectors: node.type === 'rule' ? node.selectors : [],
      context: ancestors.map(prelude).join(' > '), declarations });
  });
  return rules;
}
