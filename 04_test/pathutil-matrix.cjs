// pathutil-matrix.cjs — pathutil 路径矩阵定向验证（用 esbuild 把 TS 编译成 CJS 后实测）
const path = require('path');
const os = require('os');
const fs = require('fs');
const { buildSync } = require('../01_content/node_modules/esbuild');

const out = path.join(os.tmpdir(), 'wt-pathutil-' + process.pid + '.cjs');
buildSync({
  entryPoints: [path.join(__dirname, '..', '01_content', 'src', 'client', 'pathutil.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
});
const u = require(out);
fs.unlinkSync(out);

let fails = 0;
const eq = (label, got, want) => {
  if (got === want) { console.log('PASS ' + label + ' = ' + JSON.stringify(got)); }
  else { fails++; console.log('FAIL ' + label + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }
};

// joinPath：Windows 反斜杠风格 / Windows 正斜杠风格 / POSIX / 根目录 / 盘符根 / UNC / 相对
eq("join C:\\base+rel", u.joinPath('C:\\base', 'rel'), 'C:\\base\\rel');
eq("join C:/base+rel", u.joinPath('C:/base', 'rel'), 'C:/base/rel');
eq("join /Users+project", u.joinPath('/Users/name', 'project'), '/Users/name/project');
eq("join /+project", u.joinPath('/', 'project'), '/project');
eq("join C:\\+project", u.joinPath('C:\\', 'project'), 'C:\\project');
eq("join UNC+x", u.joinPath('\\\\server\\share', 'x'), '\\\\server\\share\\x');
eq("join rel+rel", u.joinPath('a/b', 'c'), 'a/b/c');
eq("join trim seps", u.joinPath('C:\\base\\', '\\rel\\'), 'C:\\base\\rel');

// isAbs
eq("isAbs C:\\x", u.isAbs('C:\\x'), true);
eq("isAbs C:/x", u.isAbs('C:/x'), true);
eq("isAbs /x", u.isAbs('/x'), true);
eq("isAbs UNC", u.isAbs('\\\\server\\share'), true);
eq("isAbs rel", u.isAbs('rel/x'), false);

// parentPathOf：POSIX 根 / 盘符根 / 根自身 / UNC / 相对
eq("parent /foo", u.parentPathOf('/foo'), '/');
eq("parent C:\\foo", u.parentPathOf('C:\\foo'), 'C:\\');
eq("parent C:\\", u.parentPathOf('C:\\'), 'C:\\');
eq("parent /", u.parentPathOf('/'), '/');
eq("parent UNC/x", u.parentPathOf('\\\\server\\share\\x'), '\\\\server\\share');
eq("parent a/b", u.parentPathOf('a/b'), 'a');

// basenameOf
eq("base a/b/c.html", u.basenameOf('a/b/c.html'), 'c.html');
eq("base C:\\x\\y.txt", u.basenameOf('C:\\x\\y.txt'), 'y.txt');

console.log(fails === 0 ? 'MATRIX ALL PASS' : 'MATRIX FAILS: ' + fails);
process.exit(fails === 0 ? 0 : 1);
