const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../field/index.html'),'utf8');
function section(from,to){
 const start=html.indexOf(from);
 const end=html.indexOf(to,start+from.length);
 assert(start>=0&&end>start,'Locate '+from+' in the shipped game');
 return html.slice(start,end);
}
// Run the game's fixed-step mechanics and rigid transforms against small parked-rig fixtures.
const src=section("'use strict';","// The sandbox draws at pixel resolution")+
 section('const sub=','function look')+
 section('const I=','let data=');
vm.runInNewContext(src+`
function rumble(){}
const dt=1/30;
const report={};
function fixture(type,a,other,b){
 initYard(2);
 h.fill(0);w.fill(0);wet.fill(0);
 vehicles.forEach((v,i)=>Object.assign(v,{x:i<2?-14:14,z:i%2?-8:8,y:0,yaw:0,pitch:0,roll:0,speed:0}));
 const v=vehicles[type],o=vehicles[other];
 Object.assign(v,a);Object.assign(o,b);
 active=type;
 return [v,o];
}
const contact=(v,o)=>contactSeverity(vehicleSolids(v),vehicleSolids(o));
function run(v,o,ctl,n=90,nonIntersect=true){
 for(let i=0;i<n;i++){
  mechanics(dt,{...noInput,...ctl});
  if(nonIntersect)assert(contact(v,o)<1e-8,JSON.stringify({i,type:v.type,swing:v.swing,penetration:contact(v,o)}));
 }
}
{
 const [dozer,truck]=fixture(0,{x:0,z:0,lift:.17},2,{x:0,z:6});
 run(dozer,truck,{drive:1},160);
 report.bladeStopsAt=dozer.z;
 assert(dozer.z>1.9&&dozer.z<3.0&&4.0>truck.z-dozer.z);
 run(dozer,truck,{drive:-1},80);
 assert(dozer.z<report.bladeStopsAt-2.0,'Reverse leaves the contact');
}
{
 const [truck,dozer]=fixture(2,{x:0,z:6},0,{x:0,z:0,yaw:Math.PI,lift:.16});
 run(truck,dozer,{drive:-1},150);
 report.reverseStopsAt=truck.z;
 assert(truck.z>2.7&&truck.z<3.6);
 run(truck,dozer,{drive:1},60);
 assert(truck.z>report.reverseStopsAt+2);
}
{
 const [dozer,truck]=fixture(0,{x:0,z:0,lift:.17},2,{x:3.10,z:1.65});
 run(dozer,truck,{steer:-1},40);
 report.steeringStopsAt=dozer.yaw;
 assert(dozer.yaw>.16&&dozer.yaw<1.15,'A pivot stops when the blade corner reaches the parked truck');
 run(dozer,truck,{steer:1},25);
 assert(dozer.yaw<report.steeringStopsAt-.40,'Pivot can reverse away from contact');
}
{
 const [exc,truck]=fixture(3,{x:0,z:0,lift:.37,stick:.95,swing:-1.05},2,{x:3.10,z:2.93});
 run(exc,truck,{hx:-1},85);
 report.slewStopsAt=exc.swing;
 assert(exc.swing>-.9&&exc.swing<1.65,'Slew stops on the neighboring truck');
 run(exc,truck,{hx:1},25);
 assert(exc.swing<report.slewStopsAt-.50,'Slew can reverse away');
}
{
 const [dozer,truck]=fixture(0,{x:0,z:0,lift:.16},2,{x:0,z:3.25});
 const before=contact(dozer,truck);
 assert(before>0,'Fixture starts with a tool overlap');
 run(dozer,truck,{drive:1},20,false);
 assert(dozer.z<.08,'Commands cannot deepen initial overlap');
 run(dozer,truck,{drive:-1},75,false);
 report.initialOverlap=before;
 assert(dozer.z<-1.2&&contact(dozer,truck)<1e-8,'Can reverse out of staged overlap');
}
{
 const [loader,truck]=fixture(1,{x:0,z:0,lift:1,curl:.52,payload:5},2,{x:0,z:5.2,lift:0});
 run(loader,truck,{drive:1},33);
 const before=loader.z;
 const tip=tipPoint(loader);
 assert(before>.9 && tip[1]>truck.z-1.7 && tip[1]<truck.z+.7,'Raised loader reaches above open bed');
 run(loader,truck,{hx:-1},33);
 for(let i=0;i<33;i++)settleGrains(dt);
 report.caughtLitres=truck.payload*AREA;
 assert(truck.payload>.25,'Raised loader transfers sand into an open bed');
 const high=loader.lift;
 run(loader,truck,{hy:-1},45);
 report.loweringStopsAt=loader.lift;
 assert(loader.lift>.21&&loader.lift<high,'Bucket cannot lower into the truck solids');
}
console.log(report);
`,{assert,console,matchMedia:()=>({matches:false}),document:{getElementById:()=>({style:{}})}});
