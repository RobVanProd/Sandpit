"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.SANDPIT_CHROMIUM,
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.goto(pathToFileURL(path.join(__dirname, "../index.html")).href + "?qa");
    await page.waitForFunction(() => window.sandpitTest);
    const report = await page.evaluate(() => {
      const test = window.sandpitTest,
        neutral = { drive: 0, turn: 0, lift: 0, side: 0, dig: 0, dump: 0, feather: 0 },
        peak = { blade: 0, wheel: 0, bucket: 0, truck: 0 };
      test.pause();
      test.reset(0);
      test.start();
      let sandError = 0, waterError = 0, finite = true;
      function step(count, changes = {}) {
        for (let i = 0; i < count; i++) {
          test.step(1, { ...neutral, ...changes });
          const counts = { blade: 0, wheel: 0, bucket: 0, truck: 0 };
          const state = test.state;
          for (const g of test.grains) {
            counts[g.kind]++;
            finite &&= g.volume > 0 && g.moisture >= 0 && g.moisture <= 1 &&
              [g.x, g.y, g.z, g.radius, g.vx, g.vy, g.vz,
                g.material.sand, g.material.loam, g.material.gravel].every(Number.isFinite);
          }
          for (const kind of Object.keys(peak)) peak[kind] = Math.max(peak[kind], counts[kind]);
          finite &&= state.finite && test.grains.length <= state.grainLimit;
          sandError = Math.max(sandError, Math.abs(state.mass - state.initial));
          waterError = Math.max(waterError, Math.abs(state.waterError));
        }
      }
      step(45, { drive: 1, lift: -1 });
      step(35);
      test.select(1);
      test.aim(1, -4.2, 4.9, .12);
      step(36, { drive: .35, dig: 1, side: .6 });
      step(51, { lift: 1 });
      const loader = test.rigs[1], truck = test.rigs[2], load = loader.payload;
      test.aim(1, 6, 1.3, 0);
      loader.pitch = loader.roll = loader.steer = 0;
      const [x,z] = test.point(1, loader);
      test.aim(2, x, z + .54, 0);
      truck.lift = truck.pitch = truck.roll = 0;
      step(45, { dump: 1 });
      const received = truck.payload;
      test.select(2);
      step(62, { drive: .94 });
      step(90, { lift: 1 });
      step(25);
      return { peak, load, received, remaining: truck.payload, airborne: test.grains.length,
        settled: test.state.grainSettled, finite, sandError, waterError };
    });
    assert.ok(report.peak.blade > 1 && report.peak.wheel > 1, "Blade cut and treads both mobilize soil");
    assert.ok(report.peak.bucket > 1 && report.peak.truck > 0, "Loader and truck release moving soil");
    assert.ok(report.load > 0.01 && Math.abs(report.received - report.load) < 1e-8, "Raised loader lands in the bed");
    assert.ok(report.remaining < 1e-8 && !report.airborne && report.settled > report.received);
    assert.ok(report.finite && report.sandError < 1e-8 && report.waterError < 1e-8);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
