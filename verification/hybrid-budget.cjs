'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const earthworksAdapter = `
  const reset = () => resetWorld(0);
  function prepare(offset=0){
    active=2;
    const truck=rigs[2];
    truck.x=9;truck.z=6-offset;truck.y=sample(h,truck.x,truck.z);truck.yaw=0;truck.lift=1;
  }
  function refill(fraction=1){
    const truck=rigs[2],need=truck.capacity*fraction-truck.payload;
    truck.payload+=dig(-9,-2,2.3,need,-Infinity,false);
  }
  return {
    reset, prepare, refill,
    step:(dt,discharge)=>advance(dt,{...neutral(),lift:discharge?1:0}),
    toolOnly:(dt)=>machineStep(dt,{...neutral(),lift:1}),
    mass:sandMass,cargo:()=>rigs[2].payload,minGround:()=>h.reduce((m,n,i)=>Math.min(m,n-bed[i]),Infinity),
    grainCount:()=>typeof grainClumps==="undefined"?0:grainClumps.length,
    grains:()=>typeof grainClumps==="undefined"?[]:grainClumps.map(g=>({raw:g,...g})),
    hybrid:typeof emitClump==="function",
    materialFixture(type, moisture){
      if(typeof groundResponse!=="function")return null;
      resetWorld(0);
      brush(0,0,1.8,(i)=>{
        if(type==='rock')h[i]=bed[i];
        else putGround(i,.24,type==='loam'?.24:0,type==='gravel'?.24:0);
        pack[i]=0;wet[i]=moisture;refreshGround(i);
      });
      const before=sandMass(), composition={};
      const profile=groundResponse(cell(0,0));
      const volume=dig(0,0,1,.34,-Infinity,false,composition);
      place(7,-6,.20,volume,0,false,composition);
      return {volume,composition,profile,deposited:groundMaterial(cell(7,-6)),error:sandMass()-before};
    },
    clear() {
      for(let i=0;i<NN;i++)h[i]=Math.max(0,bed[i]);
      water.fill(0);wet.fill(0);
      putGround(cell(-9,5),2/area);
      rigs.forEach((v,i)=>Object.assign(v,{x:i<2?-11:11,z:i%2?-7:7,y:0,yaw:0,pitch:0,roll:0,speed:0}));
      flow=0;
    },
    settle:typeof grainStep==="function"?grainStep:null,
    height:(x,z)=>sample(h,x,z),
    cutGround(x,z,depth){
      const amount=dig(x,z,1.15,depth*.68,-Infinity,false);
      rigs[2].payload+=amount;
      return amount;
    },
    emit(x,y,z,vx,vy,vz,volume){
      const material=plainSand, amount=volume;
      const donor=cell(-9,5);
      if(h[donor]-bed[donor]<volume/area)throw Error("Fixture donor exhausted");
      takeGround(donor,volume/area);
      const accepted=emitClump(amount,{kind:'truck',source:2,x,y,z,vx,vy,vz,targetX:x,targetZ:z,
        spread:.39,moisture:0,material:material.sand==null?plainSand:material});
      if(accepted===false) place(-9,5,1.6,amount,0,false,material);
      else if (typeof accepted==="number"&&accepted<amount) place(-9,5,1.6,amount-accepted,0,false,material);
    },
    cap:typeof grainLimit==="number"?grainLimit:null
  };
