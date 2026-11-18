const {chromium}=require('playwright-core'),fs=require('fs'),path=require('path'),{pathToFileURL}=require('url'),assert=require('assert/strict'),{execFileSync}=require('child_process');
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
 await step(25);await shot('01-diorama');await hold(['w','k'],19);await shot('02-bulldozer-pushing');let s=await stats('dozer');assert.ok(s.worked>.1);
 await page.keyboard.press('Space');await draw(22);await shot('03-pit-rim');
 await pick(1);await E(()=>sandpitQA.fixture(({vehicles:v,h,sample})=>{v[1].x=2;v[1].z=.7;v[1].yaw=0;v[1].y=sample(h,2,.7);v[1].lift=.01;v[1].curl=.17}));await hold(['w','l'],32);await page.keyboard.press('Space');await draw(24);await shot('04-loader-digging');s=await stats('loader digging');assert.ok(s.vehicles[1].payload>.05);
 // Park the loaded bucket over the receiving bed, then exercise the real controls.
 await E(()=>sandpitQA.fixture(({vehicles:v,tipPoint})=>{v[1].lift=.81;v[1].curl=.26;let [x,z]=tipPoint(v[1]);v[2].yaw=0;v[2].x=x;v[2].z=z+.65;v[2].lift=0;}));let amount=s.vehicles[1].payload;await hold(['j'],29);s=await stats('loader to truck');assert.ok(s.vehicles[2].payload>.01);assert.ok(s.vehicles[1].payload<amount);
 await pick(2);await hold(['w'],15);await hold(['i'],33);await draw(24);await shot('05-truck-tipping');s=await stats('truck unloading');assert.ok(s.vehicles[2].lift>.39);
 await pick(3);await E(()=>sandpitQA.fixture(({vehicles:v,h,sample})=>{v[3].x=-6;v[3].z=3;v[3].yaw=-1.6;v[3].lift=.36;v[3].y=sample(h,-6,3)}));await hold(['k','x','e'],25);await draw(26);await shot('06-excavator-cut');s=await stats('excavator cut');assert.ok(s.vehicles[3].payload>0);
 await E(()=>sandpitQA.view(1));await draw(22);await hold(['i','l'],45);await shot('07-excavator-swing');
 await E(()=>sandpitQA.scenario(1));await step(720);await draw(2);await shot('08-spillway');s=await stats('levee');
 // A controlled one-cell uncompressed berm between unequal water levels. Reshape
 // existing soil and water conservatively, then let the game's seepage erode it.
 const breach=await E(()=>sandpitQA.fixture(({h,w,fresh,at,NX,AREA})=>{const mid=at(-3.8,.1);const before=h[mid];let sand=0,water=0,don=at(11,7);for(let j=-3;j<=3;j++)for(let k=-3;k<=3;k++){let i=mid+j*NX+k,top=k===0?.78:.1,d=top-h[i];h[i]=top;sand+=d;let v=k<0?.70:0;water+=v-w[i];w[i]=v;if(k===0)fresh[i]=1}h[don]-=sand;for(let i=0;i<w.length&&water>1e-12;i++)if(Math.abs(i%NX-mid%NX)>5){let d=Math.min(w[i],water);w[i]-=d;water-=d}if(water<0)w[at(-7.8,-9.7)]-=water;return {mid,before:h[mid]}}));
 await step(160);let eroded=await E(m=>sandpitQA.fixture(({h})=>h[m]),breach.mid);assert.ok(eroded<breach.before-.015);
 await shot('09-levee-breach');await stats('controlled erosion');
 await E(()=>sandpitQA.scenario(2));await page.click('#programBtn');await page.locator('#flowRange').fill('0.99');await page.click('#rainBtn');await page.click('#dismiss');await page.click('#sound');await page.click('#sound');await page.click('#markBtn');await page.click('#markBtn');
 await E(()=>{window.testPad={index:0,connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[testPad]})});
 const proof=await E(()=>{let r=318707,rand=()=>((r=(Math.imul(1664525,r)+1013904223)>>>0)/4294967296),sets=new Set(),last=0,maxError=0;for(let batch=0;batch<360;batch++){let p=testPad;p.axes=Array.from({length:4},()=>rand()*2-1);p.buttons.forEach(b=>{b.value=0;b.pressed=false});let button=[5,4,12,14,15,0,1,2,6,7][Math.floor(rand()*10)];p.buttons[button].value=button===6||button===7?rand():1;p.buttons[button].pressed=true;sandpitQA.step(1);p.buttons[button].value=0;p.buttons[button].pressed=false;sandpitQA.step(14);if(batch%20===0){let s=sandpitQA.stats();if(!s.finite)throw Error('Nonfinite grid');maxError=Math.max(maxError,Math.abs(s.sand-s.initialSand));}sets.add(sandpitQA.stats().active)}return{simulatedSeconds:180,units:[...sets],maxError}});
 assert.equal(proof.units.length,4);console.log(JSON.stringify(proof));await stats('180 seconds randomized gamepad and rain');await E(()=>{Object.defineProperty(navigator,'getGamepads',{value:()=>[]});sandpitQA.scenario(0)});
 await page.setViewportSize({width:430,height:850});await draw(20);const cd=await page.context().newCDPSession(page);await cd.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await page.touchscreen.tap(220,350);await draw();
 const rect=async sel=>page.locator(sel).boundingBox();const a=await rect('#leftStick'),b=await rect('#rightStick');let pnt=(r,id)=>({x:r.x+r.width/2,y:r.y+r.height/2,id,radiusX:6,radiusY:6});let pa=pnt(a,1),pb=pnt(b,2);
 await cd.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pa,pb]});pa.y-=30;pb.y+=24;pb.x+=10;await cd.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[pa,pb]});const cmd=await E(()=>sandpitQA.input());assert.ok(cmd.drive>.2&&cmd.hy<-.15);await step(30);await shot('10-mobile-dual-stick');await cd.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.locator('#swapTouch').tap();await page.locator('#fineTouch').tap();await stats('multitouch');
 assert.deepEqual(errors,[]);fs.writeFileSync('captures/report.json',JSON.stringify({reports,proof,errors,touch:cmd},null,2));console.log('Headless browser acceptance passed.');
 await browser.close();
})().catch(err=>{console.error(err);process.exit(1)});
