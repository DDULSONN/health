/* eslint-disable @typescript-eslint/no-require-imports */
// Actual onboarding page + hook + canvas in a fake-service host. No real accounts/uploads.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { startPreview } = require('./preview-profile-writing.cjs');
const { chromium } = require('./test-browser-runtime.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const { server, origin, output } = await startPreview();
  let browser, passed = 0, geometryChecks = 0;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [360, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        assert.equal(url.origin, origin, 'external requests forbidden');
        assert.ok(request.method() === 'GET' || url.pathname === '/api/analytics/onboarding', 'no uploads, registration or purchases');
        return route.continue();
      });
      await context.addInitScript(() => {
        localStorage.setItem('gymtools:dating-onboarding-draft:v1:fixture-member', JSON.stringify({
          version: 1, userId: 'fixture-member', savedAt: Date.now(), step: 3, targets: { open: true, oneOnOne: true },
          fields: { nickname: '테스트', sex: 'female', name: '테스트이름', birthYear: '1996', heightCm: '165',
            job: '회사원', region: '서울', introText: '보존해야 할 한글 소개', strengthsText: '약속을 잘 지켜요.',
            preferredPartnerText: '다정한 분', smoking: 'non_smoker', workoutFrequency: '3_4', trainingYears: '1',
            instagramId: 'fixture.test', total3Lift: '', photoVisibility: 'blur' },
        }));
        window.fixtureFiles = [];
        const create = URL.createObjectURL.bind(URL);
        const blobs = new Map();
        URL.createObjectURL = file => {
          const url = create(file); blobs.set(url, file.name);
          window.fixtureFiles.push({ name: file.name, type: file.type, file }); return url;
        };
        // Deterministic slow decoder for race/submit checks; does not simulate HEIC codec support.
        const NativeImage = window.Image, descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
        window.Image = function () {
          const img = new NativeImage();
          let timer;
          Object.defineProperty(img, 'src', { get() { return descriptor.get.call(img); }, set(value) {
            clearTimeout(timer);
            if (blobs.get(value) === 'slow.heic') timer = setTimeout(() => descriptor.set.call(img, value), 700);
            else descriptor.set.call(img, value);
          } });
          return img;
        };
      });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/onboarding/dating');
      await page.getByRole('button', { name: '이어서 작성', exact: true }).click();
      await page.getByRole('heading', { name: '사진 두 장', exact: true }).waitFor();
      const first = page.getByLabel('사진 1', { exact: true }), second = page.getByLabel('사진 2', { exact: true });
      const buffer = fs.readFileSync(path.join(root, 'public/mascot/jimnyang-guide-v2.png'));
      const png = name => ({ name, mimeType: 'image/png', buffer });
      await first.setInputFiles(png('first.png')); await second.setInputFiles(png('second.png'));
      await page.waitForFunction(() => [...document.querySelectorAll('img[alt$="미리보기"]')].filter(img => img.complete && img.naturalWidth > 0).length === 2);
      const before = await page.getByAltText('사진 1 미리보기').getAttribute('src');
      await first.setInputFiles([]);
      assert.equal(await page.getByAltText('사진 1 미리보기').getAttribute('src'), before, 'picker cancellation preserves the selection');
      await first.setInputFiles({ name: 'broken.heic', mimeType: 'image/heic', buffer: Buffer.from('invalid heic') });
      await page.getByText(/변환이 안 되면/).first().waitFor();
      await page.waitForFunction(() => document.querySelector('#onboarding-field-photo0')?.getAttribute('aria-invalid') === 'true');
      assert.equal(await page.getByAltText('사진 1 미리보기').getAttribute('src'), before, 'failed selection preserves previous photo');
      const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('gymtools:dating-onboarding-draft:v1:fixture-member')));
      assert.equal(draft.fields.introText, '보존해야 할 한글 소개');
      // Real PNG bytes deliberately use .heic to exercise actual canvas output, not claim a HEIC decoder test.
      await first.setInputFiles({ name: 'slow.heic', mimeType: 'image/heic', buffer });
      await page.getByText('사진 1 처리 중…', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '다음', exact: true }).isDisabled(), true);
      await first.setInputFiles(png('latest.png'));
      await page.waitForFunction(() => window.fixtureFiles.some(file => file.name === 'latest.png'));
      await page.waitForTimeout(850);
      assert.equal(await page.evaluate(() => window.fixtureFiles.some(file => file.name === 'slow.jpg')), false, 'obsolete conversion never commits');
      await second.setInputFiles({ name: 'canvas-test.heic', mimeType: 'image/heic', buffer });
      await page.waitForFunction(() => window.fixtureFiles.some(file => file.name === 'canvas-test.jpg' && file.type === 'image/jpeg'));
      // Verify actual encoded pixels, not only mocked canvas dimensions. These generated PNG
      // fixtures exercise conversion geometry; they are deliberately NOT HEIC codec fixtures.
      for (const [sourceWidth, sourceHeight] of [[4000, 3000], [3000, 4000], [600, 800], [900, 900]]) {
        const name = 'geometry-' + sourceWidth + '-' + sourceHeight;
        const bytes = await page.evaluate(async ([w, h]) => {
          const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          for (const [color, x, y] of [['#ff0000', 0, 0], ['#00ff00', w / 2, 0], ['#0000ff', 0, h / 2], ['#ffff00', w / 2, h / 2]]) {
            ctx.fillStyle = color; ctx.fillRect(x, y, w / 2, h / 2);
          }
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          const result = Array.from(new Uint8Array(await blob.arrayBuffer()));
          canvas.width = 0; canvas.height = 0; return result;
        }, [sourceWidth, sourceHeight]);
        await second.setInputFiles({ name: name + '.heic', mimeType: 'image/heic', buffer: Buffer.from(bytes) });
        await page.waitForFunction(filename => window.fixtureFiles.some(file => file.name === filename), name + '.jpg');
        const result = await page.evaluate(async filename => {
          const file = window.fixtureFiles.find(item => item.name === filename).file;
          const image = new Image(), url = URL.createObjectURL(file);
          try {
            await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
            const w = image.naturalWidth, h = image.naturalHeight;
            const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
            const colors = [[0.02, 0.02], [0.98, 0.02], [0.02, 0.98], [0.98, 0.98]]
              .map(([x, y]) => Array.from(ctx.getImageData(Math.floor(w * x), Math.floor(h * y), 1, 1).data).slice(0, 3));
            canvas.width = 0; canvas.height = 0;
            return { width: w, height: h, colors, type: file.type };
          } finally { URL.revokeObjectURL(url); }
        }, name + '.jpg');
        const ratio = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
        assert.deepEqual([result.width, result.height], [Math.round(sourceWidth * ratio), Math.round(sourceHeight * ratio)]);
        assert.equal(result.type, 'image/jpeg');
        const expected = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
        result.colors.forEach((color, i) => color.forEach((value, j) => assert.ok(Math.abs(value - expected[i][j]) <= 12, 'corners must not rotate, crop or corrupt')));
        geometryChecks++;
      }
      // Actual large JPG/PNG/WebP files (valid encoded image + inert trailing bytes)
      // must be decoded/re-encoded before any API sees the original 5 MiB payload.
      for (const type of ['image/jpeg','image/png','image/webp','']) {
        const ext=type.split('/')[1]||'jpg',name='large-'+(ext==='jpeg'?'jpg':ext)+'-'+(type?'known':'unknown');
        const bytes=await page.evaluate(async mime=>{
          const canvas=document.createElement('canvas');canvas.width=600;canvas.height=800;
          const ctx=canvas.getContext('2d');ctx.fillStyle='#e21e36';ctx.fillRect(0,0,600,800);
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,mime||'image/jpeg',0.95));
          return Array.from(new Uint8Array(await blob.arrayBuffer()));
        },type);
        const original=Buffer.alloc(5*1024*1024);Buffer.from(bytes).copy(original);
        await first.setInputFiles({name:name+'.'+ext,mimeType:type,buffer:original});
        await page.waitForFunction(filename=>window.fixtureFiles.some(f=>f.name===filename&&f.type==='image/jpeg'&&f.file.size<3*1024*1024),name+'.jpg');
        const result=await page.evaluate(async filename=>{
          const file=window.fixtureFiles.find(f=>f.name===filename&&f.file.size<3*1024*1024).file;
          const image=new Image(),url=URL.createObjectURL(file);
          try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
            return {width:image.naturalWidth,height:image.naturalHeight,size:file.size};
          }finally{URL.revokeObjectURL(url);}
        },name+'.jpg');
        assert.deepEqual([result.width,result.height],[600,800]);assert.ok(result.size<3*1024*1024);geometryChecks++;
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(output, 'photos-' + width + '.png'), fullPage: true });
      passed++; await context.close();
    }
    console.log(JSON.stringify({ passed, geometryChecks, productionRequests: 0, realHeicCodecVerified: false, screenshots: output }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