`;

const fieldAdapter = `
  const reset = () => initYard(2);
  function prepare(offset=0){
    active=2;
    const truck=vehicles[2];
    truck.x=10;truck.z=1-offset;truck.y=sample(h,truck.x,truck.z);truck.yaw=0;truck.lift=1;
  }
  function refill(fraction=1){
    const truck=vehicles[2],need=truck.capacity*fraction-truck.payload;
    truck.payload+=remove(-12,-2.5,2.8,2.8,0,3,need);
  }
  return {
    reset, prepare, refill,
    step:(dt,discharge)=>{time+=dt;physics(dt,{...noInput,hy:discharge?1:0})},
    toolOnly:(dt)=>{tick++;mechanics(dt,{...noInput,hy:1})},
    mass:sandTotal,cargo:()=>vehicles[2].payload*AREA,
    minGround:()=>typeof groundBed==="undefined"?Math.min(...h)-floor:h.reduce((m,n,i)=>Math.min(m,n-groundBed[i]),Infinity),
    grainCount:()=>fallingSand.length,
    grains:()=>fallingSand.map(g=>({raw:g,x:g.x,y:g.y,z:g.z,vx:g.dx,vy:g.dy,vz:g.dz,volume:g.amount*AREA,radius:g.radius,mode:g.mode})),
    hybrid:typeof emergeGrain==="function",
    materialFixture(type, moisture){
      if(typeof groundResponse!=="function")return null;
      initYard(2);
      footprint(0,0,1.8,1.8,0,(i)=>{
        if(type==='rock')h[i]=groundBed[i];
        else putGround(i,.24,type==='loam'?.24:0,type==='gravel'?.24:0);
        pack[i]=0;wet[i]=moisture;refreshGround(i);
      });
      const before=sandTotal(), composition={};
      const profile=groundResponse(at(0,0));
      const amount=remove(0,0,1,1,0,.34,Infinity,composition);
      deposit(7,-6,.20,.20,0,amount,composition);
      return {volume:amount*AREA,composition,profile,deposited:groundMaterial(at(7,-6)),error:sandTotal()-before};
    },
    clear() {
      for(let i=0;i<N;i++)h[i]=Math.max(0,groundBed[i]);
      w.fill(0);wet.fill(0);pore.fill(0);
      putGround(at(-9,5),2/AREA);
      vehicles.forEach((v,i)=>Object.assign(v,{x:i<2?-14:14,z:i%2?-8:8,y:0,yaw:0,pitch:0,roll:0,speed:0}));
      flow=0;
    },
    settle:settleGrains,
    height:(x,z)=>sample(h,x,z),
    cutGround(x,z,depth){
      const amount=remove(x,z,1.15,1.15,0,depth);
      vehicles[2].payload+=amount;
      return amount*AREA;
    },
    emit(x,y,z,vx,vy,vz,volume){
      const amount=volume/AREA,donor=at(-9,5);
      if(h[donor]-groundBed[donor]<amount)throw Error("Fixture donor exhausted");
      takeGround(donor,amount);
      const accepted=emergeGrain(x,y,z,vx,vy,vz,amount,2,0,'tip');
      if(accepted===false) deposit(-9,5,.93,.93,0,amount);
      else if(typeof accepted==="number"&&accepted<amount) deposit(-9,5,.93,.93,0,amount-accepted);
    },
    cap:typeof MAX_GRAINS==="number"?MAX_GRAINS:null
  };
