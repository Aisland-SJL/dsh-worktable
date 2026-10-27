import assert from 'node:assert/strict'
import { test, after, afterEach } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, renameSync, truncateSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
const require=createRequire(new URL('../01_content/package.json',import.meta.url))
const {build}=require('esbuild')
const temp=mkdtempSync(join(tmpdir(),'wt-preview-test-'))
after(()=>rmSync(temp,{recursive:true,force:true}))
// Instrument filesystem scheduling only in the test bundle; production has no hooks.
afterEach(()=>{ delete globalThis.__wtPreviewHooks })
await build({
  entryPoints:[fileURLToPath(new URL('../01_content/src/previewFiles.ts',import.meta.url))],
  bundle:true,platform:'node',format:'esm',outfile:join(temp,'preview.mjs'),
  plugins:[{name:'filesystem-race-fixture',setup(build){
    build.onResolve({filter:/^node:fs\/promises$/},args=>args.namespace==='race-fixture'?undefined:{path:args.path,namespace:'race-fixture'})
    build.onLoad({filter:/.*/,namespace:'race-fixture'},()=>({loader:'js',contents:`
      import * as fs from 'node:fs/promises';
      export const realpath=fs.realpath, stat=fs.stat;
      export async function open(...args) {
        await globalThis.__wtPreviewHooks?.beforeOpen?.();
        const h=await fs.open(...args);
        await globalThis.__wtPreviewHooks?.afterOpen?.();
        const read=h.read.bind(h);
        h.read=async(...args)=>{await globalThis.__wtPreviewHooks?.beforeRead?.();return read(...args)};
        return h;
      }`}))
  }}],
})
const {createPreviewFiles,PREVIEW_MAX_BYTES}=await import(pathToFileURL(join(temp,'preview.mjs')).href)
const root=join(temp,'root'),outside=join(temp,'outside');mkdirSync(root);mkdirSync(outside)
writeFileSync(join(root,'index.html'),'fixture');writeFileSync(join(outside,'outside.txt'),'outside')
test('Preview reads only its canonical root, including directory indexes',async()=>{
  const store=createPreviewFiles(),token=await store.mount(root)
  assert.equal((await store.file(token,[])).path,join(root,'index.html'))
  assert.equal(await store.file('invented-token',['index.html']),null)
  for(const parts of [['..','outside','outside.txt'],['..\\outside\\outside.txt'],['/outside'],['bad\0']]) assert.equal(await store.file(token,parts),null)
  symlinkSync(outside,join(root,'escape'),process.platform==='win32'?'junction':'dir')
  assert.equal(await store.file(token,['escape','outside.txt']),null)
  rmSync(join(root,'escape'))
})
test('Capabilities expire after idle time; revocation and disposal remove them',async()=>{
  let now=0;const store=createPreviewFiles(()=>now),a=await store.mount(root)
  now=29*60*1000;assert.ok(await store.file(a,['index.html']))
  now+=30*60*1000;assert.equal(await store.file(a,['index.html']),null)
  const b=await store.mount(root);store.revoke(b);assert.equal(await store.file(b,[]),null)
  const c=await store.mount(root);store.clear();assert.equal(await store.file(c,[]),null)
})
test('Reject relative roots and bound the live capability table',async()=>{
  const store=createPreviewFiles();await assert.rejects(store.mount('.'),/absolute/)
  for(let i=0;i<128;i++)await store.mount(root)
  await assert.rejects(store.mount(root),/Too many/)
})


test('Read content through the checked handle; HEAD omits the body and enforces the limit',async()=>{
  const store=createPreviewFiles(),token=await store.mount(root)
  assert.equal((await store.file(token,['index.html'])).data.toString(),'fixture')
  const head=await store.file(token,['index.html'],true)
  assert.equal(head.size,7);assert.equal(head.data,undefined)
  const large=join(root,'large.bin');writeFileSync(large,'x');truncateSync(large,PREVIEW_MAX_BYTES+1)
  await assert.rejects(store.file(token,['large.bin'],true),e=>e.status===413)
})

test('A directory replaced by a junction after path checking cannot return outside content',async()=>{
  const slot=join(root,'slot'),moved=join(root,'slot-original')
  mkdirSync(slot);writeFileSync(join(slot,'outside.txt'),'inside')
  const store=createPreviewFiles(),token=await store.mount(root)
  globalThis.__wtPreviewHooks={beforeOpen(){
    delete globalThis.__wtPreviewHooks
    renameSync(slot,moved);symlinkSync(outside,slot,process.platform==='win32'?'junction':'dir')
  }}
  try {assert.equal(await store.file(token,['slot','outside.txt']),null)}
  finally {unlinkSync(slot);renameSync(moved,slot)}
})

test('Replacing the named file after open rejects the response, even with an open old handle',async()=>{
  const name=join(root,'replace.txt'),old=join(root,'replace-original.txt')
  writeFileSync(name,'original')
  const store=createPreviewFiles(),token=await store.mount(root)
  globalThis.__wtPreviewHooks={afterOpen(){
    delete globalThis.__wtPreviewHooks
    renameSync(name,old);writeFileSync(name,'replacement')
  }}
  assert.equal(await store.file(token,['replace.txt']),null)
})

test('Growth after stat cannot produce a response over 40 MiB',async()=>{
  const name=join(root,'growing.bin');writeFileSync(name,'small')
  const store=createPreviewFiles(),token=await store.mount(root)
  globalThis.__wtPreviewHooks={beforeRead(){
    delete globalThis.__wtPreviewHooks
    truncateSync(name,PREVIEW_MAX_BYTES+1)
  }}
  await assert.rejects(store.file(token,['growing.bin']),e=>e.status===413)
})

test('Revocation during a pending read prevents the response',async()=>{
  const store=createPreviewFiles(),token=await store.mount(root)
  globalThis.__wtPreviewHooks={beforeRead(){
    delete globalThis.__wtPreviewHooks
    store.revoke(token)
  }}
  assert.equal(await store.file(token,['index.html']),null)
})
