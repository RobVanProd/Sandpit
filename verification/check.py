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
    step(p, 36, lift=.95)
    ev("""()=>{const t=sandpitTest,r=t.rigs[1],p=t.point(1,r);t.aim(2,p[0]+.32,p[1],Math.PI/2)}""")
    before = ev("sandpitTest.rigs[1].payload")
    step(p, 45, dump=1)
    assert abs(ev("sandpitTest.rigs[2].payload") - before) < 1e-10
    ev("sandpitTest.select(2)")
    step(p, 63, drive=.94)
    haul = ev("sandpitTest.rigs[2].travel")
    assert haul > 3
    step(p, 22, lift=1, drive=.38)
    assert 0 < ev("sandpitTest.rigs[2].payload") < before
    scene(p, 1, -.50, 4.15)
    capture(p, "truck-unload")
    step(p, 75, lift=1)
    assert ev("sandpitTest.rigs[2].payload") < 1e-10
    ev("sandpitTest.select(3);sandpitTest.aim(3,-7.7,-2.5,.8)")
    step(p, 33, dig=1, lift=-.5)
    assert ev("sandpitTest.rigs[3].payload") > .01
    scene(p, 1, -.85, 4.2)
    capture(p, "excavator-cut")
    step(p, 21, lift=1, side=.6)
    ex_load = ev("sandpitTest.rigs[3].payload")
    ev("""()=>{const t=sandpitTest,p=t.point(3,t.rigs[3]);t.aim(2,p[0]+.35,p[1],Math.PI/2);t.rigs[2].lift=0}""")
    step(p, 40, dump=1)
    assert abs(ev("sandpitTest.rigs[2].payload") - ex_load) < 1e-10
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
    result = p.evaluate("""()=>{const t=sandpitTest,c=(n,u={})=>t.step(n,{drive:0,turn:0,lift:0,side:0,dig:0,dump:0,feather:0,...u}), [sx,sz]=t.targets.spill;
 const report=[]; t.select(3);const r=t.rigs[3];t.aim(2,sx+2.34,sz-1.95,0);for(let offset of [-.74,-.36,0,.36,.74]){
 r.house=0;r.lift=.12;r.reach=0;t.aim(3,sx+offset,sz+.35*offset-2.02,0);c(48,{dig:1});c(30,{side:1,lift:1});c(40,{dump:1});report.push([r.payload,t.state.cutDepth,t.rigs[2].payload]);}
 t.aim(3,-8,-4.2,0);t.select(2);const truck=t.rigs[2],[lx,lz]=t.targets.levee,yaw=Math.atan2(lx-truck.x,lz-truck.z);t.aim(2,truck.x,truck.z,yaw);let x=lx+Math.sin(yaw)*1.51,z=lz+Math.cos(yaw)*1.51;
 for(let i=0;i<800;i++){let dist=Math.hypot(x-truck.x,z-truck.z);if(dist<.04)break;let delta=Math.atan2(x-truck.x,z-truck.z)-truck.yaw;
 c(1,{drive:Math.min(1,dist*.62),turn:Math.max(-1,Math.min(1,Math.atan2(Math.sin(delta),Math.cos(delta))*2))})}
 c(100,{lift:1});return {report,truck:{x:truck.x,z:truck.z,yaw:truck.yaw,travel:truck.travel,loaded:truck.haulDistance},position:t.point(2,truck),target:t.targets.levee,s:t.state}}""")
    s=state(p)
    assert s["won"] and not s["failed"] and s["completion"]["delivered"] > .34, s
    report["cut_and_fill"]={"fixture":"Staged excavation positions and truck heading. Normal hydraulics and forward drive.",
                            "truck_travel":result["truck"]["travel"],"completion":s["completion"]}
    scene(p,1,.78,1.6)
    capture(p,"levee-repair")
    p.evaluate("sandpitTest.reset(1)")
    result = p.evaluate("""()=>{let t=sandpitTest;t.select(3);const r=t.rigs[3];const step=(n,cmd={})=>t.step(n,{drive:0,turn:0,lift:0,side:0,dig:0,dump:0,feather:0,...cmd});let loads=0;
 function cut(x,z,target){r.reach=0;r.house=0;r.lift=0;t.aim(3,x-.29,z-2.02,0);for(let n=0;n<3;n++){if(t.height(x,z)<target)break;r.house=0;r.lift=0;r.reach=0;step(45,{dig:1});if(r.payload<.002)break;loads+=r.payload;step(31,{side:-1,lift:1});step(25,{dump:1})}}
 for(let pass=0;pass<2;pass++)for(let j=0;j<7;j++){const z=4.4+j*.42; r.house=0;r.lift=0;r.reach=0;t.aim(3,4.15+pass*.35,z-2.26,-Math.PI/2);step(48,{dig:1});loads+=r.payload;step(30,{side:1,lift:1});step(40,{dump:1})}
 for(const [a,b] of [[[-4.9,-8.3],[-8,3.7]],[[-.95,-5.6],[8.1,-1.8]]]){const len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(len/.34);
 for(let i=0;i<=n;i++){let u=i/n;cut(a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u,.04-u*.13)}}
 step(2400);return {loads,basins:t.targets.basins.map(p=>[t.height(...p),t.depth(...p)]),camp:t.depth(8.8,6.4),s:t.state}}""")
    s=state(p)
    completion=s["completion"]
    assert s["won"] and completion["campDepth"]<.075 and min(completion["basinA"],completion["basinB"])>.19, s
    report["creek_diversion"]={"fixture":"Excavator staged to build a camp berm and cut two channels. Bucket, deposition and flow use production logic.",
                               "excavated_litres":result["loads"],"completion":completion}
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
