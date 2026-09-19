/* eslint-disable @typescript-eslint/no-require-imports */
const ts = require('typescript');
module.exports = function (source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    // Unchanged lazy admin/payment widgets are outside this presentation fixture.
    transformers: { before: [context => {
      const visit = node => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'dynamic') {
          return ts.factory.createArrowFunction(undefined, undefined, [], undefined,
            ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), ts.factory.createNull());
        }
        return ts.visitEachChild(node, visit, context);
      };
      return node => ts.visitNode(node, visit);
    }] },
  }).outputText;
};