`;

function loadHybrid(filename, edition, options = {}) {
  const html=fs.readFileSync(filename,'utf8');
  const earthworks=edition==='earthworks';
  const start=html.lastIndexOf('<script>') + '<script>'.length;
  const end=html.indexOf(earthworks?'      function look(':'// The sandbox draws at pixel resolution',start);
  assert.ok(end>start, 'Extract simulation script from '+filename);
  let engine=html.slice(start,end);
  if (options.cap != null) {
    const anchor=earthworks?/(\bgrainLimit\s*=\s*)\d+/:/(\bMAX_GRAINS\s*=\s*)\d+/;
    assert.ok(anchor.test(engine), 'Find grain cap for stress fixture');
    engine=engine.replace(anchor,'$1'+String(options.cap));
  }
  if (!earthworks) {
    function section(from,to) {
      const i=html.indexOf(from),j=html.indexOf(to,i+from.length);
      assert.ok(i>=0&&j>i,"Missing field transforms: "+from);
      return html.slice(i,j);
    }
    engine+=section('const sub=','function look')+section('const I=','let data=');
  }
  const stub = `
    const document = { getElementById: () => ({ getContext: () => ({fillRect(){}}) }) };
    const matchMedia = () => ({ matches: false });
    const location = { protocol: 'file:' };
    const rumble=()=>{};
  `;
  return new Function(stub+engine+(earthworks?earthworksAdapter:fieldAdapter))();
}

// Deterministic solver fixtures on the exact HTML. No new browser or production hooks.
// Run: node verification/hybrid-budget.cjs
// Optional A/B: node verification/hybrid-budget.cjs --timing /path/to/baseline
const path=require('node:path');
const args=process.argv.slice(2),timing=args.includes('--timing');
const baseline=args.find(arg=>!arg.startsWith('-'));
const candidate=path.join(__dirname,'..');
const DT = 1 / 30;
const TOLERANCE = 1e-8;
const print = (label, result) => console.log(JSON.stringify({case: label, ...result}));
const percentile = (values, p) => [...values].sort((a,b) => a-b)[Math.floor(p * (values.length - 1))];
const quantiles = values => ({
  p50: +percentile(values, .5).toFixed(3),
  p95: +percentile(values, .95).toFixed(3),
  max: +Math.max(...values).toFixed(3),
});
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < TOLERANCE, `${message}: ${actual} versus ${expected}`);
const sum = xs => xs.reduce((a, b) => a + b, 0);

function monitor(solver) {
  const initial = solver.mass();
  let drift = 0;
  return {
    record() {
      drift = Math.max(drift, Math.abs(solver.mass() - initial));
      close(solver.mass(), initial, 'Conserved ground + airborne + suspended + payload');
      assert.ok(solver.minGround() >= -1e-9, 'Ground cannot pass the digging floor');
      assert.ok(solver.grains().every(g => g.volume > 0 && [g.x,g.y,g.z,g.volume].every(Number.isFinite)),
        'Every active grain has finite coordinates and positive volume');
    },
    drift: () => drift,
  };
}

function benchmark(solver, workload) {
  solver.reset();
  if (workload !== 'quiet') solver.prepare();
  const tickTimes = [], cpuTimes = [], activeCounts = [], hotTimes = [];
  const steps = workload === 'quiet' ? 430 : 520;
  for (let n = 0; n < steps; n++) {
    if (workload === 'truck' && (n % 36) === 0) solver.refill();
    const cpuBefore = process.threadCpuUsage?.();
    const start = performance.now();
    solver.step(DT, workload === 'truck');
    const elapsed = performance.now() - start;
    const cpu = cpuBefore && process.threadCpuUsage(cpuBefore);
    const cpuElapsed = cpu ? (cpu.user + cpu.system) / 1000 : null;
    const active = solver.grainCount();
    if (n >= 90) {
      tickTimes.push(elapsed);
      if(cpuElapsed!=null)cpuTimes.push(cpuElapsed);
      activeCounts.push(active);
      if (active > 0) hotTimes.push(elapsed);
    }
  }
  return { steps: tickTimes.length, wallMs: quantiles(tickTimes), cpuMs:cpuTimes.length?quantiles(cpuTimes):null, grains: quantiles(activeCounts),
    activeMs: hotTimes.length ? quantiles(hotTimes) : null };
}

function actualDischarge(solver) {
  solver.reset();
  solver.prepare();
  solver.refill();
  const cargo = solver.cargo();
  const ledger = monitor(solver);
  let airbornePeak = 0, peakCount = 0, releaseSteps=0;
  for (; releaseSteps < 600 && solver.cargo()>1e-9; releaseSteps++) {
    solver.step(DT,true);
    ledger.record();
    const grains = solver.grains();
    peakCount = Math.max(peakCount, grains.length);
    airbornePeak = Math.max(airbornePeak, sum(grains.map(g=>g.volume)));
  }
  close(solver.cargo(), 0, 'Truck releases the original load');
  let drainSteps=0;
  while(solver.grainCount()>0 && drainSteps++<360) {
    solver.step(DT,false);ledger.record();
  }
  const remaining=solver.grains();
  close(sum(remaining.map(g=>g.volume)), 0, 'Stopped tool drains active grains, examples '+JSON.stringify(
    remaining.slice(0,4).map(g=>({x:g.x,y:g.y,z:g.z,mode:g.mode,vy:g.vy,gap:g.y-solver.height(g.x,g.z)-g.radius*.66}))));
  return {cargo, airbornePeak, peakCount, releaseSeconds:releaseSteps*DT, drainSeconds:drainSteps*DT, drift:ledger.drift()};

}

let failures = 0;
for (const edition of ['earthworks', 'field']) {
  const name=edition==='earthworks'?'index.html':'field/index.html';
  const editions=baseline?[[baseline,'baseline'],[candidate,'candidate']]:[[candidate,'candidate']];
  for(const [directory,build] of editions){
    const solver=loadHybrid(path.join(directory,name),edition);
    const output=(scenario,metrics)=>print(scenario,{edition,build,...metrics});
    try { output('physical truck discharge',actualDischarge(solver)); }
    catch(error) {failures++;output('physical truck discharge',{failure:error.message});}
    if(timing)for(const workload of ['quiet','truck']){
      output('simulation timing',{workload,...benchmark(solver,workload)});
    }
  }
}

function ballisticDrop(solver) {
  solver.reset();solver.clear();
  const ledger=monitor(solver);
  const releaseY=2.1;
  solver.emit(0,releaseY,0,0,0,0,.016);
  const flight=[];
  for(let i=0;i<4;i++){
    solver.settle(DT);ledger.record();
    const grain=solver.grains()[0];
    assert.ok(grain,'Two-decimetre drop stays visible before impact');
    flight.push({y:grain.y,vy:grain.vy});
  }
  const last=flight.at(-1), seconds=flight.length*DT;
  const acceleration=-last.vy/seconds, fall=releaseY-last.y;
  assert.ok(Math.abs(acceleration-98.1)<4,'Airborne soil tracks gravity in scene decimetres');
  assert.ok(Math.abs(fall-.5*98.1*seconds**2)<.09,'Fall remains consistent with one trajectory');
  return {releaseY, seconds, acceleration, fall, drift:ledger.drift()};
}

function activeSupport(solver) {
  solver.reset(); solver.clear();
  const ledger = monitor(solver);
  solver.emit(0, .29, 0, 0, 0, 0, .018);
  let settledOnSurface = false, unsupportedTicks = 0, fastestDown = 0, largestFallStep = 0;
  for (let n=0;n<40;n++) {
    solver.settle(DT);
    const g = solver.grains()[0];
    if (g?.mode === 'slide' || (g && Math.abs(g.y - solver.height(g.x,g.z)) < g.radius*1.15)) {
      settledOnSurface = true;
      break;
    }
  }
  assert.ok(settledOnSurface, 'Fixture reaches a grounded active state before complete sleep');
  const beforeCut = solver.grains()[0];
  solver.cutGround(beforeCut.x, beforeCut.z, .48);
  let previous = beforeCut;
  for (let n=0;n<70;n++) {
    solver.settle(DT); ledger.record();
    const g = solver.grains()[0];
    const gap = previous.y - solver.height(previous.x,previous.z) - previous.radius;
    if (!g) {
      assert.ok(gap < .13, 'A particle can merge only within one physical step of ground contact');
      break;
    }
    if (g.y - solver.height(g.x,g.z) - g.radius > .13 && g.vy >= -.05) unsupportedTicks++;
    fastestDown = Math.max(fastestDown, -g.vy);
    largestFallStep = Math.max(largestFallStep, previous.y - g.y);
    previous = g;
  }
  assert.ok(unsupportedTicks <= 2 && fastestDown >= .25, 'Removing support must start a fall in two ticks');
  assert.ok(!solver.grains().length && largestFallStep < .33, 'Falls stop at the lower terrain without a large stage jump');
  return { unsupportedTicks, fastestDown, largestFallStep, drift:ledger.drift() };
}

function capStress(solver) {
  solver.reset(); solver.clear();
  const ledger = monitor(solver);
  const cap = solver.cap;
  let offered = 0, peak = 0, immediateRemoteDeposit = 0;
  for (let n=0;n<12;n++) {
    for (let k=0;k<12;k++) {
      const x=-3+(k%4)*1.3, z=-2+Math.floor(k/4)*1.5;
      const before=solver.height(x,z);
      solver.emit(x, 1.1+n*.01, z, .3, 0, .13, .006);
      offered += .006;
      immediateRemoteDeposit=Math.max(immediateRemoteDeposit,solver.height(x,z)-before);
      ledger.record();
      peak=Math.max(peak,solver.grains().length);
      assert.ok(peak <= cap, 'Grain count exceeds the configured cap');
    }
    solver.settle(DT);
  }
  for (let n=0;n<150;n++) {solver.settle(DT);ledger.record();}
  assert.equal(peak,cap,'Fixture really saturates the cap');
  const remaining=solver.grains();
  assert.equal(remaining.length,0,'Cap overload does not strand particles: '+
    JSON.stringify(remaining.slice(0,4).map(g=>({mode:g.mode,vy:g.vy,gap:g.y-solver.height(g.x,g.z)-g.radius*.66}))));
  return { cap, offered, peak, final:remaining.length, drift:ledger.drift(), immediateRemoteDeposit };

}

function realTruckAtCap(solver) {
  solver.reset();solver.prepare();solver.refill(.50);
  const ledger=monitor(solver), cargoInitial=solver.cargo();
  assert.ok(cargoInitial>.4,'Fixture has enough truck cargo to exceed cap');
  let steps=0;
  while(solver.grainCount()<solver.cap && steps++<30){solver.toolOnly(DT);ledger.record();}
  solver.toolOnly(DT);ledger.record();
  const count=solver.grainCount(), cargoAfter=solver.cargo();
  const inFlight=sum(solver.grains().map(g=>g.volume));
  assert.ok(count>0&&count<=solver.cap&&cargoAfter>0,'Cap leaves some unspent payload in truck');
  close(cargoAfter+inFlight,cargoInitial,'Overflow tip cannot move cargo directly to terrain');
  for(let i=0;i<150;i++){solver.settle(DT);ledger.record();}
  assert.equal(solver.grainCount(),0,'Existing clumps drain without new activity');
  let resumedSteps=0;
  let movedToClearPad=false;
  while(solver.cargo()>1e-8 && resumedSteps++<720) {
    if(resumedSteps===300){solver.prepare(4);movedToClearPad=true;}
    solver.step(DT,true);ledger.record();
  }
  const retainedCargo=solver.cargo();
  assert.ok(retainedCargo < .10*cargoAfter,'Tip must resume and discharge at least 90% of its paused load');
  return {cap:solver.cap,count,cargoInitial,cargoAfter,inFlight,retainedCargo,
    resumeSeconds:Math.min(720,resumedSteps)*DT,movedToClearPad,drift:ledger.drift()};

}

function collide(solver, pair) {
  solver.reset(); solver.clear();
  solver.emit(-.18,2.10,0,1.25,0,0,.015);
  if (pair) solver.emit(.18,2.10,0,-1.25,0,0,.015);
  const tracked = solver.grains()[0].raw;
  const trace = [];
  for (let n=0;n<8;n++) {
    solver.settle(DT);
    const g = solver.grains().find(g=>g.raw===tracked);
    if (!g) break;
    trace.push([g.x,g.y,g.z,g.vx,g.vy,g.vz]);
  }
  return trace;
}
function interGrain(solver) {
  const solo=collide(solver,false), duo=collide(solver,true);
  const delta=Math.max(...solo.slice(0,duo.length).flatMap((p,i)=>p.map((v,k)=>Math.abs(v-duo[i][k]))));
  assert.ok(delta>1e-4,'Equal-height, head-on particles exchange momentum');
  return {samples:duo.length, maxTrajectoryDifference:delta, directCollisionObserved:true};
}

function materialCosts(solver) {
  const sand=solver.materialFixture('sand',0);
  const dampSand=solver.materialFixture('sand',.4);
  const gravel=solver.materialFixture('gravel',0);
  const loam=solver.materialFixture('loam',0);
  const saturatedLoam=solver.materialFixture('loam',.99);
  const rock=solver.materialFixture('rock',0);
  if(!sand)throw Error('Material simulation missing');
  assert.ok(sand.volume > 1.65*gravel.volume && sand.volume > 1.65*loam.volume,
    'Same cut command yields less volume in gravel and loam');
  assert.equal(rock.volume,0,'Bedrock blocks excavation');
  assert.ok(dampSand.profile.repose > sand.profile.repose, 'Damp sand supports a steeper slope');
  assert.ok(saturatedLoam.profile.traction < .65*loam.profile.traction,'Saturated loam reduces traction');
  assert.ok(loam.composition.loam>.90 && loam.deposited.loam>.85,'Loam survives cut and deposit');
  assert.ok(gravel.composition.gravel>.90 && gravel.deposited.gravel>.85,'Gravel survives cut and deposit');
  for(const record of [sand,dampSand,gravel,loam,saturatedLoam,rock])close(record.error,0,'Material cut and redeposit conserve volume');
  return {sand,dampSand,gravel,loam,saturatedLoam,rock};
}

for (const edition of ['earthworks', 'field']) {
  const name = edition === 'earthworks' ? 'index.html' : 'field/index.html';
  const file = path.join(candidate,name);
  const solver = loadHybrid(file,edition);
  assert.ok(solver.hybrid,`Hybrid test API in ${edition}`);
  for (const [label,test] of [
    ['ballistic drop follows scene gravity',()=>ballisticDrop(solver)],
    ['removed-support active-to-rest cycle',()=>activeSupport(solver)],
    ['cap saturation mass and drain',()=>capStress(loadHybrid(file,edition,{cap:6}))],
    ['real truck at cap keeps unspent payload',()=>realTruckAtCap(loadHybrid(file,edition,{cap:6}))],
    ['same-height head-on trajectory comparison',()=>interGrain(solver)],
    ['cut, traction and deposited material',()=>materialCosts(solver)]
  ]) {
    try { print(label,{edition, ...test()}); }
    catch(error) { failures++; print(label,{edition,failure:error.message}); }
  }
}
process.exitCode=failures ? 1 : 0;
