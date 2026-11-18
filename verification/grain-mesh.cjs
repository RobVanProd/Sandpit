// Integrate the closed triangles emitted for each clump around its expected center.
// One signed tetrahedron per face yields the occupied volume and first moment.
const fs=require('node:fs'),path=require('node:path');
const v=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const math=`const TAU=2*Math.PI,mix=(a,b,t)=>a+(b-a)*t,clamp=(a,l,h)=>Math.max(l,Math.min(h,a)),dot=(a,b)=>a.reduce((q,x,i)=>q+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],sub=(a,b)=>a.map((x,i)=>x-b[i]);const all=[];const wet=null,sample=()=>.3;const face=x=>all.push(x);function eye4(){return 0}function joint(b,x,y,z,pitch,spin,roll){return [Math.cos(spin),Math.sin(spin),Math.cos(pitch),Math.sin(pitch)]}function tf(m,[x,y,z]){const[c,s,K,S]=m,t=z*K-y*S;return [x*c+t*s,y*K+z*S,t*c-x*s]};`;
function error(fn){let ve=0,ce=0;for(let i=0;i<100;i++) {
 const volume=.00002+i*.0023,p=[2.8+i*.010,1.4,-2.7-i*.008];const faces=fn(volume,p,(i%18)/18,(i%31)/31,i*.241,i%3===0),center=[0,0,0];let sum=0;
 for(const triangle of faces){const [a,b,c]=triangle.map(q=>q.map((x,j)=>x-p[j]));const weight=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
 sum+=weight;for(let j=0;j<3;j++)center[j]+=weight*(a[j]+b[j]+c[j])/4;}
 ve=Math.max(ve,Math.abs(sum-volume));ce=Math.max(ce,Math.hypot(...center)/sum);}
 if(!Number.isFinite(ve+ce)||ve>1e-12||ce>1e-12)throw Error('volume or centroid drift');
 return {maxVolumeError:ve,maxCentroidError:ce};}
const field=fs.readFileSync(path.join(__dirname,'../field/index.html'),'utf8');
const fieldSource=math+v(field,'function grainPalette','function grainBed');
const fieldFn=new Function(fieldSource+`return (v,[x,y,z],m,t,yaw,ground)=>{all.length=0;drawGrain(grainClod(v,m,t,yaw,.17,.26,.13,ground),x,y,z);return all}`)();
const earth=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const earthSource=math+v(earth,'      const earthGrainRing','      let grainClock');
const earthFn=new Function(earthSource+`return (v,[x,y,z],m,t,yaw,ground)=>{all.length=0;earthClod({volume:v,x,y,z,moisture:m,spin:yaw,tone:t,vx:0.4,vz:0.2,vy:ground?0:1});return all}`)();
console.log({field:error(fieldFn),earthworks:error(earthFn)});
