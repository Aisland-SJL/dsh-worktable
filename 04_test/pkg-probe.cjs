
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');
function tryResolve(fromDir, pkg) {
  try {
    const req = createRequire(pathToFileURL(fromDir.replace(/\\/g,'/') + '/__probe__.js').href);
    return req.resolve(pkg);
  } catch (e) { return null; }
}
console.log('--- 沿 junction 链 ---');
let d = 'C:/Users/SJL/.dsh/profiles/web/node_modules/dsh-worktable/lib';
while (true) {
  const r = tryResolve(d, 'ws');
  if (r) { console.log('FOUND at', d, '->', r); break; }
  const parent = d.replace(/[\\/][^\\/]+$/, '');
  if (!parent || parent === d) { console.log('链走完未找到'); break; }
  d = parent;
}
console.log('--- homedir profiles 兜底 ---');
const pd = path.resolve(os.homedir(), '.dsh', 'profiles');
console.log('profilesDir:', pd, 'exists:', fs.existsSync(pd));
for (const p of fs.readdirSync(pd, { withFileTypes: true })) {
  const nm = path.resolve(pd, p.name, 'node_modules');
  console.log(p.name, 'isDir:', p.isDirectory(), 'nmExists:', fs.existsSync(nm), 'ws:', tryResolve(nm, 'ws'), 'pty:', tryResolve(nm, 'node-pty'));
}
