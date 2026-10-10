/* eslint-disable @typescript-eslint/no-require-imports */
const ts = require('typescript');
module.exports = function (source) {
  const preserveHomeLazy = this.getOptions?.().preserveHomeLazy === true;
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    // Unchanged lazy admin/payment widgets are outside this presentation fixture.
    transformers: { before: [context => {
      const visit = node => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'dynamic') {
          if (node.arguments[0]?.getText().includes('@/components/dating/OneOnOneHomePanel')) {
            if (preserveHomeLazy) return node;
            // Existing behavior fixtures still render the real extracted panel.
            // The home-performance browser suite separately verifies lazy chunk loading.
            return ts.factory.createPropertyAccessExpression(ts.factory.createCallExpression(
              ts.factory.createIdentifier('require'), undefined,
              [ts.factory.createStringLiteral('@/components/dating/OneOnOneHomePanel')]), 'default');
          }
          return ts.factory.createArrowFunction(undefined, undefined, [], undefined,
            ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), ts.factory.createNull());
        }
        return ts.visitEachChild(node, visit, context);
      };
      return node => ts.visitNode(node, visit);
    }] },
  }).outputText;
};
