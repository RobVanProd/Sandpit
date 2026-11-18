"""Reproduce the field acceptance run. Requires Python Playwright and Chromium.
Set SANDPIT_CHROMIUM to use an installed Chromium or headless-shell executable.
The game itself has no build step or runtime dependencies.
"""
import hashlib
import json
import math
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
GAME = HERE.parent / "index.html"
OUT = Path(os.environ.get("SANDPIT_EVIDENCE", HERE))
OUT.mkdir(parents=True, exist_ok=True)
errors = []
console_errors = []
report = {"html_sha256": hashlib.sha256(GAME.read_bytes()).hexdigest()}

def open_field(browser, mobile=False):
    page = browser.new_page(viewport={"width": 390 if mobile else 1440, "height": 844 if mobile else 900},
                            device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.goto(GAME.as_uri() + "?qa")
    page.wait_for_function("!!window.sandpitTest")
    page.evaluate("sandpitTest.pause()")
    return page

def step(p, frames, **controls):
    command = dict.fromkeys(("drive", "turn", "lift", "side", "dig", "dump", "feather"), 0)
    command.update(controls)
    p.evaluate("([n,c])=>sandpitTest.step(n,c)", [frames, command])

def state(p):
    result = p.evaluate("sandpitTest.state")
    assert result["finite"] and result["glError"] == 0, result
    assert abs(result["mass"] - result["initial"]) < 1e-8, result
    assert abs(result["waterError"]) < 1e-8, result
    return result

def capture(p, name):
    p.evaluate("sandpitTest.render(.05)")
    p.screenshot(path=OUT / (name + ".png"), animations="disabled")

def scene(p, view, yaw=.62, zoom=1):
    p.evaluate("([v,y,z])=>{sandpitTest.camera(y,z);sandpitTest.view(v)}", [view, yaw, zoom])

def main(p):
    ev = p.evaluate
    ev("sandpitTest.reset(0)")
    scene(p, 1)
    capture(p, "title")
    p.get_by_role("button", name="TAKE CONTROL").click()
    scene(p, 0)
    capture(p, "diorama")
    scene(p, 2)
    capture(p, "chase")

    # Exercise all four actuators and photograph them under actual load.
    for key in ["KeyW", "KeyK"]:
        p.keyboard.down(key)
    ev("sandpitTest.step(45)")
    p.keyboard.up("KeyK")
    p.keyboard.up("KeyW")
    assert ev("sandpitTest.rigs[0].travel") > .5
    assert ev("sandpitTest.rigs[0].work") > 0
    scene(p, 1, 1.08, 3.9)
    capture(p, "bulldozer-push")
    # The fixture positions rigs beside the same cut. Normal hydraulics perform every transfer.
    ev("sandpitTest.select(1);sandpitTest.aim(1,-4.2,4.9,.12)")
    step(p, 36, drive=.35, dig=1, side=.60)
    assert ev("sandpitTest.rigs[1].payload") > .01
    scene(p, 1, 1.3, 4.1)
    capture(p, "loader-scoop")
    step(p, 51, lift=1)
    ev("""()=>{const t=sandpitTest,r=t.rigs[1],v=t.rigs[2];t.aim(1,6,1.3,0);
    r.pitch=r.roll=r.steer=0;const [x,z]=t.point(1,r);t.aim(2,x,z+.54,0);v.lift=v.pitch=v.roll=0}""")
    before = ev("sandpitTest.rigs[1].payload")
    step(p, 45, dump=1)
    assert abs(ev("sandpitTest.rigs[2].payload") - before) < 1e-10, ev("sandpitTest.rigs")
    ev("sandpitTest.select(2)")
    step(p, 63, drive=.94)
    haul = ev("sandpitTest.rigs[2].travel")
    assert haul > 3
    step(p, 15, lift=1, drive=.38)
    assert 0 < ev("sandpitTest.rigs[2].payload") < before, (before, ev("sandpitTest.rigs[2]"))
    scene(p, 1, -.50, 4.15)
    capture(p, "truck-unload")
    step(p, 75, lift=1)
    assert ev("sandpitTest.rigs[2].payload") < 1e-10
    ev("sandpitTest.select(3);sandpitTest.aim(3,-7.7,-2.5,.8)")
    step(p, 33, dig=1, lift=-.5)
    assert ev("sandpitTest.rigs[3].payload") > .01
    scene(p, 1, -.85, 4.2)
    capture(p, "excavator-cut")
    step(p, 46, lift=1, side=.15)
    ex_load = ev("sandpitTest.rigs[3].payload")
    ev("""()=>{const t=sandpitTest,r=t.rigs[3],v=t.rigs[2];t.aim(1,11,7,0);t.aim(3,6,1.3,0);
    r.pitch=r.roll=0;const yaw=r.yaw+r.house,p=t.point(3,{...r,curl:.31,reach:Math.min(1,r.reach+.27)});
    t.aim(2,p[0]+.55*Math.sin(yaw),p[1]+.55*Math.cos(yaw),yaw);v.lift=v.pitch=v.roll=0}""")
    step(p, 44, dump=1)
    assert abs(ev("sandpitTest.rigs[2].payload") - ex_load) < 1e-10, ev("sandpitTest.rigs")
    report["transfers"] = {"loader_to_truck_litres": before, "excavator_to_truck_litres": ex_load,
                           "truck_travel_before_tip": haul, "final_sand_error_litres": state(p)["mass"]-state(p)["initial"]}

    # The untouched, leaking levee must develop a downstream breach under its own water pressure.
    p.select_option("#scenario", "2")
    scene(p, 1)
    for _ in range(900):
        ev("sandpitTest.step(5)")
        if ev("sandpitTest.state.breaches"):
            break
    s = state(p)
    assert s["breaches"] > 0
    capture(p, "levee-breach")
    report["natural_breach"] = {k: s[k] for k in ["clock","breaches","breachPos","initialCrest","crest"]}

    # Drive through the browser's Gamepad API and first verify rising-edge buttons.
    ev("""()=>{window.testPad={id:'Standard test pad',mapping:'standard',connected:true,index:0,axes:[0,0,0,0],
    buttons:Array.from({length:17},()=>({value:0,pressed:false}))};
    Object.defineProperty(navigator,'getGamepads',{value:()=>[window.testPad,null,null,null],configurable:true});
    window.dispatchEvent(new Event('gamepadconnected'));sandpitTest.reset(0);testPad.buttons[5]={value:1,pressed:true};
    sandpitTest.step(2);testPad.buttons[5]={value:0,pressed:false};sandpitTest.step(1)}""")
    assert state(p)["active"] == 1
    old_view=state(p)["view"]
    ev("testPad.buttons[0]={value:1,pressed:true};sandpitTest.step(2);testPad.buttons[0]={value:0,pressed:false};sandpitTest.step(1)")
    assert state(p)["view"] == (old_view+1)%3
    # Rain, full inflow, a seeded 4-minute stress run, and intermittent physical input events.
    p.click("#settings")
    p.check("#rain")
    p.locator("#flow").fill("100")
    p.click("#close")
    stats = ev("""()=>{const t=sandpitTest,g=testPad;let seed=43439;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    const visits=[0,0,0,0],peak=[0,0,0,0];let sand=0,water=0,lo=1e9,hi=-1e9,minSed=1,minWater=1,ok=true;
    for(let k=0;k<480;k++){g.axes=[random()*2-1,random()*2-1,random()*2-1,random()*2-1];
    for(let i of [2,3,5,6,7]){let v=i===2?+(random()>.42):i===3?+(random()>.83):i===5?+(k%5===0):random()*.4;g.buttons[i]={pressed:v>.5,value:v}}
    t.step(15);let s=t.state;visits[s.active]++;sand=Math.max(sand,Math.abs(s.mass-s.initial));water=Math.max(water,Math.abs(s.waterError));
    lo=Math.min(lo,s.minH);hi=Math.max(hi,s.maxH);minWater=Math.min(minWater,s.minWater);minSed=Math.min(minSed,s.minSed);
    ok&&=s.finite&&s.glError===0;for(let i=0;i<4;i++)peak[i]=Math.max(peak[i],t.rigs[i].payload);if(k%60===0)t.render(.04)}
    return {steps:7200,seconds:240,seed:43439,visits,peak_payload_litres:peak,travel:t.rigs.map(r=>r.travel),max_sand_error_litres:sand,max_water_error_litres:water,
    minimum_terrain:lo,maximum_terrain:hi,min_water:minWater,min_sediment:minSed,finite:ok,control_mode:t.state.inputMode}}""")
    assert stats["finite"] and max(stats["max_sand_error_litres"],stats["max_water_error_litres"]) < 1e-8
    assert min(stats["visits"]) > 0 and stats["control_mode"] == "gamepad"
    assert min(stats["min_water"],stats["min_sediment"]) >= 0
    report["randomized_storm"] = stats
    p.click("#audio")
    assert p.get_attribute("#audio","aria-pressed") == "true"
    p.click("#audio")
    p.click("#fold")
    assert not p.locator("#panel").is_visible()
    p.click("#fold")
    report["renderer"]=state(p)["renderer"]

def scenario_checks(p):
    p.evaluate("sandpitTest.reset(2)")
    result = p.evaluate("""()=>{const t=sandpitTest,
      c=(n,u={})=>t.step(n,{drive:0,turn:0,lift:0,side:0,dig:0,dump:0,feather:0,...u}),
      [sx,sz]=t.targets.spill, reports=[];
      t.select(3);
      const r=t.rigs[3],truck=t.rigs[2];
      t.aim(0,-9,7,0);t.aim(1,9,-7,0);t.aim(2,9,1,0);
      function excavate(offset, along=0) {
        r.house=0;r.lift=.08;r.reach=0;r.curl=.76;r.pitch=r.roll=0;
        const x=sx+offset,z=sz+.35*offset+along;
        t.aim(3,x-.29,z-2.50,0);
        c(14);
        for(let j=0;j<3;j++){
          const [tx,tz]=t.point(3,{...r,curl:1});
          t.aim(3,r.x+x-tx,r.z+z-tz,0);
        }
        c(46,{dig:1});
      }
      for (const [offset,along] of [[2.9,1.5],[3.5,1.45],[4.1,1.4],[4.7,1.35],[2.9,2.1],[3.5,2.05],[4.1,2],[4.7,1.95]]) {
        excavate(offset,along);
        const scooped=r.payload;
        c(44,{side:along ? -.64 : .64,lift:1});
        const yaw=r.yaw+r.house;
        const [tx,tz]=t.point(3,{...r,curl:.28,reach:.31});
        t.aim(2,tx+.54*Math.sin(yaw),tz+.54*Math.cos(yaw),yaw);
        truck.lift=truck.pitch=truck.roll=0;
        c(42,{dump:1});
        reports.push({cut:t.state.cutDepth,load:truck.payload,scooped,retained:r.payload,lip:t.tip(3,r)});
        if(truck.payload>2.4)break;
        t.aim(2,9,1,0);
      }
      t.aim(3,-8,-4.2,0);t.select(2);
      const [lx,lz]=t.targets.levee,yaw=Math.atan2(lx-truck.x,lz-truck.z);
      t.aim(2,truck.x,truck.z,yaw);
      const x=lx+Math.sin(yaw)*1.42,z=lz+Math.cos(yaw)*1.42;
      for(let i=0;i<800;i++){
        const dist=Math.hypot(x-truck.x,z-truck.z);if(dist<.035)break;
        const delta=Math.atan2(x-truck.x,z-truck.z)-truck.yaw;
        c(1,{drive:Math.min(1,dist*.65),turn:Math.max(-1,Math.min(1,-Math.atan2(Math.sin(delta),Math.cos(delta))*2))});
      }
      c(112,{lift:1});
      t.select(3);
      for(const offset of [-.62,.62,0,-.62,.62,0,-.62,.62,0,-.62,.62,0]){
        if(t.state.won)break;
        excavate(offset);
        c(39,{side:-1,lift:1});
        c(32,{dump:1});
        reports.push({finalCut:t.state.cutDepth,crest:t.state.crest});
      }
      return {reports,truck:{x:truck.x,z:truck.z,yaw:truck.yaw,travel:truck.travel,loaded:truck.haulDistance},
        position:t.point(2,truck),target:t.targets.levee,s:t.state};
    }""")
    s=state(p)
    assert s["won"] and not s["failed"] and s["completion"]["delivered"] > .34, result
    report["cut_and_fill"]={"fixture":"Staged excavation positions and truck heading. Normal hydraulics and forward drive.",
                            "truck_travel":result["truck"]["travel"],"completion":s["completion"]}
    scene(p,1,.78,1.6)
    capture(p,"levee-repair")
    p.evaluate("sandpitTest.reset(1)")
    result = p.evaluate("""()=>{const t=sandpitTest,r=t.rigs[3],step=(n,cmd={})=>t.step(n,{drive:0,turn:0,lift:0,side:0,dig:0,dump:0,feather:0,...cmd});
      const setFlow=(v)=>{const el=document.getElementById("flow");el.value=v;el.dispatchEvent(new Event("input"))};
      setFlow(0);t.select(3);t.aim(0,-11,7,0);t.aim(1,11,-7,0);t.aim(2,11,8,0);
      let loads=0,damLoads=0;
      function aimTip(x,z,yaw,curl){
        for(let j=0;j<4;j++){
          const [px,pz]=t.point(3,{...r,curl});
          t.aim(3,r.x+x-px,r.z+z-pz,yaw);
        }
      }
      function lowerAt(x,z){
        r.reach=0;r.house=0;r.curl=.76;r.lift=.04;r.pitch=r.roll=0;
        t.aim(3,x+2.4,z-.29,-Math.PI/2);step(9);
        aimTip(x,z,-Math.PI/2,1);
        step(34,{dig:1});
      }
      function unload(){
        const payload=r.payload;
        if(payload<.003)return;
        loads+=payload;
        step(33,{lift:1});
        if(damLoads<7.7){
          const i=Math.floor(damLoads/.42),x=4.35+(i%11)*.56,z=5.75+Math.floor(i/11)*.48;
          r.house=0;r.pitch=r.roll=0;
          t.aim(3,x,z+2.5,Math.PI);aimTip(x,z,Math.PI,.38);
          damLoads+=payload;
        }else{
          step(34,{side:1});
        }
        step(35,{dump:1});
      }
      function carve(a,b,target,passes){
        const n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.34);
        for(let stride=0;stride<passes;stride++)for(let i=0;i<=n;i++){
          const u=i/n,x=a[0]+(b[0]-a[0])*u,z=a[1]+(b[1]-a[1])*u;
          if(t.height(x,z)<target)continue;
          lowerAt(x,z);unload();
        }
      }
      carve([-2.45,3.65],[-8,3.7],.06,3);
      carve([-1.6,-1.90],[8.1,-1.8],-.06,5);
      const routes=[Array.from({length:18},(_,i)=>t.height(-2.45-i*.32,3.68)),
        Array.from({length:31},(_,i)=>t.height(-1.6+i*.32,-1.85))];
      setFlow(58);for(let i=0;i<25&&!t.state.won;i++)step(180);
      return {loads,damLoads,routes,basins:t.targets.basins.map(p=>[t.height(...p),t.depth(...p)]),
          camp:t.depth(8.8,6.4),s:t.state};
    }""")
    s=state(p)
    completion=s["completion"]
    assert s["won"] and completion["campDepth"]<.075 and min(completion["basinA"],completion["basinB"])>.19, result
    report["creek_diversion"]={"fixture":"Excavator staged to build a camp berm and cut two channels with the inlet closed. Production hydraulics, deposition and flow.",
                               "excavated_litres":result["loads"],"berm_payload_litres":result["damLoads"],"completion":completion}
    scene(p,0)
    capture(p,"creek-diversion")

def touch_check(browser):
    p = open_field(browser, True)
    p.locator("#start").tap()
    client=p.context.new_cdp_session(p)
    def pos(sel,dx,dy,id):
        b=p.locator(sel).bounding_box()
        return {"id":id,"x":b["x"]+b["width"]*(.5+dx),"y":b["y"]+b["height"]*(.5+dy)}
    left=pos("#left",.05,-.28,1)
    right=pos("#right",.16,-.26,2)
    client.send("Input.dispatchTouchEvent",{"type":"touchStart","touchPoints":[left]})
    client.send("Input.dispatchTouchEvent",{"type":"touchStart","touchPoints":[left,right]})
    p.evaluate("sandpitTest.step(30)")
    c=p.evaluate("sandpitTest.input()")
    assert c["drive"]>.2 and c["lift"]>.2 and c["side"]>.2,c
    scene(p,1,.62,2.8)
    capture(p,"mobile-controls")
    client.send("Input.dispatchTouchEvent",{"type":"touchEnd","touchPoints":[]})
    c2=p.evaluate("sandpitTest.input()")
    assert c2["drive"]==0 and c2["lift"]==0,c2
    p.locator("#fine").tap()
    p.locator("#next").tap()
    assert state(p)["active"]==1
    report["multitouch"]={"stick_inputs":c,"released":c2,"active_after_switch":1,"fine_mode":p.get_attribute("#fine","aria-pressed")}
    p.set_viewport_size({"width":844,"height":390})
    scene(p,2)
    capture(p,"mobile-landscape")
    assert p.evaluate("document.documentElement.scrollWidth===innerWidth")

with sync_playwright() as pw:
    executable=os.environ.get("SANDPIT_CHROMIUM")
    args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--disable-dev-shm-usage"]
    if os.environ.get("SANDPIT_SINGLE_PROCESS"): args+=["--no-zygote","--single-process","--in-process-gpu"]
    for suite in [main,touch_check]:
        b=pw.chromium.launch(executable_path=executable,headless=True,args=args)
        report["browser"]=b.version
        if suite is main:
            field=open_field(b)
            main(field)
            scenario_checks(field)
        else: touch_check(b)
        b.close()
report["console_errors"]=console_errors
report["page_errors"]=errors
assert not errors and not console_errors,(errors,console_errors)
(OUT/"results.json").write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps(report,indent=2))

