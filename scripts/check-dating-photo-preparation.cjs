/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const limit = 10 * 1024 * 1024;
function fixture(options = {}) {
  const images = [], revoked = [], timers = new Map(), canvases = [], qualities = [];
  let timerId = 0;
  class Image {
    constructor() { this.naturalWidth = options.width ?? 4000; this.naturalHeight = options.height ?? 3000; images.push(this); }
    set src(value) { this.url = value; if (value && !options.hold) queueMicrotask(() => options.fail ? this.onerror?.() : this.onload?.()); }
  }
  const document = { createElement(tag) {
    assert.equal(tag, 'canvas');
    const canvas = { width: 0, height: 0,
      getContext: () => options.noContext ? null : ({ fillRect() {}, drawImage() {}, fillStyle: '' }),
      toBlob(callback, type, quality) {
        assert.equal(type, 'image/jpeg'); qualities.push(quality);
        canvas.drawnSize = [canvas.width, canvas.height];
        if (options.throwEncode) throw Error('encode unavailable');
        if (!options.holdBlob) callback(options.nullBlob ? null : new Blob([options.blobSizes ? new Uint8Array(options.blobSizes[Math.min(qualities.length - 1, options.blobSizes.length - 1)]) : 'jpeg'], { type: options.wrongMime ? 'image/png' : 'image/jpeg' }));
      },
    };
    canvases.push(canvas); return canvas;
  } };
  const mod = { exports: {} };
  const js = ts.transpileModule(read('lib/dating-photo-preparation.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'Image', 'document', 'URL', 'setTimeout', 'clearTimeout', 'File', js)(
    mod.exports, Image, document, { createObjectURL: () => 'blob:fixture', revokeObjectURL: url => revoked.push(url) },
    fn => { timers.set(++timerId, fn); return timerId; }, id => timers.delete(id),
    options.failFile ? class { constructor() { throw Error('allocation failed'); } } : File);
  return { ...mod.exports, images, canvases, revoked, qualities, expire: () => [...timers.values()].forEach(fn => fn()), timers };
}
const heic = () => new File(['fixture'], '사진.HEIC', { type: 'image/heic', lastModified: 123 });
for (const type of ['jpeg', 'png', 'webp']) test(type + ' is returned unchanged without decoding/network', async () => {
  const f = fixture(), file = new File(['image'], 'photo.' + type, { type: 'image/' + type });
  assert.equal(await f.prepareDatingPhoto(file, limit), file); assert.equal(f.images.length, 0);
});
test('HEIC detection handles uppercase, empty MIME and HEIF MIME', () => {
  const f = fixture();
  assert.ok(f.isHeicPhoto(new File(['x'], 'PHOTO.HEIF')));
  assert.ok(f.isHeicPhoto(new File(['x'], 'photo', { type: 'image/heif' })));
  assert.ok(!f.isHeicPhoto(new File(['x'], 'HEIC.jpg', { type: 'image/jpeg' })));
});
test('successful conversion is a bounded JPEG with matching extension; resources released', async () => {
  const f = fixture(), file = await f.prepareDatingPhoto(heic(), limit);
  assert.equal(file.type, 'image/jpeg'); assert.equal(file.name, '사진.jpg'); assert.equal(file.lastModified, 123);
  assert.deepEqual(f.canvases[0].drawnSize, [1600, 1200]);
  assert.deepEqual(f.revoked, ['blob:fixture']); assert.equal(f.canvases[0].width, 0); assert.equal(f.timers.size, 0);
});
test('portrait aspect ratio is preserved without enlarging images', async () => {
  const f = fixture({ width: 600, height: 800 }); await f.prepareDatingPhoto(heic(), limit);
  assert.deepEqual(f.canvases[0].drawnSize, [600, 800]);
});
for (const type of ['jpeg', 'png', 'webp']) test('large '+type+' is reduced below multipart transport budget', async () => {
  const f=fixture(),file=new File([new Uint8Array(5*1024*1024)],'large.'+type,{type:'image/'+type});
  const result=await f.prepareDatingPhoto(file,limit);
  assert.equal(result.type,'image/jpeg');assert.equal(result.name,'large.jpg');
  assert.ok(result.size<=f.DATING_PHOTO_UPLOAD_MAX_BYTES);assert.deepEqual(f.canvases[0].drawnSize,[1600,1200]);
  assert.deepEqual(f.qualities,[0.88]);assert.equal(f.revoked.length,1);
});
test('transport boundary passes unchanged; one byte over must encode', async()=>{
  const f=fixture(),max=f.DATING_PHOTO_UPLOAD_MAX_BYTES;
  const small=new File([new Uint8Array(max)],'photo.jpg',{type:'image/jpeg'});
  assert.equal(await f.prepareDatingPhoto(small,limit),small);
  assert.notEqual(await f.prepareDatingPhoto(new File([new Uint8Array(max+1)],'photo.jpg',{type:'image/jpeg'}),limit),small);
  assert.equal(f.images.length,1);
});
for(const type of ['', 'application/octet-stream'])test('missing/non-image MIME is decoded instead of rejected downstream: '+type,async()=>{
  const f=fixture(),file=await f.prepareDatingPhoto(new File(['jpeg'],'phone.JPG',{type}),limit);
  assert.equal(file.type,'image/jpeg');assert.equal(file.name,'phone.jpg');assert.equal(f.images.length,1);
});
test('encoding retries are bounded and never return an oversized payload',async()=>{
  const max=3*1024*1024;
  const f=fixture({blobSizes:[max+1,max+1,100]});
  assert.equal((await f.prepareDatingPhoto(heic(),limit)).size,100);assert.deepEqual(f.qualities,[0.88,0.78,0.68]);
  const broken=fixture({blobSizes:[max+1]});
  await assert.rejects(broken.prepareDatingPhoto(heic(),limit),/용량/);assert.equal(broken.qualities.length,3);assert.equal(broken.revoked.length,1);
});
test('large regular-photo failures do not misleadingly blame HEIC',async()=>{
  for(const options of [{fail:true},{throwEncode:true}]){
    const f=fixture(options),file=new File([new Uint8Array(4*1024*1024)],'large.jpg',{type:'image/jpeg'});
    await assert.rejects(f.prepareDatingPhoto(file,limit),error=>!error.message.includes('HEIC'));
    assert.equal(f.revoked.length,1);assert.equal(f.timers.size,0);
  }
});
for (const options of [{ fail: true }, { noContext: true }, { nullBlob: true }, { wrongMime: true }, { failFile: true }, { width: 0 }, { width: 10000, height: 10000 }]) {
  test('conversion failure cleans up: ' + JSON.stringify(options), async () => {
    const f = fixture(options);
    await assert.rejects(f.prepareDatingPhoto(heic(), limit));
    assert.deepEqual(f.revoked, ['blob:fixture']); assert.equal(f.timers.size, 0);
  });
}
for (const options of [{ hold: true }, { holdBlob: true }]) test('timeout covers decode and encoding ' + JSON.stringify(options), async () => {
  const f = fixture(options), promise = f.prepareDatingPhoto(heic(), limit);
  await Promise.resolve(); f.expire();
  await assert.rejects(promise, /HEIC/); assert.equal(f.revoked.length, 1); assert.equal(f.timers.size, 0);
});
test('aborted conversion does not resolve later', async () => {
  const f = fixture({ hold: true }), controller = new AbortController();
  const promise = f.prepareDatingPhoto(heic(), limit, controller.signal), lateLoad = f.images[0].onload;
  controller.abort(); lateLoad();
  await assert.rejects(promise, { name: 'AbortError' }); assert.equal(f.canvases.length, 0);
});
test('empty, oversized and unrelated files rejected before decoding', async () => {
  const f = fixture();
  for (const file of [new File([], 'empty.jpg'), new File(['x'], 'script.svg', { type: 'image/svg+xml' }), { size: limit + 1, type: 'image/heic', name: 'large.heic' }]) {
    await assert.rejects(f.prepareDatingPhoto(file, limit));
  }
  assert.equal(f.images.length, 0);
});
test('all five forms use preparation and block submit while it is running', () => {
  for (const file of ['app/onboarding/dating/page.tsx', 'app/dating/1on1/page.tsx', 'app/dating/paid/page.tsx',
    'app/community/dating/cards/new/page.tsx', 'app/community/dating/cards/[id]/apply/page.tsx']) {
    const text = read(file);
    assert.match(text, /useDatingPhotoPreparation\(/, file);
    assert.match(text, /photoPreparation\.isProcessing\(\)/, file);
    assert.match(text, /accept=\{DATING_PHOTO_ACCEPT\}/, file);
    assert.match(text, /PhotoPreparationStatus/, file);
  }
});
test('photo selection is latest-only, cancellable and cannot clear form fields on failure', () => {
  const hook = read('lib/use-dating-photo-preparation.ts');
  assert.match(hook, /active\.current\.get\(slot\) === controller/);
  assert.match(hook, /if \(!file\) return/);
  assert.match(hook, /if \(isCurrent\(\)\) commit\(prepared\)/);
  assert.doesNotMatch(hook, /fetch\(|localStorage|setPhotos|setIntro|setName/);
});
