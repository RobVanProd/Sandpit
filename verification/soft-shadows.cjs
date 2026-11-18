const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('const swCtx =');
const end = html.indexOf('const sunVP =', start);
assert(start >= 0 && end > start, 'Locate the shipped software renderer');

vm.runInNewContext(html.slice(start, end) + `
  const width = 64, height = 56;
  swSetup(width, height);
  swWidth = width;
  swHeight = height;
  swDepth = swZ;
  swReceiverShadow = swShadow;
  swMat = 8;
  swCol = [192, 160, 128];
  swIllum = 1;

  // A straight shadow boundary crosses the interior of a perspective-projected ground quad.
  for (let y = 0; y < SD; y++)
    for (let x = 0; x < SD; x++)
      swShadow[y * SD + x] = x < 45 ? -0.1 : Infinity;

  function point(x, y) {
    const inverseW = 1 + 0.02 * x;
    return [x, y, 0, inverseW, 0, 0, (2 * x + 20) / inverseW, (y + 50) / inverseW, 0];
  }

  const a = point(4.2, 4.3), b = point(56.4, 4.4);
  const c = point(56.5, 49.4), d = point(4.3, 49.6);
  function draw(first, second) {
    swZ.fill(Infinity);
    swImage.data.fill(0);
    swTri(...first, 0);
    swTri(...second, 0);
    return swImage.data.slice();
  }

  const main = draw([a, b, c], [a, c, d]);
  const flipped = draw([a, b, d], [b, c, d]);
  const red = (data, x, y) => data[4 * (y * width + x)];
  assert(red(main, 9, 8) < 170, 'One interior pixel of the triangle is shadowed');
  assert(red(main, 41, 8) >= 200, 'Another interior pixel of the same triangle is lit');
  assert(red(main, 25, 8) >= 200, 'Restore camera perspective before sampling shadow depth');
  for (let y = 10; y < 44; y++)
    for (let x = 8; x < 52; x++)
      assert.equal(red(main, x, y), red(flipped, x, y), 'Shadow is independent of the quad diagonal');
`, {
  assert,
  gl: null,
  glCanvas: {
    getContext() {
      return { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) };
    },
  },
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  mix: (a, b, t) => a + (b - a) * t,
  NN: 0,
});

console.log('Software shadow edge crosses triangle interiors and stays stable across quad diagonals.');
