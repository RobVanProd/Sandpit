'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const output = process.env.SANDPIT_EVIDENCE;
const baselineRoot = process.env.SANDPIT_BASELINE;
const chromiumPath = process.env.SANDPIT_CHROMIUM || process.env.CHROME_BIN;
assert.ok(chromiumPath, 'Set SANDPIT_CHROMIUM or CHROME_BIN to a Chromium executable.');
const snapshots = process.argv.includes('--captures');
const selected = process.env.SANDPIT_VARIANT;
const qualities = process.env.SANDPIT_SHADOW_HEIGHT ? [Number(process.env.SANDPIT_SHADOW_HEIGHT)] : [342, 238];
const routes = new Map();

for (const [version, directory] of [['baseline', baselineRoot], ['current', root]]) {
  if (!directory) continue;
  for (const [game, file] of [['classic', 'index.html'], ['field', 'field/index.html']]) {
    if (selected && !('/' + version + '/' + game).includes(selected)) continue;
    if (!fs.existsSync(path.join(directory, file))) continue;
    routes.set('/' + version + '/' + game, instrument(fs.readFileSync(path.join(directory, file), 'utf8'), game));
  }
}

function instrument(source, game) {
  const classic = game === 'classic';
  const cameraEntry = classic ? 'function updateCamera(dt) {' : 'function cameraStep(dt){';
  const cameraOverride = classic
    ? 'if (window.shadowProbe) { eyePos = shadowProbe.eye; VP = mm(perspective(.66, stageW / stageH, .16, 160), look(eyePos, shadowProbe.target)); return; }'
    : 'if (window.shadowProbe) { cameraEye = shadowProbe.eye; const a = renderW/renderH, t = .345, n = .15, f = 140; VP = matmul([1/(a*t),0,0,0,0,1/t,0,0,0,0,-(f+n)/(f-n),-1,0,0,-2*f*n/(f-n),0], look(cameraEye, shadowProbe.target)); return; }';
  assert.ok(source.includes(cameraEntry), 'Find ' + game + ' camera entry');
  source = source.replace(cameraEntry, cameraEntry + '\n' + cameraOverride);
  const hook = `<style>
    #stage { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; }
  </style><script>`;
  assert.ok(source.includes('<script>'));
  source = source.replace('<script>', hook);
  const end = source.lastIndexOf('</script>');
  assert.ok(end > 0);
  const probe = `
  window.setupShadowProbe = (quality, rigX, rigZ, angle) => {
    ${classic ? 'sandpitTest.pause(); selectRig(0); internalH = quality;' : 'sandpitQA.pause(); chooseUnit(0); resHeight = quality;'}
    const rig = ${classic ? 'rigs[0]' : 'vehicles[0]'};
    const canvas = document.getElementById('world');
    const staging = document.createElement('canvas');
    const context = staging.getContext('2d', { willReadFrequently: true });
    const probe = window.shadowProbe = {
      eye: [rigX + Math.sin(angle) * 6.55, 3.85, rigZ + Math.cos(angle) * 6.55],
      target: [rigX - .04, 1.03, rigZ - .65]
    };
    let shadowPasses = 0;
    let neutralDepth = null;
    let useNeutral = false;
    let frameBuffer = null;
    const originalBindFramebuffer = gl.bindFramebuffer.bind(gl);
    const originalBindTexture = gl.bindTexture.bind(gl);
    const originalClear = gl.clear.bind(gl);
    gl.bindFramebuffer = (target, object) => {
      if (target !== gl.READ_FRAMEBUFFER) frameBuffer = object;
      originalBindFramebuffer(target, object);
    };
    gl.clear = mask => {
      if (mask & gl.DEPTH_BUFFER_BIT && frameBuffer === ${classic ? 'fixedSunFBO' : 'shadowFB'}) shadowPasses++;
      originalClear(mask);
    };
    ${classic ? `const countBlit = gl.blitFramebuffer.bind(gl);
    gl.blitFramebuffer = (...args) => {
      if (frameBuffer === sFBO && args[8] === gl.DEPTH_BUFFER_BIT) shadowPasses++;
      countBlit(...args);
    };` : ''}
    gl.bindTexture = (target, texture) => originalBindTexture(target, useNeutral && texture === shadowTex ? neutralDepth : texture);
    neutralDepth = gl.createTexture();
    originalBindTexture(gl.TEXTURE_2D, neutralDepth);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT16,1,1,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_SHORT,new Uint16Array([65535]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);

    function capture() {
      staging.width = canvas.width;
      staging.height = canvas.height;
      context.drawImage(canvas, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    }
    function snapshot(pixels) {
      context.putImageData(new ImageData(pixels, staging.width, staging.height), 0, 0);
      return staging.toDataURL('image/png').split(',')[1];
    }
    function pixel(point) {
      const [x,y] = project(...point);
      return ${classic ? '[x * canvas.width / stageW, y * canvas.height / stageH]' : '[(x * .5 + .5) * canvas.width, (.5 - y * .5) * canvas.height]'};
    }
    function bladePolygon() {
      const joint = ${classic ? 'dozerBlade(rig, rigFrame(rig))' : 'machineTool(rig)'};
      const transform = ${classic ? 'tf' : 'pt'};
      return ${classic
        ? '[[-.88,.20,.09],[.88,.20,.09],[.88,.60,.09],[-.88,.60,.09]]'
        : '[[-1.11,-.18,.004],[1.11,-.18,.004],[1.11,.25,-.074],[-1.11,.25,-.074]]'}.map(p => pixel(transform(joint, p)));
    }
    function groundPolygon() {
      return [[-2.1,-2.5],[2.9,-2.5],[2.9,.8],[-2.1,.8]].map(([x,z]) => pixel([rig.x+x, sample(h,rig.x+x,rig.z+z), rig.z+z]));
    }
    function measure(before, after, polygon) {
      let pixels = 0, changed = 0, delta = 0, worst = 0;
      const cx = polygon.reduce((sum,p) => sum+p[0],0)/polygon.length;
      const cy = polygon.reduce((sum,p) => sum+p[1],0)/polygon.length;
      const inset = polygon.map(([x,y]) => [cx+(x-cx)*.94,cy+(y-cy)*.82]);
      for (let y = Math.max(0, Math.ceil(Math.min(...inset.map(p=>p[1])))); y < Math.min(staging.height, Math.max(...inset.map(p=>p[1]))); y++) {
        for (let x = Math.max(0, Math.ceil(Math.min(...inset.map(p=>p[0])))); x < Math.min(staging.width, Math.max(...inset.map(p=>p[0]))); x++) {
          const signs = inset.map(([ax,ay],i) => {
            const [bx,by] = inset[(i+1)%inset.length];
            return (x+.5-ax)*(by-ay) - (y+.5-ay)*(bx-ax);
          });
          if (!(signs.every(s => s >= 0) || signs.every(s => s <= 0))) continue;
          const i = (y*staging.width+x)*4;
          const d = (Math.abs(before[i]-after[i])+Math.abs(before[i+1]-after[i+1])+Math.abs(before[i+2]-after[i+2])) / 3;
          pixels++;
          changed += Number(d >= 3);
          delta += d;
          worst = Math.max(worst,d);
        }
      }
      assertPixels(pixels);
      return { pixels, changed, mean: +(delta/pixels).toFixed(3), worst: +worst.toFixed(2) };
    }
    function assertPixels(pixels) {
      if (pixels < 50) throw new Error('Projected sample too small: ' + pixels);
    }
    function putPose(lift, curl, motion) {
      const x = rigX + motion;
      Object.assign(rig, { x, z: rigZ, y: sample(h,x,rigZ), lift, curl, yaw: Math.PI, pitch: 0, roll: 0, speed: 0 });
    }
    function paint() { render(1 / 60); }
    function fresh() {
      // Update the cached map if this build still uses a reduced shadow update rate.
      try { eval('shadowDirty = true'); } catch {}
      try { eval('shadowClock = -1'); } catch {}
      try { eval('shadowTick = 0'); } catch {}
      paint();
    }
    putPose(.88,.50,0);
    fresh();
    return {
      dimensions: [canvas.width, canvas.height],
      draw(lift, curl, motion, physics, images) {
        if (physics) {
          ${classic ? 'sandpitTest.step(1, neutral());' : 'sandpitQA.step(1); uploadFields();'}
          putPose(lift,curl,motion);
        }
        const first = shadowPasses;
        paint();
        const passes = shadowPasses - first;
        const before = capture();
        const blade = bladePolygon();
        const ground = groundPolygon();
        let cadence;
        try { cadence = eval('shadowTick'); } catch {}
        const refreshStart = shadowPasses;
        fresh();
        let expected = capture();
        const referencePasses = shadowPasses - refreshStart;
        if (cadence !== undefined) eval('shadowTick = cadence');
        const result = { lift, passes, referencePasses, blade: measure(before,expected,blade), ground: measure(before,expected,ground), glError: gl.getError() };
        if (images) {
          result.image = snapshot(before);
          useNeutral = true;
          ${classic ? "gardenKey = '';" : ''}
          paint();
          const lit = capture();
          useNeutral = false;
          ${classic ? "gardenKey = '';" : ''}
          result.bladeShadow = measure(before,lit,blade);
          result.groundShadow = measure(before,lit,ground);
          if (cadence !== undefined) eval('shadowTick = cadence');
        }
        return result;
      }
    };
  };
  `;
  return source.slice(0, end) + probe + source.slice(end);
}

