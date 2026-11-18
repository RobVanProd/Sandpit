const fs=require('node:fs'), pathUtil=require('node:path'), assert=require('node:assert/strict');
for(const earth of [false,true]){
 const path=pathUtil.join(__dirname,'..',earth?'index.html':'field/index.html'),html=fs.readFileSync(path,'utf8');
 const start=html.lastIndexOf('<script>')+8,end=html.indexOf(earth?'      function look(':'// The sandbox draws at pixel resolution',start);
 let engine=html.slice(start,end);
 if(!earth)for(const [a,b] of [['const sub=','function look'],['const I=','let data=']]){
  const i=html.indexOf(a);engine+=html.slice(i,html.indexOf(b,i+a.length));
 }
 const stub=`const document={getElementById:()=>({getContext:()=>({fillRect(){}}),style:{}})};
 const matchMedia=()=>({matches:false});const location={protocol:'file:'};const rumble=()=>{};`;
 const tests=`
  ${earth?'resetWorld(0)':'initYard(0)'};
  const rock=${earth?'bed':'groundBed'},sediment=${earth?'sed':'silt'},measure=${earth?'area':'AREA'};
  const count=()=>{
   let mass=[0,0,0];
   const parts={};
   for(let i=0;i<h.length;i++){
    const t=h[i]-rock[i];
    assert.ok(Number.isFinite(t)&&t>=-1e-10,'bed remains fixed');
    sampleGround(i,Math.max(0,t),parts);
    const l=parts.loam+suspendedLoam[i],g=parts.gravel+suspendedGravel[i];
    assert.ok(l>=-1e-10&&g>=-1e-10&&l+g<=t+sediment[i]+1e-10,'valid material fractions');
    mass[0]+=(t+sediment[i]-l-g)*measure;
    mass[1]+=l*measure;mass[2]+=g*measure;
   }
   for(const parcel of ${earth?'grainClumps':'fallingSand'}){
    const volume=${earth?'parcel.volume':'parcel.amount*AREA'};
    mass[0]+=parcel.material.sand*volume;
    mass[1]+=parcel.material.loam*volume;
    mass[2]+=parcel.material.gravel*volume;
   }
   return mass;
  };
  const atPoint=${earth?'cell':'at'}, cx=3.3,cz=-3.1, i=atPoint(cx,cz);
  const baseTotals=count();
  const t=h[i]-rock[i];
  assert.ok(t>.20&&gravelShare[i]>.5,'buried gravel pocket');
  let material={loam:0,gravel:0};
  takeGround(i,t,material);
  assert.ok(material.loam>0&&material.gravel>0,'cut crosses both horizons');
  assert.equal(groundRock[i],1);assert.ok(groundHardness(i)>4);
  putGround(i,t,material.loam,material.gravel);
  assert.ok(groundRock[i]<.01,'returned cap covers rock');
  const dry=groundResponse(i);
  wet[i]=.45;const damp=groundResponse(i);
  wet[i]=1;const soaked=groundResponse(i);
  assert.ok(damp.repose>dry.repose&&dry.repose>soaked.repose);
  assert.ok(damp.hardness>dry.hardness&&damp.hardness>soaked.hardness);
  assert.ok(soaked.traction<dry.traction-.2);
  let cutMix={};
  const q=${earth?'dig(cx,cz,.75,.35,-Infinity,true,cutMix)':'remove(cx,cz,.75,.75,0,.55,Infinity,cutMix)'};
  assert.ok(q>0&&cutMix.loam>0&&cutMix.gravel>0);
  ${earth?'place(0,7,.65,q,0,true,cutMix,.3)':'deposit(0,7,.65,.65,0,q,cutMix)'};
  const delta=(sum)=>sum.map((v,k)=>v-baseTotals[k]);
  const brushError=delta(count());
  for(const e of brushError)assert.ok(Math.abs(e)<1e-8,'cut and dump mass including gravel');
  for(let k=0;k<120;k++){${earth?'waterStep(1/30)':'physics(1/30)'}}
  const waterAndSlopeError=delta(count());
  for(const e of waterAndSlopeError)assert.ok(Math.abs(e)<1e-8,'water and repose conserve material');
  // Build a damp, unsupported lip over water. The slide already debits its donor.
  // Moving the sheared portion into a clump must preserve every material separately.
  ${earth?'resetWorld(2)':'initYard(2)'};
  const clumps=${earth?'grainClumps':'fallingSand'};
  const bankCell=atPoint(2,2);
  const foot=bankCell+1;
  ${earth?'water':'w'}.fill(0);
  putGround(bankCell,.90,.22,.17);
  ${earth?'water':'w'}[foot]=.08;
  const bankBefore=count();
  ${earth?'soilSlopeStep(1/30)':'avalanche(1/30)'};
  const bankParcels=clumps.filter(p=>(p.kind||p.origin)==='bank');
  assert.ok(bankParcels.length>0,'A collapsing wet bank releases physical material');
  const bankAfter=count();
  assert.ok(bankBefore.every((v,k)=>Math.abs(v-bankAfter[k])<1e-8),'Bank release conserves each constituent');
  return {bankClumps:bankParcels.length,baseTotals,brushMix:cutMix,brushError,waterAndSlopeError,hardness:[dry.hardness,damp.hardness,soaked.hardness],traction:[dry.traction,damp.traction,soaked.traction]};
 `;
 console.log(path,JSON.stringify(new Function('assert',stub+engine+tests)(assert)));
}
