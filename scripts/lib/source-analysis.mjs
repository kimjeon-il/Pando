import { Linter } from 'eslint';

export function parseJavaScript(source, { filePath = 'source.js', sourceType = 'module' } = {}) {
  const linter = new Linter();
  const messages = linter.verify(source, { languageOptions: { ecmaVersion: 'latest', sourceType } });
  const failure = messages.find(message => message.fatal);
  const code = linter.getSourceCode();
  if (failure || !code) throw new SyntaxError(`${filePath}: ${failure?.message || 'JavaScript parsing failed'}`);
  return code;
}

export function walkJavaScript(sourceCode, visitor) {
  const visit = node => {
    if (!node) return;
    visitor(node);
    for (const key of sourceCode.visitorKeys[node.type] || []) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  };
  visit(sourceCode.ast);
}
