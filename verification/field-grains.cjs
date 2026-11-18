'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '../field/index.html'), 'utf8');
function section(from, to) {
  const start = page.indexOf(from);
  const end = page.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, 'Find ' + from + ' in the published app');
  return page.slice(start, end);
}
const engine = section("'use strict';", '// The sandbox draws at pixel resolution') +
  section('const sub=', 'function look') +
  section('const I=', 'let data=');

const report = new Function('assert', 'matchMedia', engine + `
const dt = 1/30;
const report = {};
const matches = (a, b, tol=1e-8) => Math.abs(a-b) < tol;

function levelField() {
  initYard(2);
  h.fill(0);
  w.fill(0);
  wet.fill(0);
  for(let i=0;i<N;i++){
    initGround(i,i%NX*DX-HX,Math.floor(i/NX)*DX-HZ,floor);
    groundBed[i]=floor;
    refreshGround(i);
  }
  vehicles.forEach((v,i)=>Object.assign(v,{x:-12+i*7,z:-8,y:0,yaw:0,pitch:0,roll:0,speed:0}));
}

// Two scene units equal 20 cm. Count frames to the first physical impact.
levelField();
const dropped=remove(0,0,.44,.44,0,.08,.2);
assert.ok(dropped>0);
const beforeDrop=sandTotal()+dropped*AREA;
assert.ok(emergeGrain(0,2,0,0,0,0,dropped,-1,0,'test'));
let flight=0;
while(flight<1&&fallingSand.length){
  const parcel=fallingSand[0];
  settleGrains(dt);
  flight+=dt;
  if(parcel.mode!=='air'||parcel.dy>0)break;
}
assert.ok(flight>=.17&&flight<=.24,'20 cm dry fall is near 0.20 s');
for(let i=0;i<90;i++)settleGrains(dt);
assert.equal(fallingSand.length,0);
assert.ok(matches(sandTotal(),beforeDrop),'Ballistic parcel returns its full volume');
report.dryDropSeconds=flight;

// Feed one bin from above and confirm the bed stores the material where it
// landed. Tip the actual articulated body and check the returned volume.
levelField();
const truck=vehicles[2];
Object.assign(truck,{x:0,z:1,lift:0});
const testMix={sand:.25,loam:.50,gravel:.25};
const donor=at(8,4),cargoAmount=1.3;
putGround(donor,cargoAmount,cargoAmount*testMix.loam,cargoAmount*testMix.gravel);
const fullSystem=sandTotal();
takeGround(donor,cargoAmount);
const tool=machineTool(truck),local=[.42,1.36,1.26];
const [x,y,z]=pt(tool,local);
assert.ok(emergeGrain(x,y,z,0,-1,0,cargoAmount,-1,0,'test',testMix));
for(let i=0;i<24;i++)settleGrains(dt);
const bin=bedBin(local[0],local[2]);
assert.ok(matches(truck.bedPile[bin],cargoAmount),'A parcel loads the bin below impact');
assert.ok(matches(sum(truck.bedPile),truck.payload));
assert.ok(matches(truck.bedLoam[bin],cargoAmount*.50));
assert.ok(matches(truck.bedGravel[bin],cargoAmount*.25));
assert.ok(matches(sandTotal(),fullSystem));
truck.lift=1;
let emitted=0,peak=0;
for(let i=0;i<480;i++){
  sloughBed(truck,dt);
  emitted+=unload(truck,dt*truck.capacity*(truck.lift-.39)*1.8);
  peak=Math.max(peak,fallingSand.length);
  settleGrains(dt);
  assert.ok(matches(sandTotal(),fullSystem),'Tipping conserves soil every step');
}
assert.ok(truck.payload<.01*cargoAmount,'Tilt rolls all but a trace of the localized load to the gate');
assert.ok(matches(sum(truck.bedPile),truck.payload));
assert.ok(matches(sum(truck.bedLoam),truck.cargoLoam));
assert.ok(matches(sum(truck.bedGravel),truck.cargoGravel));
assert.equal(fallingSand.length,0);
assert.ok(matches(sum(movedLoam),cargoAmount*testMix.loam),'The tipped pile keeps its loam');
assert.ok(matches(sum(movedGravel),cargoAmount*testMix.gravel),'The tipped pile keeps its gravel');
report.truck={bin,emittedLitres:emitted*AREA,remainingLitres:truck.payload*AREA,peakParcels:peak};

// Rigid blade engagement lifts part of the terrain. Continued drive reworks
// that supported wedge until the material is distributed on the grid.
initYard(0);
const original=sandTotal();
let peakBlade=0,peakWake=0;
for(let i=0;i<70;i++){
  physics(dt,{...noInput,drive:1,hy:i<18?-1:0});
  time+=dt;
  peakBlade=Math.max(peakBlade,fallingSand.filter(p=>p.origin==='blade').length);
  peakWake=Math.max(peakWake,fallingSand.filter(p=>p.origin==='tread').length);
  assert.ok(matches(sandTotal(),original),'Blade and treads conserve all transported soil');
}
assert.ok(peakBlade>10&&peakWake>4,'The drive generates a rolling cut and a tread wake');
vehicles[0].speed=0;
for(let i=0;i<160;i++)settleGrains(dt);
assert.equal(fallingSand.length,0);
report.dozer={peakBlade,peakWake};
return report;
`)(assert, () => ({ matches: false }));

console.log(JSON.stringify(report, null, 2));
