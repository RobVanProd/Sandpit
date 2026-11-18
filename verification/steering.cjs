const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

const gameRoot = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const editions = [
  { name: "Field", file: "field/index.html", qaName: "sandpitQA", stick: "#leftStick" },
  { name: "Earthworks", file: "index.html", qaName: "sandpitTest", stick: "#left" },
];
const machineNames = ["dozer", "loader", "truck", "excavator"];

async function stage(page, type, heading) {
  await page.evaluate(({ type, heading }) => {
    const field = !!window.sandpitQA;
    const qa = window.sandpitQA || window.sandpitTest;
    const stageRigs = (rigs, height) => {
      for (const [i, rig] of rigs.entries()) {
        const [x, z] = i === type ? [0, 0] : [[-10, -7], [-10, 7], [10, -7], [10, 7]][i];
        Object.assign(rig, {
          x, z, y: height(x, z), yaw: i === type ? heading : 0,
          roll: 0, pitch: 0, speed: 0, [field ? "turn" : "steer"]: 0,
          ...(i === 1 ? { lift: 0.7 } : {}),
        });
      }
    };
    if (field) {
      qa.scenario(2);
      qa.unit(type);
      qa.fixture(({ vehicles, h, sample, setFlow }) => {
        stageRigs(vehicles, (x, z) => sample(h, x, z));
        setFlow(0);
      });
    } else {
      qa.start();
      qa.reset(0);
      qa.select(type);
      stageRigs(qa.rigs, qa.height);
    }
  }, { type, heading });
}

async function readRig(page, type, frames = 0) {
  return page.evaluate(({ type, frames }) => {
    const rightOffset = (x, z, rig) =>
      -Math.cos(rig.yaw) * (x - rig.x) + Math.sin(rig.yaw) * (z - rig.z);
    const field = !!window.sandpitQA;
    const qa = window.sandpitQA || window.sandpitTest;
    if (frames) qa.step(frames);
    const read = (rigs, tip) => {
      const rig = rigs[type];
      const nose = type === 1 ? tip() : [rig.x, rig.z];
      return { x: rig.x, z: rig.z, yaw: rig.yaw, speed: rig.speed, nose: rightOffset(...nose, rig) };
    };
    return field
      ? qa.fixture(({ vehicles, tipPoint }) => read(vehicles, () => tipPoint(vehicles[type]).slice(0, 2)))
      : read(qa.rigs, () => qa.point(type, qa.rigs[type]).slice(0, 2));
  }, { type, frames });
}

function checkMotion(label, type, side, direction, start, end) {
  const tracked = type === 0 || type === 3;
  const yaw = end.yaw - start.yaw;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lateral = -Math.cos(start.yaw) * dx + Math.sin(start.yaw) * dz;
  if (direction) {
    // In reverse, steered wheels still back toward the selected side, while
    // tracked rigs pivot their noses in the named direction.
    const lateralSide = tracked && direction === -1 ? -side : side;
    assert.ok(direction * end.speed > 0.1, `${label} should move with throttle: speed ${end.speed}`);
    assert.ok(lateralSide * lateral > 0.025,
      `${label} should travel toward the expected side from behind: lateral ${lateral}`);
  } else {
    assert.ok(Math.hypot(dx, dz) < 1e-4, `${label} should stay in place at neutral throttle`);
  }
  if (tracked || direction) {
    const yawSide = tracked ? side : side * direction;
    assert.ok(-yawSide * yaw > 0.08, `${label} should yaw toward the expected side: yaw ${yaw}`);
  } else {
    assert.ok(Math.abs(yaw) < 1e-4, `${label} should not yaw at neutral throttle`);
  }
}

async function verifyEdition(browser, edition) {
  const page = await browser.newPage({ viewport: { width: 430, height: 850 }, hasTouch: true });
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  try {
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.fulfill({ contentType: "text/css", body: "" }));
    await page.goto(pathToFileURL(path.join(gameRoot, edition.file)).href + "?qa");
    await page.waitForFunction((qaName) => !!window[qaName], edition.qaName);
    await page.evaluate((qaName) => window[qaName].pause(), edition.qaName);

    for (const [type, machine] of machineNames.entries()) {
      for (const [side, direction] of [[1, 1], [-1, 1], [1, -1], [1, 0]]) {
        await stage(page, type, direction === -1 ? 0.82 : 0);
        const start = await readRig(page, type);
        const keys = [side === 1 ? "ArrowRight" : "a"];
        if (direction) keys.push(direction === 1 ? "w" : "s");
        for (const key of keys) await page.keyboard.down(key);
        const end = await readRig(page, type, 26);
        for (const key of keys) await page.keyboard.up(key);
        checkMotion(`${edition.name} keyboard ${machine} (${side}, ${direction})`, type, side, direction, start, end);
      }
    }
    // Activate the touch UI with a browser-delivered touch, then drive its left stick.
    await page.touchscreen.tap(220, 320);
    const cdp = await page.context().newCDPSession(page);
    for (const side of [1, -1]) {
      await stage(page, 2, 0);
      const start = await readRig(page, 2);
      const stick = await page.locator(edition.stick).boundingBox();
      assert.ok(stick, `${edition.name} left touch stick is visible`);
      const center = { id: 1, x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 };
      const moved = { ...center, x: center.x + side * stick.width * 0.31, y: center.y - stick.height * 0.31 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [center] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [moved] });
      const end = await readRig(page, 2, 26);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      checkMotion(`${edition.name} touch truck (${side})`, 2, side, 1, start, end);
    }
    // Headless Chromium has no physical gamepad. Supply the standard device shape
    // through its browser API so the normal Gamepad polling feeds the fixed-step loop.
    await page.evaluate(() => {
      window.testPad = {
        connected: true, index: 0, axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
      };
      Object.defineProperty(navigator, "getGamepads", { value: () => [window.testPad] });
    });
    for (const side of [1, -1]) {
      await stage(page, 1, 0);
      const start = await readRig(page, 1);
      await page.evaluate((side) => { window.testPad.axes = [side, -1, 0, 0]; }, side);
      const end = await readRig(page, 1, 26);
      await page.evaluate(() => { window.testPad.axes.fill(0); });
      checkMotion(`${edition.name} gamepad loader (${side})`, 1, side, 1, start, end);
      assert.ok(side * (end.nose - start.nose) > 0.15, `${edition.name} loader bucket should articulate with steering`);
    }
    assert.deepEqual(errors, []);
    console.log(`${edition.name} steering passed for keyboard, touch, and Gamepad API.`);
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
  });
  try {
    for (const edition of editions) await verifyEdition(browser, edition);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
