'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = path.join(__dirname, '../field/index.html');
const html = fs.readFileSync(page, 'utf8');
const script = html.indexOf('<script>');
const end = html.indexOf('// The sandbox draws at pixel resolution', script);
assert.ok(script >= 0 && end > script, 'Find the soil engine before the renderer');

const engine = html.slice(script + '<script>'.length, end);
// Evaluate only the local field engine. Boot code and rendering stay outside this run.
const soil = new Function('matchMedia', engine + `
  return {
    initYard, at, sample, avalanche, exchangeSediment, wetSand,
    sandTotal, waterBalanceError, waterTotal,
    h, w, silt, pack, fresh, pore, poreCapacity, NX, NZ, DX, HX, HZ,
    startWaterTest() {
      w.fill(0);
      pore.fill(0);
      startWater = waterTotal();
      waterIn = waterOut = 0;
    },
    addSurfaceWater(cell, depth) {
      w[cell] += depth;
      waterIn += depth * AREA;
    },
    drainSurfaceWater() {
      waterOut += sum(w) * AREA;
      w.fill(0);
    }
  };
`)(() => ({ matches: false }));

const {
  initYard, at, sample, avalanche, exchangeSediment, wetSand,
  sandTotal, waterBalanceError, waterTotal,
  h, w, silt, pack, fresh, pore, poreCapacity, NX, NZ, DX, HX, HZ,
  startWaterTest, addSurfaceWater, drainSurfaceWater,
} = soil;
const step = 1 / 30;

function pileProfile(saturation, dt = step) {
  initYard(2);
  w.fill(0);
  pore.fill(poreCapacity * saturation);
  for (let z = 0; z < NZ; z++) {
    for (let x = 0; x < NX; x++) {
      const radius = Math.hypot(x * DX - HX, z * DX - HZ);
      h[z * NX + x] = Math.max(0, 2.35 - 3 * radius);
    }
  }
  const firstSand = sandTotal();
  for (let i = 0; i < Math.round(20 / dt); i++) avalanche(dt);
  assert.ok(Math.abs(sandTotal() - firstSand) < 1e-8, 'Pile conserves sand');

  const near = 0.32;
  const far = 0.84;
  return Array.from({ length: 8 }, (_, i) => {
    const azimuth = Math.PI * i / 16;
    const dx = Math.cos(azimuth);
    const dz = Math.sin(azimuth);
    const rise = sample(h, dx * near, dz * near) - sample(h, dx * far, dz * far);
    return Math.atan(rise / (far - near)) * 180 / Math.PI;
  });
}

const dry = pileProfile(0);
const damp = pileProfile(1 / 3);
const saturated = pileProfile(1);
for (const profile of [dry, damp, saturated]) {
  assert.ok(Math.max(...profile) - Math.min(...profile) < 1.5, 'Azimuth spread stays under 1.5°');
}
assert.ok(dry.every(angle => angle > 31 && angle < 34), 'Dry pile falls in the calibrated repose range');
assert.ok(damp.every((angle, i) => angle - dry[i] > 8), 'Damp sand holds a steeper slope');
assert.ok(saturated.every((angle, i) => Math.abs(angle - dry[i]) < 0.01), 'Saturation removes capillary gain');
const damp24 = pileProfile(1 / 3, 1 / 24);
const maxStepDifference = Math.max(...damp24.map((angle, i) => Math.abs(angle - damp[i])));
assert.ok(maxStepDifference < 1, 'Repose is comparable at 24 and 30 Hz');

function erosion(depth, speed, compaction) {
  initYard(2);
  const i = at(0, 0);
  h[i] = 0;
  silt[i] = 0;
  pack[i] = compaction;
  fresh[i] = 0;
  for (let n = 0; n < 60; n++) exchangeSediment(i, depth, speed ** 2, step);
  const pickedUp = silt[i];
  for (let n = 0; n < 30; n++) exchangeSediment(i, depth, 0, step);
  assert.ok(Math.abs(h[i] + silt[i]) < 1e-12, 'Erosion and settling conserve sand');
  return { pickedUp, afterSettling: silt[i] };
}

const loose = erosion(0.26, 2.5, 0);
const compact = erosion(0.26, 2.5, 0.8);
const shallow = erosion(0.026, 2.5, 0);
const deeper = erosion(0.48, 2.5, 0);
assert.equal(erosion(0.26, 0, 0).pickedUp, 0, 'Still water picks up no sand');
assert.ok(loose.pickedUp > 0 && compact.pickedUp < 0.6 * loose.pickedUp, 'Compaction reduces erosion');
assert.ok(shallow.pickedUp < 0.1 * loose.pickedUp, 'A thin film carries less sand');
assert.ok(deeper.afterSettling / deeper.pickedUp > loose.afterSettling / loose.pickedUp,
  'Sand takes longer to settle through deep water');

initYard(2);
startWaterTest();
const center = at(0, 0);
addSurfaceWater(center, 0.65);
wetSand(step);
const firstUptake = pore[center];
for (let i = 1; i < 150; i++) wetSand(step);
const retained = pore[center];
const wick = pore[center + 1];
assert.ok(firstUptake > 0 && firstUptake < retained, 'Water infiltrates over time');
assert.ok(retained < poreCapacity && wick > 0, 'A finite pore layer retains and wicks water');
assert.ok(Math.abs(waterBalanceError()) < 1e-9, 'Infiltration conserves water');

drainSurfaceWater();
const storedAfterDrain = waterTotal();
for (let i = 0; i < 3000; i++) wetSand(step);
const storedAfterDrying = waterTotal();
assert.ok(storedAfterDrain > storedAfterDrying && storedAfterDrying > 0, 'Pore water dries gradually');
assert.ok(Math.abs(waterBalanceError()) < 1e-9, 'Ledger includes drained and evaporated water');

console.log(JSON.stringify({
  reposeDegrees: { dry, damp, saturated, maxStepDifference },
  suspendedSandHeights: { loose, compact, shallow, deeper },
  poreWaterHeights: { firstUptake, retained, wick, afterDrying: pore[center] },
  waterBalanceErrorLitres: waterBalanceError(),
}, null, 2));
