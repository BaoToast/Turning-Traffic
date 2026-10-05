/* 文件條數守門：語法樹辨識直接 test() 呼叫，不將字串或正規式當註解。 */
import ts from 'typescript';
export function countTestCalls(source,filename='test.mjs'){
 const file=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,
   filename.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
 if(file.parseDiagnostics.length)throw new Error(`Cannot parse test source: ${filename}`);
 let count=0;
 const visit=node=>{
   if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='test')count++;
   ts.forEachChild(node,visit);
 };
 visit(file);
 return count;
}
