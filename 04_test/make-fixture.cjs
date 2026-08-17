// 生成最小合法 PDF 测试夹具（单页 Hello，带正确 xref 偏移）
const fs = require('fs');
const objects = [
  '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
  '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
  '4 0 obj\n<< /Length 74 >>\nstream\nBT /F1 24 Tf 72 770 Td (Hello Worktable PDF) Tj ET\nendstream\nendobj\n',
  '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
];
let body = '%PDF-1.4\n';
const offsets = [0];
for (const o of objects) { offsets.push(body.length); body += o; }
const xrefPos = body.length;
body += 'xref\n0 ' + (objects.length + 1) + '\n';
body += '0000000000 65535 f \n';
for (let i = 1; i <= objects.length; i++) body += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
body += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\n';
body += 'startxref\n' + xrefPos + '\n%%EOF\n';
const out = 'E:/AI_Workspace/DeepseekHarness/Projects/dsh-worktable/04_test/fixture.pdf';
fs.writeFileSync(out, body, 'latin1');
console.log('fixture written', fs.statSync(out).size, 'bytes');