const server = http.createServer((request, response) => {
  const route = routes.get(new URL(request.url, 'http://localhost').pathname);
  response.writeHead(route ? 200 : 404, {'Content-Type': 'text/html'});
  response.end(route || '');
});

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    executablePath: chromiumPath, headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage']
  });
  try {
    const results = {};
    if (output) fs.mkdirSync(output, { recursive: true });
    for (const route of routes.keys()) {
      const [version, variant] = route.slice(1).split('/');
      const rows = [];
      for (const quality of qualities) {
        const page = await browser.newPage({ viewport: {width: 920, height: 580} });
        page.on('pageerror', error => console.error('page error', route, error));
        await page.route('https://**', request => request.abort());
        await page.goto(`http://127.0.0.1:${server.address().port}${route}?qa`, {waitUntil: 'domcontentloaded'});
        const [x,z,angle] = variant === 'classic' ? [-7,4.75,2.28] : [-8,5.6,2.28];
        const sample = await page.evaluate(({ quality, x, z, angle }) => {
          const test = setupShadowProbe(quality, x, z, angle);
          const frames = [];
          // Sample all display frames across a 30 Hz pose change, including each hold frame.
          for (let frame = 0; frame < 16; frame++) {
            const tick = Math.floor(frame / 2);
            const phase = Math.max(0, Math.min(1, (tick - 1) / 5));
            const lift = .88 - .70 * phase;
            const curl = .50 + Math.sin(phase * Math.PI) * .22;
            const travel = phase * .34;
            frames.push(test.draw(lift, curl, travel, frame % 2 === 0, frame === 0 || frame === 15));
          }
          return { quality, dimensions: test.dimensions, frames };
        }, {quality, x, z, angle });
        assert.ok(sample.frames.every(frame => frame.glError === 0), route + ': WebGL errors');
        for (const [i, frame] of sample.frames.entries()) {
          if (frame.image && snapshots && output && quality === 342) fs.writeFileSync(path.join(output,`${version}-${variant}-${i}.png`), Buffer.from(frame.image,'base64'));
          delete frame.image;
        }
        sample.summary = {
          passes: sample.frames.map(frame => frame.passes),
          verifiedReferencePasses: sample.frames.map(frame => frame.referencePasses),
          worstBladeLagRGB: Math.max(...sample.frames.map(f => f.blade.mean)),
          worstGroundLagRGB: Math.max(...sample.frames.map(f => f.ground.mean)),
          raisedBladeShadow: sample.frames[0].bladeShadow,
          loweredBladeShadow: sample.frames.at(-1).bladeShadow,
          groundShadow: [sample.frames[0].groundShadow, sample.frames.at(-1).groundShadow]
        };
        rows.push(sample);
        console.log(route, quality, JSON.stringify(sample.summary));
        await page.close();
      }
      results[route] = rows;
    }
    if (output) fs.writeFileSync(path.join(output, 'shadow-metrics' + (selected ? selected.replaceAll('/', '-') : '') + '.json'), JSON.stringify(results,null,2)+'\n');
    if (!process.argv.includes('--compare-only')) {
      for (const [route, rows] of Object.entries(results).filter(([route]) => route.startsWith('/current/'))) {
        for (const {summary, quality} of rows) {
          assert.ok(summary.verifiedReferencePasses.every(passes => passes >= 1), route + ': fresh-map probe did not confirm a shadow pass');
          assert.ok(summary.worstBladeLagRGB < .2 && summary.worstGroundLagRGB < .2, route + ': stale shadows across render intervals at render height ' + quality);
          assert.ok(summary.groundShadow.every(m => m.changed > 30), route + ': visible cast shadow was lost at render height ' + quality);
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
