const {chromium}=require('playwright-core'),fs=require('fs'),path=require('path'),{pathToFileURL}=require('url'),assert=require('assert/strict');
(async()=>{
 const here=fs.existsSync('index.html')?path.resolve('index.html'):path.resolve('sandpit-host/dist/index.html');
 fs.mkdirSync('captures',{recursive:true});const errors=[],reports=[];
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1360,height:830},hasTouch:true});page.on('pageerror',e=>{console.error(e);errors.push(String(e))});page.on('console',e=>{if(e.type()==='error'){errors.push(e.text());console.log(e.text())}});
 // Verify the fully offline path, including the game's built-in font fallback.
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
 await page.goto(pathToFileURL(here)+'?qa');await page.waitForFunction(()=>window.sandpitQA);await page.evaluate(()=>sandpitQA.pause());
 const E=(f,args)=>page.evaluate(f,args),draw=async(n=1)=>E(n=>sandpitQA.draw(n),n),step=async(n)=>E(n=>sandpitQA.step(n),n);
 async function shot(name){await draw();await page.screenshot({path:'captures/'+name+'.png'});console.log('Captured',name)}
 async function pick(i){await page.keyboard.press(String(i+1))}
 async function hold(keys,n){for(const k of keys)await page.keyboard.down(k);await step(n);for(const k of keys)await page.keyboard.up(k)}
 async function stats(name){let s=await E(()=>sandpitQA.stats());let row={name,ticks:s.tick,sandError:s.sand-s.initialSand,waterError:s.waterError,finite:s.finite,glError:s.glError,breaches:s.breaches,campDepth:s.campDepth,basins:s.basinFill,worked:s.worked,payload:s.vehicles.map(v=>v.payload)};console.log(JSON.stringify(row));reports.push(row);assert.ok(s.finite);assert.ok(Math.abs(row.sandError)<1e-7);assert.ok(Math.abs(s.waterError)<1e-7);assert.ok(s.minWater>=0&&s.minSilt>-1e-10);assert.equal(s.glError,0);return s}
 await page.keyboard.press('1');await step(25);await shot('00-opening-yard');await E(()=>sandpitQA.view(0));await draw(30);await shot('01-diorama');await hold(['w','k'],19);await shot('02-bulldozer-pushing');let s=await stats('dozer');assert.ok(s.worked>.1);
 await page.keyboard.press('Space');await draw(22);await shot('03-pit-rim');
 await pick(1);await E(()=>sandpitQA.fixture(({vehicles:v,h,sample})=>{v[1].x=2;v[1].z=.7;v[1].yaw=0;v[1].y=sample(h,2,.7);v[1].lift=.01;v[1].curl=.17}));await hold(['w','l'],32);await page.keyboard.press('Space');await draw(24);await shot('04-loader-digging');s=await stats('loader digging');assert.ok(s.vehicles[1].payload>.05);
 // Park the loaded bucket over the receiving bed, then exercise the real controls.
 await E(()=>sandpitQA.fixture(({vehicles:v,tipPoint})=>{v[1].lift=1;v[1].speed=0;v[1].curl=.34;let [x,z]=tipPoint(v[1]);v[2].yaw=0;v[2].x=x;v[2].z=z+.65;v[2].lift=0;}));let amount=s.vehicles[1].payload;await hold(['j'],29);s=await stats('loader to truck');assert.ok(s.vehicles[2].payload>.01);assert.ok(s.vehicles[1].payload<amount);
 await pick(2);await E(()=>sandpitQA.fixture(({vehicles:v,h,sample})=>{v[2].x=9;v[2].z=-.4;v[2].yaw=-.86;v[2].y=sample(h,v[2].x,v[2].z)}));await hold(['w'],26);await hold(['i'],33);await draw(24);await shot('05-truck-tipping');s=await stats('truck unloading');assert.ok(s.vehicles[2].lift>.39);
 await pick(3);await E(()=>sandpitQA.fixture(({vehicles:v,h,sample})=>{v[3].x=-6;v[3].z=3;v[3].yaw=-1.6;v[3].lift=.36;v[3].y=sample(h,-6,3)}));await hold(['k','x','e'],25);await draw(26);await shot('06-excavator-cut');s=await stats('excavator cut');assert.ok(s.vehicles[3].payload>0);
 await E(()=>sandpitQA.view(1));await draw(22);await hold(['i','l'],45);await shot('07-excavator-swing');
 await E(()=>sandpitQA.scenario(1));await step(720);await draw(2);await shot('08-spillway');s=await stats('levee');
 // Let the running spigot eat into the original scenario levee. No fixture edit.
 let breached=false;for(let i=0;i<45;i++){await step(150);if((await E(()=>sandpitQA.stats().breaches))>0){breached=true;break}}assert.ok(breached,'Natural levee breach');await step(360);await draw();await shot('09-levee-breach');await stats('natural levee breach');
 await E(()=>sandpitQA.scenario(2));await page.click('#programBtn');await page.locator('#flowRange').fill('0.99');await page.click('#rainBtn');await page.click('#dismiss');await page.click('#sound');await page.click('#sound');await page.click('#markBtn');await page.click('#markBtn');
 await E(()=>{window.testPad={index:0,connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[testPad]})});
 const proof=await E(()=>{let r=318707,rand=()=>((r=(Math.imul(1664525,r)+1013904223)>>>0)/4294967296),sets=new Set(),last=0,maxError=0;for(let batch=0;batch<360;batch++){let p=testPad;p.axes=Array.from({length:4},()=>rand()*2-1);p.buttons.forEach(b=>{b.value=0;b.pressed=false});let button=[5,4,12,14,15,0,1,2,6,7][Math.floor(rand()*10)];p.buttons[button].value=button===6||button===7?rand():1;p.buttons[button].pressed=true;sandpitQA.step(1);p.buttons[button].value=0;p.buttons[button].pressed=false;sandpitQA.step(14);if(batch%20===0){let s=sandpitQA.stats();if(!s.finite)throw Error('Nonfinite grid');maxError=Math.max(maxError,Math.abs(s.sand-s.initialSand));}sets.add(sandpitQA.stats().active)}return{simulatedSeconds:180,units:[...sets],maxError}});
 assert.equal(proof.units.length,4);console.log(JSON.stringify(proof));await stats('180 seconds randomized gamepad and rain');await E(()=>{Object.defineProperty(navigator,'getGamepads',{value:()=>[]});sandpitQA.scenario(0)});
 await page.setViewportSize({width:430,height:850});await draw(20);const cd=await page.context().newCDPSession(page);await cd.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await page.touchscreen.tap(220,350);await draw();
 const rect=async sel=>page.locator(sel).boundingBox();const a=await rect('#leftStick'),b=await rect('#rightStick');let pnt=(r,id)=>({x:r.x+r.width/2,y:r.y+r.height/2,id,radiusX:6,radiusY:6});let pa=pnt(a,1),pb=pnt(b,2);
 await cd.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pa,pb]});pa.y-=30;pb.y+=24;pb.x+=10;await cd.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[pa,pb]});const cmd=await E(()=>sandpitQA.input());assert.ok(cmd.drive>.2&&cmd.hy<-.15);await step(30);await shot('10-mobile-dual-stick');await cd.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.locator('#swapTouch').tap();await page.locator('#fineTouch').tap();await stats('multitouch');

 // Hydrology acceptance fixture: move soil into two berms and a spoil pile,
 // while leaving water, inlet, sediment and payloads completely untouched.
 await page.setViewportSize({width:1360,height:830});await E(()=>sandpitQA.scenario(0));await page.keyboard.press('1');
 const earthworks=await E(()=>sandpitQA.fixture(({h,NX,NZ,DX,AREA,basins,deposit})=>{
   const halfZ=(NZ-1)*DX/2,river=z=>-7.8+3.2*Math.sin((z+halfZ)*.33)+.39*(z+halfZ);
   const line=(earth,x,z,bx,bz,width,end,bend)=>{let ax=river(-3.5),az=-3.5,dx=bx-ax,dz=bz-az,u=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz))),d=Math.hypot(x-ax-dx*u,z-az-dz*u-bend*Math.sin(u*Math.PI*2));return earth+Math.exp(-((d/width)**3))*(Math.min(earth,-.20+(end+.2)*u)-earth)};
   let cut=0;for(let k=0;k<h.length;k++){let x=(k%NX)*DX-16,z=Math.floor(k/NX)*DX-halfZ,y=h[k];y=line(y,x,z,8,-5,.95,-.55,.19);y=line(y,x,z,6.3,5,.97,-.65,-.54);for(let [cx,cz,r] of basins)y=Math.min(y,y+(-.64-y)*Math.exp(-((Math.hypot(x-cx,z-cz)/(r*.87))**4)));cut+=h[k]-y;h[k]=y}
   const mold=Math.min(520,cut*.65);deposit(river(-1.6),-1.6,2.78,1.07,0,mold*.77);deposit(river(4.1),4.1,2.8,1.16,0,mold*.23);deposit(12,7,3.9,3.2,0,cut-mold);return {excavatedLitres:cut*AREA,bermLitres:mold*AREA}
 }));let won=false;for(let k=0;k<50;k++){await step(120);if(await E(()=>sandpitQA.stats().goal)){won=true;break}}
 console.log('Diverted creek:',earthworks);await stats('two-basin diversion');assert.ok(won,'Both basins fill while camp stays dry');await E(()=>sandpitQA.view(1));await draw(35);await shot('11-completed-diversion');
 assert.deepEqual(errors,[]);fs.writeFileSync('captures/report.json',JSON.stringify({reports,proof,errors,touch:cmd,earthworks},null,2));console.log('Headless browser acceptance passed.');
 await browser.close();
})().catch(err=>{console.error(err);process.exit(1)});
