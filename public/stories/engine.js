/* Point-cloud story engine shared by the story pages.
   A page defines scenes (samplers built from the helpers in PointStory.H) and one shot per caption,
   then calls PointStory.run(). Two scene slots live on the GPU; the engine swaps scenes into them as
   the reader scrolls and morphs between the pair. */
(function(){
'use strict';
const R=Math.random,TAU=Math.PI*2;
const rn=(a,b)=>a+R()*(b-a);
const fr=x=>x-Math.floor(x);
const gs=()=>(R()+R()+R()+R()-2)*1.732;
const smooth=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
function inBall(){let x,y,z;do{x=rn(-1,1);y=rn(-1,1);z=rn(-1,1);}while(x*x+y*y+z*z>1);return [x,y,z];}
function archOpen(dx,y,aw,sp){return dx<aw&&(y<sp||(y-sp)*(y-sp)+dx*dx<aw*aw);}
function cw(a){const s=a.reduce((x,y)=>x+y,0);let c=0;return a.map(v=>(c+=v/s));}
function choose(c){const r=R();for(let i=0;i<c.length;i++)if(r<=c[i])return i;return c.length-1;}

/* Every point carries xyz + w. w = brightness (0..3.9) + 4 * motion class.
   0 still · 1 circles the centre (tawaf) · 2/3 slow turn either way · 4 far sky drift · 5 wind sway
   6 light flowing outward · 7 sand blowing along +x · 8 motes rising · 9 streaming into the centre
   10 swarm · 11 slither · 12 sea waves · 13 walking toward -z · 14 churning water wall · 15 rain
   16 flame · 17 river ripple and current */
const o={x:0,y:0,z:0,w:1};
// the last normal handed to shadeN() travels with the next point (octahedral-packed), for the displacement map
let lnx=0,lny=1,lnz=0;
function packN(x,y,z){const l=Math.abs(x)+Math.abs(y)+Math.abs(z)||1;let u=x/l,v=z/l;
  if(y<0){const uu=(1-Math.abs(v))*(u>=0?1:-1),vv=(1-Math.abs(u))*(v>=0?1:-1);u=uu;v=vv;}
  return Math.round((u*.5+.5)*255)*256+Math.round((v*.5+.5)*255);}
function set(x,y,z,b,m){o.x=x;o.y=y;o.z=z;o.w=Math.min(Math.max(b,0),3.9)+4*(m||0);o.n=packN(lnx,lny,lnz);lnx=0;lny=1;lnz=0;return true;}
// baked key light (a high moon, front-left) so surfaces read as forms
const LD=(()=>{const v=[-.45,.72,.53],l=Math.hypot(...v);return v.map(c=>c/l);})();
const shadeN=(x,y,z)=>{lnx=x;lny=y;lnz=z;return .34+.86*Math.max(0,x*LD[0]+y*LD[1]+z*LD[2]);};

/* ---------- structured scan lattice ----------
   Surfaces are drawn, not sprinkled: most points snap onto horizontal contour rings or vertical
   grid lines so a primitive reads as architectural wireframe instead of a noise field. A minority
   stay free, which keeps surfaces reading as solid rather than as hollow stripes.
   `per` is lines per world unit, so a tall wall gets many rings and a small object only a few. */
const LATR=.66;                                    // share of points that ride a contour ring
const latN=(span,per)=>Math.max(2,Math.round(Math.abs(span)*per));
const latQ=(v0,span,per)=>{const n=latN(span,per);return v0+span*(Math.round(R()*n)/n);};
const latAng=n=>Math.floor(R()*Math.max(6,n))/Math.max(6,n)*TAU;

/* ---------- primitives: each places one point and returns true ---------- */
function box(cx,y0,cz,hw,h,hd,b,m,eb){
  const ax=2*hd*h,az=2*hw*h,at=4*hw*hd;let r=R()*(2*ax+2*az+at),x,y,z,nx=0,ny=0,nz=0;
  // each face is ruled: points ride either a horizontal course line or a vertical joint line
  const ruled=R()<LATR;
  if(r<2*ax){nx=r<ax?1:-1;x=cx+nx*hw;
    if(ruled){y=latQ(y0,h,5);z=cz+rn(-hd,hd);}else{y=y0+R()*h;z=latQ(cz-hd,2*hd,5);}}
  else if(r<2*ax+2*az){nz=r<2*ax+az?1:-1;z=cz+nz*hd;
    if(ruled){y=latQ(y0,h,5);x=cx+rn(-hw,hw);}else{y=y0+R()*h;x=latQ(cx-hw,2*hw,5);}}
  else{ny=1;y=y0+h;
    if(ruled){x=latQ(cx-hw,2*hw,5);z=cz+rn(-hd,hd);}else{x=cx+rn(-hw,hw);z=latQ(cz-hd,2*hd,5);}}
  const e=.05+.005*(hw+hd+h);let ec=0;
  if(Math.abs(Math.abs(x-cx)-hw)<e)ec++;if(Math.abs(Math.abs(z-cz)-hd)<e)ec++;if(y0+h-y<e||y-y0<e)ec++;
  return set(x,y,z,(ec>=2?(eb||b*1.8):b)*shadeN(nx,ny,nz)*1.2,m);
}
// a revolve drawn as contour rings plus vertical staves
function cyl(cx,y0,cz,r,h,b,m){
  let th,y;
  if(R()<LATR){th=R()*TAU;y=latQ(y0,h,5);}                  // horizontal contour ring
  else{th=latAng(Math.round(r*11));y=y0+R()*h;}             // vertical grid line
  const c=Math.cos(th),s=Math.sin(th);
  return set(cx+c*r,y,cz+s*r,b*shadeN(c,0,s)*1.2,m);}
// a dome drawn as latitude rings plus meridians
function dome(cx,y0,cz,r,sy,b,m){
  let th,cp;
  if(R()<LATR){const n=latN(r,3.2);cp=Math.round(R()*n)/n;th=R()*TAU;}   // latitude ring
  else{th=latAng(Math.round(r*9));cp=R();}                               // meridian
  const sp=Math.sqrt(Math.max(0,1-cp*cp)),nx=sp*Math.cos(th),nz=sp*Math.sin(th);
  return set(cx+nx*r,y0+cp*r*(sy||1),cz+nz*r,b*shadeN(nx,cp,nz)*1.2,m);}
function sphere(cx,cy,cz,r,b,m){const th=R()*TAU,cp=rn(-1,1),sp=Math.sqrt(1-cp*cp),nx=sp*Math.cos(th),nz=sp*Math.sin(th);
  return set(cx+nx*r,cy+cp*r,cz+nz*r,b*shadeN(nx,cp,nz)*1.2,m);}
function ellip(cx,cy,cz,rx,ry,rz,b,m){const th=R()*TAU,cp=rn(-1,1),sp=Math.sqrt(1-cp*cp),nx=sp*Math.cos(th),nz=sp*Math.sin(th);
  return set(cx+nx*rx,cy+cp*ry,cz+nz*rz,b*shadeN(nx,cp,nz)*1.2,m);}
function disk(cx,y,cz,r,b,m){const a=R()*TAU,rr=Math.sqrt(R())*r;return set(cx+Math.cos(a)*rr,y,cz+Math.sin(a)*rr,b,m);}
function ring(cx,y,cz,r,w,b,m){const a=R()*TAU,rr=r+gs()*w;return set(cx+Math.cos(a)*rr,y,cz+Math.sin(a)*rr,b,m);}
function rod(ax,ay,az,bx,by,bz,r,b,m){const t=R(),[i,j,k]=inBall();return set(ax+(bx-ax)*t+i*r,ay+(by-ay)*t+j*r,az+(bz-az)*t+k*r,b,m);}
// a human figure in a robe; pose: stand | walk | raise | sit | bow
function figure(px,pz,y0,h,b,m,fx,fz,pose){
  let ux=1,uz=0;if(fx||fz){const l=Math.hypot(fx,fz);ux=fx/l;uz=fz/l;}
  const sx=-uz,sz=ux,k=h/1.75,q=R(),ph=R()*TAU,c=Math.cos(ph),sn=Math.sin(ph);
  let a,sd,y,na=c,ns=sn,ny=0; // local: a forward, sd sideways, y up
  const sit=pose==='sit',dy=sit?-.48*k:0;
  if(q<.11){const cp=rn(-1,1),sp=Math.sqrt(1-cp*cp);na=sp*c;ns=sp*sn;ny=cp;a=na*.1*k;sd=ns*.095*k;y=1.62*k+ny*.12*k+dy;}
  else if(q<.13){a=c*.05*k;sd=sn*.05*k;y=rn(1.46,1.54)*k+dy;}
  else if(q<.35){const cp=rn(-1,1),sp=Math.sqrt(1-cp*cp);na=sp*c;ns=sp*sn;ny=cp;a=na*.12*k;sd=ns*.2*k;y=1.24*k+ny*.22*k+dy;}
  else if(q<.8){
    if(sit){const t=R();if(R()<.55){a=t*.45*k;sd=(R()<.5?-1:1)*rn(0,.15)*k;y=(.45+.06*c)*k;ny=1;na=0;ns=0;}
      else{a=.45*k+c*.07*k;sd=(R()<.5?-.09:.09)*k+sn*.07*k;y=R()*.45*k;}}
    else{const t=R(),y1=.05+t*1.0,rs=(.17+.09*(1-t))*k,ra=(.12+.08*(1-t))*k;
      a=c*ra+(pose==='walk'?(1-t)*.08*k*Math.sin(px*3+pz):0);sd=sn*rs;y=y1*k;}}
  else if(q<.96){const sg=R()<.5?-1:1,t=R();let ha=.03,hs=.25,hy=.78;
    if(pose==='walk'){ha=sg*.18*Math.sin(px+pz)||.15;}else if(pose==='raise'){ha=.12;hs=.32;hy=1.95;}else if(sit){ha=.35;hs=.18;hy=.62+.48;}
    a=ha*t*k+c*.045*k;sd=sg*(.21+(hs-.21)*t)*k+sn*.045*k;y=(1.4+(hy-1.4)*t)*k+dy*(sit?0:1);}
  else{const sg=R()<.5?-1:1,[i,j,kk]=inBall();a=(sit?.5:.08)*k+i*.08*k;sd=sg*.09*k+kk*.05*k;y=Math.abs(j)*.06*k;}
  if(pose==='bow'&&y>.95*k){const hy=.95*k,r0=y-hy,an=1.35;const na2=a*Math.cos(an)+r0*Math.sin(an);y=hy+r0*Math.cos(an)-a*Math.sin(an);a=na2;}
  const nx=ux*na+sx*ns,nz=uz*na+sz*ns;
  return set(px+ux*a+sx*sd,y0+y,pz+uz*a+sz*sd,b*shadeN(nx,ny,nz)*1.25,m);
}
function person(px,pz,y0,h,b,m,fx,fz,pose){return figure(px,pz,y0,h,b,m,fx,fz,pose||(m===13?'walk':'stand'));}
// a prophet or an angel shown only as light: a soft human silhouette with an aura, no features
function light(px,pz,y0,h,fx,fz,pose,b){
  if(R()<.22){const [i,j,k]=inBall(),kk=h/1.75;return set(px+i*.55*kk,y0+(.9+j*.95)*kk,pz+k*.55*kk,(b||1.6)*.28,18);}
  figure(px,pz,y0,h,1,18,fx,fz,pose);const kk=h/1.75;o.x+=gs()*.035*kk;o.y+=gs()*.035*kk;o.z+=gs()*.035*kk;o.w=Math.min(3.9,b||1.6)+72;return true;
}
function prostrate(px,pz,y0,b,fx,fz){ // a figure in sujood: low rounded back, head to the ground
  const l=Math.hypot(fx,fz)||1,ux=fx/l,uz=fz/l,q=R();
  if(q<.8){const th=R()*TAU,cp=R(),sp=Math.sqrt(1-cp*cp),a=sp*Math.cos(th)*.45,w=sp*Math.sin(th)*.22;
    return set(px+ux*a-uz*w,y0+cp*.5,pz+uz*a+ux*w,b);}
  const [i,j,k]=inBall();return set(px+ux*.6+i*.12,y0+.12+j*.1,pz+uz*.6+k*.12,b);
}
// a camel: deep barrel body, hump, long neck rising to a small head, four tall legs
function camel(px,pz,y0,s,ang,b,walk){
  const ux=Math.cos(ang),uz=Math.sin(ang),q=R(),P=(a,w,y)=>set(px+ux*a-uz*w,y0+y,pz+uz*a+ux*w,b);
  if(q<.42){const th=R()*TAU,cp=rn(-1,1),sp=Math.sqrt(1-cp*cp);          // body
    return P(cp*.95*s,sp*Math.cos(th)*.42*s,(1.45+sp*Math.sin(th)*.4)*s);}
  if(q<.56){const th=R()*TAU,cp=R(),sp=Math.sqrt(1-cp*cp);               // hump
    return P(sp*Math.cos(th)*.4*s-.05*s,sp*Math.sin(th)*.33*s,(1.85+cp*.42)*s);}
  if(q<.74){const t=R(),[i,j,k]=inBall();                                // neck
    return P((.85+t*.62)*s+i*.13*s,j*.13*s,(1.7+t*.95)*s+k*.13*s);}
  if(q<.82){const [i,j,k]=inBall();return P((1.5+i*.2)*s,j*.13*s,(2.62+k*.16)*s);}  // head
  const lg=Math.floor(R()*4),a=(lg<2?.62:-.55)*s,w=(lg%2?.26:-.26)*s,t=R();
  const sw=walk?Math.sin(px*2.3+pz+(lg<2?0:3.1))*.16*s*(1-t):0;          // legs, striding
  return P(a+sw,w,t*1.45*s);
}
// a horse: compact body, arched neck, mane, slim legs
function horse(px,pz,y0,s,ang,b,walk){
  const ux=Math.cos(ang),uz=Math.sin(ang),q=R(),P=(a,w,y)=>set(px+ux*a-uz*w,y0+y,pz+uz*a+ux*w,b);
  if(q<.44){const th=R()*TAU,cp=rn(-1,1),sp=Math.sqrt(1-cp*cp);
    return P(cp*.82*s,sp*Math.cos(th)*.32*s,(1.05+sp*Math.sin(th)*.33)*s);}
  if(q<.62){const t=R(),[i,j,k]=inBall();
    return P((.7+t*.5)*s+i*.11*s,j*.11*s,(1.25+t*.6)*s+k*.11*s);}       // neck
  if(q<.7){const [i,j,k]=inBall();return P((1.3+i*.18)*s,j*.1*s,(1.9+k*.14)*s);}   // head
  if(q<.78){const t=R();return P((.72+t*.5)*s,gs()*.05*s,(1.32+t*.62)*s,b*.6);}    // mane
  if(q<.84){const t=R();return P((-.82-t*.45)*s,gs()*.05*s,(1.2-t*.5)*s,b*.5);}    // tail
  const lg=Math.floor(R()*4),a=(lg<2?.55:-.5)*s,w=(lg%2?.2:-.2)*s,t=R();
  const sw=walk?Math.sin(px*2.7+pz+(lg<2?0:3.1))*.15*s*(1-t):0;
  return P(a+sw,w,t*1.05*s);
}
// a desert shrub: a low tangle of stiff twigs that catches the wind
function shrub(x,z,y0,s,b){
  const a=R()*TAU,t=R(),lean=.35+.5*R();
  return set(x+Math.cos(a)*t*s*lean,y0+t*s*(1-t*.45),z+Math.sin(a)*t*s*lean,(b||1)*(.3+.5*(1-t)),5);
}
// drifting smoke or haze: a slow rising, spreading plume (motion class 8 keeps it glow-only)
function smoke(x,y0,z,r,h,b){
  const t=Math.pow(R(),.7),a=R()*TAU,rr=r*(.25+t*1.35)*Math.sqrt(R());
  return set(x+Math.cos(a)*rr,y0+t*h,z+Math.sin(a)*rr,(b||.5)*(1-t*.8),8);
}
function sheep(px,pz,y0,s,ang,b){
  const ux=Math.cos(ang),uz=Math.sin(ang),q=R();
  if(q<.72){const th=R()*TAU,cp=rn(-1,1),sp=Math.sqrt(1-cp*cp),a=cp*.55*s,w=sp*Math.cos(th)*.3*s,v=sp*Math.sin(th)*.28*s;
    return set(px+ux*a-uz*w,y0+.55*s+v,pz+uz*a+ux*w,b*(.8+.4*Math.max(0,Math.sin(th))));}
  if(q<.86){const [i,j,k]=inBall();return set(px+ux*.62*s+i*.13*s,y0+.72*s+j*.12*s,pz+uz*.62*s+k*.13*s,b*.8);}
  const lg=Math.floor(R()*4),a=(lg<2?.32:-.32)*s,w=(lg%2?.14:-.14)*s;return set(px+ux*a-uz*w,y0+R()*.4*s,pz+uz*a+ux*w,b*.6);
}
function palm(P,b){ // P = [x, z, groundY, height, leanX, leanZ]
  const h=P[3];
  if(R()<.4){const t=R(),th=R()*TAU,r=.3*(1-t*.3);
    return set(P[0]+P[4]*t*t*h+Math.cos(th)*r,P[2]+t*h,P[1]+P[5]*t*t*h+Math.sin(th)*r,(b||1)*(.4+(fr(t*h*2)<.22?.45:0))*shadeN(Math.cos(th),0,Math.sin(th))*1.2);}
  const tx=P[0]+P[4]*h,tz=P[1]+P[5]*h,ty=P[2]+h,k=Math.floor(R()*10),a=k/10*TAU+P[4]*4,s=R(),w=gs()*.45*(1-s);
  return set(tx+Math.cos(a)*s*4.2-Math.sin(a)*w,ty+1.2*s-3.4*s*s,tz+Math.sin(a)*s*4.2+Math.cos(a)*w,(b||1)*(.5+.35*(1-s)),5);
}
function reed(x,z,y0,h,b){ // papyrus: stem and an umbel head
  if(R()<.6){const t=R();return set(x+Math.sin(t*2)*.1,y0+t*h,z,(b||1)*.45,5);}
  const a=R()*TAU,s=R(),r=s*.7;return set(x+Math.cos(a)*r,y0+h+s*.35-s*s*.5,z+Math.sin(a)*r,(b||1)*.6,5);
}
function flame(x,y,z,s,b){const [i,j,k]=inBall();return set(x+i*.25*s,y+Math.abs(j)*.6*s,z+k*.25*s,b||2,16);}
function stars(cx,cy,cz,r,b){const a=R()*TAU,cp=rn(.02,1),sp=Math.sqrt(1-cp*cp),rr=r*rn(.85,1);
  return set(cx+Math.cos(a)*sp*rr,cy+cp*rr,cz+Math.sin(a)*sp*rr,(b||1)*(.14+Math.pow(R(),7)*1.6),4);}
function cloud(blobs,b,m){const B=blobs[Math.floor(R()*blobs.length)];return set(B[0]+gs()*B[3],B[1]+gs()*B[3]*.3,B[2]+gs()*B[3],(b||.3)*1.5*(.6+.4*R()),m||0);}
// ground is laid out as a survey grid rather than scattered speckle: every point rides an x- or z-line
function terrain(fn,x0,x1,z0,z1,bm,cont){
  let x,z;
  if(R()<.5){x=latQ(x0,x1-x0,.45);z=rn(z0,z1);}else{x=rn(x0,x1);z=latQ(z0,z1-z0,.45);}
  const h=fn(x,z),nx=-(fn(x+.4,z)-fn(x-.4,z))/.8,nz=-(fn(x,z+.4)-fn(x,z-.4))/.8,nl=Math.hypot(nx,1,nz);
  lnx=nx/nl;lny=1/nl;lnz=nz/nl;
  let b=(.1+1.1*Math.max(0,(nx*LD[0]+LD[1]+nz*LD[2])/nl))*(bm||1);
  if(cont&&fr(h/cont)<.05)b+=.2;
  return set(x,h,z,b);
}
function pyramid(cx,y0,cz,a,h,b){ // four faces with stone courses
  const f=Math.floor(R()*4),u=rn(-1,1),v=1-Math.sqrt(R()),half=a*(1-v),y=y0+v*h;
  const ca=[1,0,-1,0][f],sa=[0,1,0,-1][f],x=cx+ca*half-sa*u*half,z=cz+sa*half+ca*u*half;
  const nl=Math.hypot(h,a),n=[ca*h/nl,a/nl,sa*h/nl];
  let bb=b*(fr(y/.8)<.12?.55:1)*(.9+.2*R());if(Math.abs(Math.abs(u)-1)<.02)bb=b*1.6;
  return set(x,y,z,bb*shadeN(...n)*1.2);
}
function column(cx,y0,cz,r,h,b){ // papyrus column: banded shaft, bell capital, abacus
  const q=R(),th=R()*TAU,c=Math.cos(th),s=Math.sin(th);
  if(q<.72){ // ruled shaft: contour courses, with the banding doubled up toward the capital
    const yr=R()*h*.82,ruled=R()<LATR;
    const y=ruled?latQ(0,h*.82,yr>h*.6?9:5):yr;
    let bb=b*(.7+.5*(fr(y/1.4)<.1?1:0));if(y>h*.3&&y<h*.7&&R()<.25)bb*=1.5;
    const th2=ruled?th:latAng(Math.round(r*14));
    return set(cx+Math.cos(th2)*r,y0+y,cz+Math.sin(th2)*r,bb*shadeN(Math.cos(th2),0,Math.sin(th2))*1.2);}
  if(q<.93){const t=R(),rr=r*(1+.55*Math.sin(t*Math.PI*.9));return set(cx+c*rr,y0+h*(.82+t*.14),cz+s*rr,b*shadeN(c,.4,s)*1.2);}
  return box(cx,y0+h*.96,cz,r*1.2,h*.04,r*1.2,b);
}
// a branching tree: returns samplers for bark, leaves and the list of tips
function tree(x,y0,z,o2){
  const O=Object.assign({len:6,rad:.9,depth:6,up:.8,spread:.8,leaf:2},o2),segs=[],tips=[];
  (function br(sx,sy,sz,dx,dy,dz,len,rad,depth){
    const ex=sx+dx*len,ey=sy+dy*len,ez=sz+dz*len;
    let ax=0,ay=1,az=0;if(Math.abs(dy)>.9){ax=1;ay=0;}
    let ux=dy*az-dz*ay,uy=dz*ax-dx*az,uz=dx*ay-dy*ax;const ul=Math.hypot(ux,uy,uz);ux/=ul;uy/=ul;uz/=ul;
    segs.push([sx,sy,sz,dx,dy,dz,len,rad,rad*.72,depth,ux,uy,uz,dy*uz-dz*uy,dz*ux-dx*uz,dx*uy-dy*ux]);
    if(depth===0){tips.push([ex,ey,ez]);return;}
    const kids=depth>O.depth-2?2:3;
    for(let k=0;k<kids;k++){const nx=dx+rn(-1,1)*O.spread,ny=dy+rn(-.15,O.up)*O.spread,nz=dz+rn(-1,1)*O.spread,l=Math.hypot(nx,ny,nz);
      br(ex,ey,ez,nx/l,ny/l,nz/l,len*rn(.66,.8),rad*.72*rn(.85,1),depth-1);}
  })(x,y0,z,0,1,0,O.len,O.rad,O.depth);
  const sw=new Float64Array(segs.length);let acc=0;segs.forEach((s,i)=>{acc+=s[6]*(s[7]+s[8]+.05);sw[i]=acc;});
  const pick=()=>{const r=R()*acc;let lo=0,hi=sw.length-1;while(lo<hi){const m=(lo+hi)>>1;if(sw[m]<r)lo=m+1;else hi=m;}return segs[lo];};
  return {tips,
    bark(b,m){const s=pick(),t=R(),th=R()*TAU,r=s[7]+(s[8]-s[7])*t,c=Math.cos(th),sn=Math.sin(th),L=s[6]*t;
      const nx=s[10]*c+s[13]*sn,ny=s[11]*c+s[14]*sn,nz=s[12]*c+s[15]*sn,gr=Math.pow(Math.abs(Math.sin(th*7+L*.8+s[9])),3);
      return set(s[0]+s[3]*L+nx*r,s[1]+s[4]*L+ny*r,s[2]+s[5]*L+nz*r,(b||1)*(s[9]>2?.3+.85*gr:.7)*shadeN(nx,ny,nz)*1.2,m);},
    leaf(b,m){const t=tips[Math.floor(R()*tips.length)];return set(t[0]+gs()*O.leaf,t[1]+gs()*O.leaf*.55,t[2]+gs()*O.leaf,(b||1)*(.3+R()*.5),m===undefined?5:m);}};
}
// weighted parts; a part returns false to reject and resample
function mix(parts){const c=cw(parts.map(p=>p[0])),f=parts.map(p=>p[1]);
  return ()=>{for(let k=0;k<400;k++){if(f[choose(c)]()!==false)return;}set(0,0,0,0);};}

const H={o,R,rn,fr,gs,TAU,smooth,inBall,archOpen,cw,choose,set,shadeN,LD,figure,light,
  box,cyl,dome,sphere,ellip,disk,ring,rod,person,prostrate,sheep,camel,horse,shrub,smoke,palm,reed,flame,stars,cloud,terrain,pyramid,column,tree,mix,
  latQ,latAng,latN};

/* ======================================================================= */
function run(S){
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const small=matchMedia('(max-width: 760px)').matches;
const cores=navigator.hardwareConcurrency||4;
const N=small?110000:(cores>=8?450000:300000);  // points per scene
const LN=small?6000:20000;                        // faint neighbour strokes per scene
const TXMAX=small?30000:70000;                     // particles for one 3D heading
const CACHE=small?5:8;                             // scenes kept in memory

const canvas=document.getElementById('scene');
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false,powerPreference:'high-performance'});}
catch(e){document.getElementById('nogl').style.display='grid';return;}
const PR=Math.min(devicePixelRatio,2);
renderer.setPixelRatio(PR);renderer.setSize(innerWidth,innerHeight);renderer.autoClear=false;
const RS0=small?Math.min(PR,1.5):Math.max(PR,1.5);
let RS=RS0,quality=0;
const rsFor=()=>Math.min(RS0*[1,.85,.72,.6][quality],Math.sqrt(7e6/(innerWidth*innerHeight)));
RS=rsFor();
// the clay and depth-of-field layers need half-float render targets; test that the device can really draw into one
const hdr=(()=>{if(!renderer.capabilities.isWebGL2)return false;
  renderer.extensions.get('EXT_color_buffer_float');renderer.extensions.get('EXT_color_buffer_half_float');
  const gl=renderer.getContext(),rt=new THREE.WebGLRenderTarget(4,4,{type:THREE.HalfFloatType,depthBuffer:true});
  renderer.setRenderTarget(rt);const ok=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
  renderer.setRenderTarget(null);rt.dispose();return ok;})();
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,.1,3000);

/* ---------- scenes, cache and background building ---------- */
const SC=S.scenes,SHOTS=S.shots,NC=SHOTS.length;
const shotIdx={};SHOTS.forEach((s,i)=>(shotIdx[s.scene]=shotIdx[s.scene]||[]).push(i));
const samplers={},cache=new Map();
let curShot=0,job=null;
const slotId=[null,null],slotSp=[.2,.2],slotGrid=[1,1];
// opt-in extension surface: a page may add real geometry and drive the scan reveal (see effects/)
const hooks={onFrame:null,onSceneLoad:null};
function genRange(id,arr,nrm,from,to){const g=samplers[id]||(samplers[id]=SC[id].build()),c=SC[id].at;
  for(let i=from;i<to;i++){g();arr[i*4]=o.x+c[0];arr[i*4+1]=o.y+c[1];arr[i*4+2]=o.z+c[2];arr[i*4+3]=o.w;nrm[i]=o.n;}}
function dist(id){return Math.min(...shotIdx[id].map(i=>Math.abs(i-curShot)));}
function evict(){while(cache.size>=CACHE){let worst=null,wd=-1;
  for(const k of cache.keys()){if(slotId.includes(k))continue;const d=dist(k);if(d>wd){wd=d;worst=k;}}
  if(worst===null)break;cache.delete(worst);}}
function buildLines(a,sc){ // faint strokes between true neighbours of the same kind
  const T=1<<18,cs=1.1*sc,key=new Uint32Array(N),cnt=new Uint32Array(T+1),out=new Float32Array(LN*8);
  for(let i=0;i<N;i++){const k=(((Math.floor(a[i*4]/cs)*73856093)^(Math.floor(a[i*4+1]/cs)*19349663)^(Math.floor(a[i*4+2]/cs)*83492791))>>>0)&(T-1);key[i]=k;cnt[k+1]++;}
  for(let k=0;k<T;k++)cnt[k+1]+=cnt[k];
  const fill=cnt.slice(0,T),ord=new Uint32Array(N);
  for(let i=0;i<N;i++)ord[fill[key[i]]++]=i;
  for(let l=0;l<LN;l++){
    let i=0,j=-1;
    for(let t=0;t<10;t++){i=Math.floor(R()*N);const m=Math.floor(a[i*4+3]/4);if(m>=6&&m!==11&&m!==17)continue;
      const k=key[i],s0=cnt[k],n=cnt[k+1]-s0,c=ord[s0+Math.floor(R()*n)];
      if(c===i||Math.floor(a[c*4+3]/4)!==m)continue;
      if(Math.hypot(a[c*4]-a[i*4],a[c*4+1]-a[i*4+1],a[c*4+2]-a[i*4+2])<cs){j=c;break;}}
    if(j<0)j=i;
    for(let q=0;q<4;q++){out[l*8+q]=a[i*4+q];out[l*8+4+q]=a[j*4+q];}
  }
  // typical distance between neighbouring points on this scene's surfaces, used to size the splats
  let occ=0,tot=0;for(let k=0;k<T;k++){const n=cnt[k+1]-cnt[k];if(n>=3){occ++;tot+=n;}}
  // pack each point's own spacing (from how crowded its cell is) into w, so splats grow only where points are sparse
  for(let i=0;i<N;i++){const k=key[i],n=Math.max(1,cnt[k+1]-cnt[k]);a[i*4+3]+=128*Math.max(0,Math.min(63,Math.round((Math.log2(cs/Math.sqrt(n))+9)*6)));}
  return {out,spacing:occ?cs/Math.sqrt(tot/occ):.2};
}
function store(id,arr,nrm){evict();const r=buildLines(arr,SC[id].scale||1),e={pts:arr,nrm,lines:r.out,sp:r.spacing};cache.set(id,e);return e;}
function finish(id){
  if(cache.has(id))return cache.get(id);
  let arr,nrm,i=0;
  if(job&&job.id===id){arr=job.arr;nrm=job.nrm;i=job.i;job=null;}else{arr=new Float32Array(N*4);nrm=new Float32Array(N);}
  genRange(id,arr,nrm,i,N);return store(id,arr,nrm);
}
function nextWanted(){for(let d=0;d<=5;d++)for(const i of [curShot+d,curShot-d]){if(i<0||i>=NC)continue;const id=SHOTS[i].scene;if(!cache.has(id))return id;}return null;}
function work(){ // build upcoming scenes a few milliseconds at a time so scrolling never stalls
  const t0=performance.now();
  while(performance.now()-t0<9){
    if(!job){const id=nextWanted();if(!id)break;job={id,arr:new Float32Array(N*4),nrm:new Float32Array(N),i:0};}
    const to=Math.min(N,job.i+2500);genRange(job.id,job.arr,job.nrm,job.i,to);job.i=to;
    if(job.i>=N){const j=job;job=null;store(j.id,j.arr,j.nrm);break;}
  }
  setTimeout(work,job?0:150);
}

/* Depth-based contrast and tint ramp, shared by the point and clay passes.
   Near the camera: crisp, high-contrast champagne-silver (#E2E8F0).
   Mid ground: balanced steel-blue (#64748B).  Far: low-contrast slate-indigo (#1E293B).
   The tints are normalised to unit luminance, so they shift hue and leave exposure to the shading. */
const GRADE=`
uniform vec3 uTodNear,uTodMid,uTodFar;uniform float uTodCon;
vec3 depthGrade(vec3 c,float z,float fd){
  float n=clamp(z/max(fd,1e-3),0.,2.5);
  vec3 tint=n<1.?mix(uTodNear,uTodMid,smoothstep(.3,1.,n)):mix(uTodMid,uTodFar,smoothstep(1.,2.2,n));
  float con=mix(1.3*uTodCon,.62,smoothstep(.25,2.,n));
  float val=mix(1.46,.30,smoothstep(.10,1.95,n));   // a long dark range with a luminous near end
  return max((c-.18)*con+.18,0.)*tint*val;
}`;
const VERT=GRADE+`
attribute vec4 pA;attribute vec4 pB;attribute float aRandom,nA,nB;attribute vec3 aScatter;
uniform float uW,uTime,uIntro,uRS,uScale,uWorld,uMinPx,uMaxPx,uAlpha,uFogD,uTurb,uWind,uFocusR,uFocusDist,uLine,uSpacing,uOnClay,uDens,uScat,uOrbR,uGlowS,uGlowA,uDispAmp,uDispF,uMouseRing,uMouseFade,uAudioLevel;
uniform vec3 uFocus,uLamp,uCA,uCB,uOrb,uMouse;uniform sampler2D tDisp;
uniform float uScanOn,uScanR,uScanNoise,uScanLift,uScanEdge;uniform vec4 uScanTrail[28];
uniform float uMotionRate,uNearFade,uLightBoost,uLightSteady,uLightClay,uCloudFade;
vec3 unpackN(float p){float a=floor(p/256.),c=p-a*256.;vec2 e=vec2(a,c)/255.*2.-1.;vec3 n=vec3(e.x,1.-abs(e.x)-abs(e.y),e.y);
  if(n.y<0.)n.xz=(1.-abs(n.zx))*vec2(n.x>=0.?1.:-1.,n.z>=0.?1.:-1.);return normalize(n);}
// triplanar lookup of the stone relief map
float dispH(vec3 p,vec3 n){vec3 w=abs(n);w/=w.x+w.y+w.z+1e-4;p*=uDispF;
  return texture2D(tDisp,p.yz).r*w.x+texture2D(tDisp,p.xz).r*w.y+texture2D(tDisp,p.xy).r*w.z;}
float h3(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
/* ---------- scan reveal (inert unless a page turns uScanOn on) ----------
   The same field the reconstructed meshes use, so the points, the strokes and the mesh
   all agree on exactly where the surface is open. */
float srH31(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float srVN(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(mix(srH31(i),srH31(i+vec3(1,0,0)),f.x),mix(srH31(i+vec3(0,1,0)),srH31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(srH31(i+vec3(0,0,1)),srH31(i+vec3(1,0,1)),f.x),mix(srH31(i+vec3(0,1,1)),srH31(i+vec3(1,1,1)),f.x),f.y),f.z);}
float scanReveal(vec3 p){
  float r=0.,nz=(srVN(p*uScanNoise)*.65+srVN(p*uScanNoise*2.07)*.35)-.5;
  for(int i=0;i<28;i++){
    vec4 t=uScanTrail[i];
    if(t.w<=0.)continue;
    float rad=uScanR*(.4+.6*t.w);
    float d=distance(p,t.xyz)+nz*rad*.85;
    r=max(r,(1.-smoothstep(rad*.3,rad,d))*t.w);
  }
  return r;
}
float vn(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}
// drifting patches of light that bloom and fade at random across the scene
float glowF(vec3 w){vec3 q=w/uGlowS+vec3(uTime*.09,uTime*.05,-uTime*.07);float n=vn(q)*.62+vn(q*2.3+vec3(7.1,3.3,1.7)-uTime*.11)*.38;return smoothstep(.6,.86,n)*uGlowA;}
varying vec3 vColor;varying float vAlpha;varying float vSharp;varying float vAlb,vLz,vFlag;varying vec3 vN;
vec2 rot(vec2 d,float a){float c=cos(a),s=sin(a);return vec2(d.x*c+d.y*s,-d.x*s+d.y*c);}
vec4 anim(vec4 p,vec3 c){
  float pw=mod(p.w,128.),m=floor(pw/4.+.001),b=pw-m*4.,t=uTime*uMotionRate;vec3 q=p.xyz;
  if(m<.5){}
  else if(m<1.5){q.xz=c.xz+rot(q.xz-c.xz,t*.055);}
  else if(m<2.5){q.xz=c.xz+rot(q.xz-c.xz,t*.018);}
  else if(m<3.5){q.xz=c.xz+rot(q.xz-c.xz,-t*.014);}
  else if(m<4.5){q.xz=c.xz+rot(q.xz-c.xz,t*.004);}
  else if(m<5.5){float g=(.6+.4*sin(t*.31+q.x*.04))*(1.+uWind*2.2);   // foliage gusts with the wind
    q.x+=sin(t*.9+q.x*.35+q.z*.21)*.09*g;q.z+=cos(t*.75+q.z*.3+q.y*.2)*.07*g;q.y+=sin(t*1.1+q.x*.5)*.02;}
  else if(m<6.5){b*=.55+.45*sin(length(q-c)*.9-t*1.4);}
  else if(m<7.5){q.x=c.x+mod(q.x-c.x+t*(2.2+aRandom*2.)*(1.+uWind*1.6)+95.,190.)-95.;q.y+=sin(t*1.3+aRandom*30.)*(.2+uWind*.5);}
  else if(m<8.5){float ph=fract(t*.012+aRandom*7.);q.y+=(ph-.5)*18.;q.x+=sin(t*.2+aRandom*40.)*.8;b*=sin(ph*3.14159);}
  else if(m<9.5){float ph=fract(t*.045+aRandom*5.);q=c+(q-c)*(1.-ph*.92);b*=sin(ph*3.14159);}
  else if(m<10.5){q.xz=c.xz+rot(q.xz-c.xz,t*.12);
    q+=vec3(sin(t*.7+aRandom*50.)*2.5,sin(t*.9+aRandom*31.)*1.2,cos(t*.6+aRandom*17.)*2.5);}
  else if(m<11.5){q.x+=sin(q.z*1.3-t*2.4)*.18;q.z+=cos(q.x*1.3-t*2.)*.12;}
  else if(m<12.5){q.y+=sin(q.x*.25+t*.9)*.5+sin(q.z*.31-t*.7)*.35+sin((q.x+q.z)*.9+t*1.7)*.08;}
  else if(m<13.5){float d=mod(q.z-c.z-t*1.1+60.,120.)-60.;q.z=c.z+d;b*=1.-smoothstep(48.,60.,abs(d));}
  else if(m<14.5){float ph=fract(t*.03+aRandom);q.y+=(ph-.5)*4.;q.x+=sin(t*.5+q.y*.3)*.4;b*=.35+.65*sin(ph*3.14159);}
  else if(m<15.5){q.y=c.y+mod(q.y-c.y-t*16.,60.);}
  else if(m<16.5){float ph=fract(t*.9+aRandom*3.);q.y+=ph*.9;q.x+=sin(t*3.+aRandom*40.)*.08*ph;b*=1.-ph;}
  else if(m<17.5){q.y+=sin(q.x*.6+t*1.2)*.05+sin(q.z*.8-t)*.04;b*=.8+.2*sin(q.x*1.5-t*2.);}
  else{b*=uLightSteady;}   // light beings: no drift, no flicker — stationary and legible
  return vec4(q,b);
}
void main(){
  float tt=clamp(uW*1.5-aRandom*.5,0.,1.);tt=tt*tt*(3.-2.*tt);
  vec4 A=anim(pA,uCA),B=anim(pB,uCB);
  vec4 P=mix(A,B,tt);vec3 pos=P.xyz;float b=P.w*(1.+uAudioLevel*.05);
  // light beings (class 18) opt out of every subsequent displacement
  float isLight=step(17.5,floor(mod(tt<.5?pA.w:pB.w,128.)/4.));
  // particle dissolve / re-assembly: points scatter into drifting dust partway through a scene morph, then reform
  float disperse=4.*tt*(1.-tt)*(1.-isLight);
  if(disperse>0.001){
    float nz=vn(pos*.15+uTime*.2+aRandom*40.);
    vec3 wind=vec3(sin(aRandom*61.+nz*6.283),sin(aRandom*37.+nz*6.283+2.1),sin(aRandom*83.+nz*6.283+4.2));
    pos+=wind*disperse*disperse*uSpacing*(14.+aRandom*10.);b*=1.-disperse*.35;
  }
  float lsp=mix(exp2(floor(pA.w/128.)/6.-9.),exp2(floor(pB.w/128.)/6.-9.),tt);   // this point's own neighbour spacing
  float cls=floor(mod(tt<.5?pA.w:pB.w,128.)/4.),speck=(abs(cls-4.)<.5||abs(cls-8.)<.5||abs(cls-15.)<.5)?1.:0.;
  vec3 nn=normalize(mix(unpackN(nA),unpackN(nB),tt));   // this point's own surface normal, used for displacement and (in the clay pass) surfel orientation
  if(cls<.5&&uDispAmp>0.&&isLight<.5){float hh=dispH(pos,nn);pos+=nn*(hh-.5)*uDispAmp;b*=.72+.56*hh;}
  float ph=aRandom*6.2831,tr=sin(3.14159*tt);
  pos+=vec3(sin(pos.y*.21+uTime*.17+ph),sin(pos.z*.19+uTime*.13+ph*1.7),sin(pos.x*.23+uTime*.15+ph*2.3))*(.02+tr*uTurb)*(1.-isLight);
  // interactive scan-ring: a sweep pulses outward from the pointer, rippling the surface and brightening as it passes
  float mr=length(pos-uMouse),mring=exp(-pow(mr-uMouseRing,2.)/8.)*uMouseFade;
  pos+=nn*mring*.14*(1.-isLight);b+=mring*1.1;
  // scan reveal: points inside the opening lift off the surface, swirl a little and fade out,
  // and the points sitting on the rim burn brighter — the bright ring around the hole
  float srFade=0.;
  if(uScanOn>.5){
    float dd=scanReveal(pos)-.5;
    float lift=smoothstep(0.,.3,dd);
    if(lift>0.){
      vec3 tg=normalize(cross(nn,vec3(0.,1.,0.))+vec3(1e-3,0.,0.));
      float sa=uTime*1.3+aRandom*6.2831;
      pos+=(nn*lift*uScanLift+(tg*cos(sa)+cross(nn,tg)*sin(sa))*lift*uScanLift*.5)*(1.-isLight);
    }
    b+=(1.-smoothstep(0.,uScanEdge,abs(dd)))*1.6;
    srFade=lift*(1.-isLight);   // characters are immune to the reveal: they stay solid clay
  }
  float it=clamp(uIntro*1.6-aRandom*.6,0.,1.);it=1.-pow(1.-it,3.);
  pos=mix(uFocus+aScatter*uScat,pos,it);
  vec4 mv=modelViewMatrix*vec4(pos,1.);gl_Position=projectionMatrix*mv;
  float z=max(-mv.z,.02);
  // camera collision guard: points the camera is about to pass through shrink and fade out
  // instead of smearing across the lens as solid blockers during a shot transition
  float prox=smoothstep(uNearFade*.3,uNearFade,z);
  // glowing kinds never become clay: sky, flowing light, motes, streams, swarms, rain, flame, light beings
  float glow=(abs(cls-4.)<.5||abs(cls-6.)<.5||abs(cls-8.)<.5||abs(cls-9.)<.5||abs(cls-10.)<.5||(cls>14.5&&cls<16.5)||cls>17.5)?1.:0.;
  float rank=fract(aRandom*97.13),keep=clamp(1.-(z-uFocusDist*1.2)/(uFocusDist*6.),.22,1.);
  vec3 vnrm=normalize((modelViewMatrix*vec4(nn,0.)).xyz);   // view-space normal, for silhouette weighting and surfel orientation
#ifdef CLAY
  float sil=1.-abs(vnrm.z);keep=min(1.,keep*(1.+sil*sil*1.6));   // silhouettes and grazing surfaces keep more points, so edges read dense and sharp
  if((glow>.5&&cls<17.5)||it<.97||tr>.35||rank>keep||srFade>.94||prox<.02){gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=0.;vAlb=0.;vLz=0.;vFlag=0.;return;}
  vFlag=cls>17.5?1.:0.;   // light beings only mark depth (for focus); they are never shaded as clay
  vN=vnrm;
  // splat diameter in world units. The old /sqrt(keep) term inflated splats to cover for LOD-thinned points —
  // that is what swelled into blinding blobs whenever adaptive quality dropped. Growth is capped tight instead.
  float wr=min(max(uWorld*1.15,lsp*.95),uSpacing*1.6+uWorld);
  float ps=wr*uScale/z*uRS*mix(.4,1.,prox);
  gl_PointSize=clamp(ps,1.,4.*uRS);
  vAlb=b*prox*(1.-srFade*.5);vLz=z;vColor=vec3(0.);vAlpha=wr*.5*min(1.,4.*uRS/ps);vSharp=0.;return;
#endif
  float df=length(pos-uFocus),focus=exp(-df*df/(2.*uFocusR*uFocusR));
  vec3 dl=pos-uLamp;float lamp=exp(-dot(dl,dl)*.01/(uFocusR*uFocusR/900.));
  float fog=1.-exp(-pow(z*uFogD,2.));
  // the wandering light and the random glow patches brighten whatever they touch
  vec3 dO=pos-uOrb;float orb=exp(-dot(dO,dO)/(2.*uOrbR*uOrbR));
  float sw=glowF(pos);
  float lum=b*(.8+.2*aRandom)*(.42+.95*focus)+lamp*(.25+.45*b)+orb*(.5+.9*b)+sw*(.3+.8*b);
  vec3 col=mix(vec3(.300,.312,.345),vec3(.960,.968,.982),clamp(lamp*.9+orb*1.2+max(b-1.,0.)*.7,0.,1.));
  col=mix(col,vec3(.118,.126,.148),fog);
  vColor=depthGrade(col*lum,z,uFocusDist);
  float dof=clamp(abs(z-uFocusDist)/(uFocusDist*1.2),0.,1.)*(1.-speck);
  vSharp=1.-dof;
  float px=max(uWorld,lsp*.42*(1.-speck))*uScale/z*(1.+dof*.5)*mix(1.,.5,speck)*mix(.45,1.,prox);
  float a=uAlpha*(1.-fog*.92)*smoothstep(uWorld*6.,uWorld*50.,z)*mix(.35,1.,it)*prox;
  a*=mix(uOnClay,1.,max(max(glow,tr),max(orb,sw)*.8))*mix(uDens,1.,speck);
  if(glow>.5&&cls>17.5){a*=uLightBoost*(1.-uLightClay);px*=1.15;vColor=mix(vColor,vec3(.97,.97,.97)*lum*1.25,.78);}
  a*=1.-srFade*uCloudFade;   // the cloud thins over the opening but never clears completely
  if(uLine>.5){vAlpha=a*(1.-smoothstep(uFocusDist*.6,uFocusDist*3.5,z))*(1.-tr);return;}
  if(rank>keep){gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=0.;vAlpha=0.;return;}
  a*=(1.-smoothstep(keep-.05,keep,rank))/keep;px*=1.+(1.-keep)*.25;
  // razor-thin dots: hard-capped so a thinned cloud never inflates its points into circular blobs.
  // speck kinds (stars, motes, rain) keep a little more room to stay visible as sparkle.
  float dev=px*uRS,capPx=mix(uMaxPx,uMaxPx*2.2,speck)*uRS;
  if(dev<uMinPx){a*=dev*dev/(uMinPx*uMinPx);dev=uMinPx;}
  if(dev>capPx){a*=capPx/dev;dev=capPx;}   // shrink instead of swell: the lost area comes back as opacity
  gl_PointSize=dev;
  vAlpha=a;
}`;
const FRAG_P=`varying vec3 vColor;varying float vAlpha;varying float vSharp;
// a crisp dot with one antialiased pixel of rim — not a soft gaussian, which is what read as a blurry blob
void main(){vec2 c=gl_PointCoord*2.-1.;float d=dot(c,c);if(d>1.)discard;
  float a=(1.-smoothstep(.35,1.,d))*vAlpha;
  gl_FragColor=vec4(min(vColor*a,vec3(.85)),a);}`;
// each splat is a small sphere cap: its centre sits nearer the camera, so overlapping splats melt into one surface
const FRAG_C=`uniform float uNear,uFar;varying float vAlb,vLz,vAlpha,vFlag;varying vec3 vN;
// oriented surfel: an elliptical disk, foreshortened and tilted by the point's own normal, instead of a screen-facing sphere cap
void main(){
  vec2 c=gl_PointCoord*2.-1.;
  vec3 n=normalize(vN);float tl=length(n.xy)+1e-4;vec2 that=n.xy/tl;
  float p=c.x*that.x+c.y*that.y,q=c.x*that.y-c.y*that.x,fz=clamp(abs(n.z),.3,1.);
  float ell=(p*p)/(fz*fz)+q*q;if(ell>1.)discard;
  // a nearly flat oriented disc: the old rounded sphere-cap bulge made neighbouring splats merge into balls
  float bulge=sqrt(max(0.,1.-ell)),tilt=-(n.x*c.x+n.y*c.y)/fz;
  float z=vLz-vAlpha*(bulge*.12+tilt*.95);
  gl_FragDepthEXT=.5*((uFar+uNear)/(uFar-uNear)-2.*uFar*uNear/((uFar-uNear)*z))+.5;
  gl_FragColor=vec4(log2(z),vAlb,vFlag,1.);}`;
const FRAG_L=`varying vec3 vColor;varying float vAlpha;void main(){gl_FragColor=vec4(vColor*vAlpha,vAlpha);}`;
const ADD={transparent:true,depthWrite:false,depthTest:false,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor};

const uniforms={
  uW:{value:0},uTime:{value:0},uIntro:{value:0},uRS:{value:RS},uScale:{value:1},uWorld:{value:.052},
  uMinPx:{value:.5},uMaxPx:{value:1.5},uAlpha:{value:.8},uFogD:{value:S.fog||1/250},uTurb:{value:reduce?.6:4},
  uTodNear:{value:new THREE.Vector3()},uTodMid:{value:new THREE.Vector3()},uTodFar:{value:new THREE.Vector3()},uTodCon:{value:1},uWind:{value:0},
  uFocusR:{value:30},uFocusDist:{value:40},uLine:{value:0},uSpacing:{value:.2},uOnClay:{value:hdr?.11:1},   // the additive layer is a faint sparkle over clay, not a second opaque skin — additive stacking on dense small objects is what blew them to white
  uDens:{value:Math.min(1,220000/N)},uScat:{value:1},uOrb:{value:new THREE.Vector3(0,-1e4,0)},uOrbR:{value:6},
  uGlowS:{value:8},uGlowA:{value:0},uDispAmp:{value:0},uDispF:{value:.5},tDisp:{value:null},
  uMouse:{value:new THREE.Vector3(1e4,1e4,1e4)},uMouseRing:{value:0},uMouseFade:{value:0},uMouseR:{value:8},uAudioLevel:{value:0},
  uScanOn:{value:0},uScanR:{value:20},uScanNoise:{value:.02},uScanLift:{value:3},uScanEdge:{value:.12},
  // uMotionRate scales every motion class at once: 1 = original pace, .4 = the calm default.
  // uNearFade is the world distance at which points start fading out ahead of the camera.
  uMotionRate:{value:S.motionRate===undefined?.4:S.motionRate},
  uNearFade:{value:2.4},uLightBoost:{value:1.75},uLightSteady:{value:1.22},
  // how much of the cloud the reveal clears: 1 = fully, lower leaves a veil so the opening
  // never reads as a hole punched in the scene
  uCloudFade:{value:S.cloudFade===undefined?.3:S.cloudFade},
  // >0 fades the glow silhouettes out once real reconstructed clay figures are standing in for
  // them; the splat clay pass never shaded class 18, so a solid figure has to be real geometry
  uLightClay:{value:0},
  uScanTrail:{value:(()=>{const a=[];for(let i=0;i<28;i++)a.push(new THREE.Vector4(0,0,0,0));return a;})()},
  uFocus:{value:new THREE.Vector3()},uLamp:{value:new THREE.Vector3()},uCA:{value:new THREE.Vector3()},uCB:{value:new THREE.Vector3()}
};
const base0=Math.sqrt(300000/N)*.052;   // splat floor scales with the point budget, so density (not just count) matches across device tiers
// a tileable stone relief: layered noise with the cracks of a cell pattern, used as the displacement map
function makeDisp(S){
  const d=new Uint8Array(S*S*4),C=8,P=[4,8,16,32,64],cells=[];
  const hr=(i,j,p)=>{i=((i%p)+p)%p;j=((j%p)+p)%p;return fr(Math.sin(i*127.1+j*311.7+p*74.7)*43758.5453);};
  const vn2=(x,y,p)=>{const i=Math.floor(x),j=Math.floor(y),fx=x-i,fy=y-j,ux=fx*fx*(3-2*fx),uy=fy*fy*(3-2*fy),
    a=hr(i,j,p),b=hr(i+1,j,p),c=hr(i,j+1,p),e=hr(i+1,j+1,p);return a+(b-a)*ux+(c-a)*uy+(a-b-c+e)*ux*uy;};
  for(let i=0;i<C;i++)for(let j=0;j<C;j++)cells.push([(i+.15+.7*R())/C,(j+.15+.7*R())/C]);
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){
    const u=x/S,v=y/S;let h=0,amp=.5;for(const p of P){h+=vn2(u*p,v*p,p)*amp;amp*=.5;}
    const gx=Math.floor(u*C),gy=Math.floor(v*C);let f1=9,f2=9;
    for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){const cx=((gx+ox)%C+C)%C,cy=((gy+oy)%C+C)%C,q=cells[cx*C+cy],
      px=q[0]+Math.floor((gx+ox)/C),py=q[1]+Math.floor((gy+oy)/C),dd=(u-px)*(u-px)+(v-py)*(v-py);
      if(dd<f1){f2=f1;f1=dd;}else if(dd<f2)f2=dd;}
    const crack=Math.min(1,(Math.sqrt(f2)-Math.sqrt(f1))*C*4);
    const val=Math.max(0,Math.min(1,h*.6+.4*crack*(.6+.4*h)));
    const k=(y*S+x)*4;d[k]=d[k+1]=d[k+2]=Math.round(val*255);d[k+3]=255;
  }
  const t=new THREE.DataTexture(d,S,S,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearFilter;t.needsUpdate=true;return t;
}
uniforms.tDisp.value=makeDisp(small?128:256);
// intro and long jumps gather the cloud from a shell around whatever the camera looks at
function scatter(n){const a=new Float32Array(n*3);for(let i=0;i<n;i++){const [x,y,z]=inBall(),l=Math.hypot(x,y,z)||1,r=rn(40,120);
  a[i*3]=x/l*r;a[i*3+1]=y/l*r+12;a[i*3+2]=z/l*r;}return a;}
const c0=SC[SHOTS[0].scene].at;

const geo=new THREE.BufferGeometry();
const pA=new THREE.BufferAttribute(new Float32Array(N*4),4).setUsage(THREE.DynamicDrawUsage);
const pB=new THREE.BufferAttribute(new Float32Array(N*4),4).setUsage(THREE.DynamicDrawUsage);
geo.setAttribute('position',pA);geo.setAttribute('pA',pA);geo.setAttribute('pB',pB);
const rnd=new Float32Array(N);for(let i=0;i<N;i++)rnd[i]=R();
geo.setAttribute('aRandom',new THREE.BufferAttribute(rnd,1));
const nA=new THREE.BufferAttribute(new Float32Array(N),1).setUsage(THREE.DynamicDrawUsage),nB=new THREE.BufferAttribute(new Float32Array(N),1).setUsage(THREE.DynamicDrawUsage);
geo.setAttribute('nA',nA);geo.setAttribute('nB',nB);
geo.setAttribute('aScatter',new THREE.BufferAttribute(scatter(N),3));
const pts=new THREE.Points(geo,new THREE.ShaderMaterial(Object.assign({uniforms,vertexShader:VERT,fragmentShader:FRAG_P},ADD)));
pts.frustumCulled=false;scene.add(pts);
// the clay pass draws the same points as opaque splats into a depth texture
const clayScene=new THREE.Scene();
const clayU=Object.assign({},uniforms,{uNear:{value:camera.near},uFar:{value:camera.far}});
const clayPts=new THREE.Points(geo,new THREE.ShaderMaterial({uniforms:clayU,vertexShader:'#define CLAY\n'+VERT,fragmentShader:FRAG_C,depthTest:true,depthWrite:true,blending:THREE.NoBlending,extensions:{fragDepth:true}}));
clayPts.frustumCulled=false;clayScene.add(clayPts);

const lg=new THREE.BufferGeometry();
const lA=new THREE.BufferAttribute(new Float32Array(LN*8),4).setUsage(THREE.DynamicDrawUsage);
const lB=new THREE.BufferAttribute(new Float32Array(LN*8),4).setUsage(THREE.DynamicDrawUsage);
lg.setAttribute('position',lA);lg.setAttribute('pA',lA);lg.setAttribute('pB',lB);
{const lr=new Float32Array(LN*2);for(let l=0;l<LN;l++)lr[l*2]=lr[l*2+1]=R();lg.setAttribute('aRandom',new THREE.BufferAttribute(lr,1));}
lg.setAttribute('aScatter',new THREE.BufferAttribute(scatter(LN*2),3));
const lineU=Object.assign({},uniforms,{uAlpha:{value:.09},uLine:{value:1},uOnClay:{value:1},uDispAmp:{value:0}});
const lines=new THREE.LineSegments(lg,new THREE.ShaderMaterial(Object.assign({uniforms:lineU,vertexShader:VERT,fragmentShader:FRAG_L},ADD)));
lines.frustumCulled=false;scene.add(lines);

/* ---------- structural wireframe: exact architectural line geometry under the point field ----------
   A scene declares its structure once with `edges(E)`; the builder emits real line segments, so the
   architecture is defined by true geometry rather than inferred from the cloud. Rebuilt on scene change. */
const EDGE_MAX=small?4000:16000;
const eGeo=new THREE.BufferGeometry(),ePos=new Float32Array(EDGE_MAX*6);
eGeo.setAttribute('position',new THREE.BufferAttribute(ePos,3).setUsage(THREE.DynamicDrawUsage));
eGeo.setDrawRange(0,0);
const edgeU={uFogD:{value:S.fog||1/250},uFD:{value:40},uOpacity:{value:S.edgeOpacity===undefined?.5:S.edgeOpacity},
  uTodNear:uniforms.uTodNear,uTodMid:uniforms.uTodMid,uTodFar:uniforms.uTodFar,uTodCon:uniforms.uTodCon};
const edgeLines=new THREE.LineSegments(eGeo,new THREE.ShaderMaterial(Object.assign({uniforms:edgeU,
  vertexShader:`varying float vZ;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vZ=max(-mv.z,.02);gl_Position=projectionMatrix*mv;}`,
  fragmentShader:GRADE+`uniform float uFogD,uFD,uOpacity;varying float vZ;
  void main(){
    float fog=1.-exp(-pow(vZ*uFogD,2.));
    float a=uOpacity*(1.-fog*.95)*(1.-smoothstep(uFD*2.5,uFD*7.,vZ));   // far structure fades out so it never clutters
    vec3 c=depthGrade(vec3(.863,.890,.922),vZ,uFD);
    gl_FragColor=vec4(min(c*a,vec3(.85)),a);
  }`},ADD)));
edgeLines.frustumCulled=false;scene.add(edgeLines);
// the builder handed to a scene's edges() — every call appends world-space segments
let eN=0,eAt=[0,0,0];
const EB={
  reset(at){eN=0;eAt=at;},
  line(x1,y1,z1,x2,y2,z2){if(eN>=EDGE_MAX)return;const k=eN*6;
    ePos[k]=x1+eAt[0];ePos[k+1]=y1+eAt[1];ePos[k+2]=z1+eAt[2];
    ePos[k+3]=x2+eAt[0];ePos[k+4]=y2+eAt[1];ePos[k+5]=z2+eAt[2];eN++;},
  // a rectangular prism: 12 edges, plus optional horizontal course lines up the faces
  box(cx,y0,cz,hw,h,hd,courses){
    const X=[cx-hw,cx+hw],Z=[cz-hd,cz+hd],Y=[y0,y0+h];
    for(const x of X)for(const z of Z)EB.line(x,Y[0],z,x,Y[1],z);
    for(const y of Y){EB.line(X[0],y,Z[0],X[1],y,Z[0]);EB.line(X[0],y,Z[1],X[1],y,Z[1]);
      EB.line(X[0],y,Z[0],X[0],y,Z[1]);EB.line(X[1],y,Z[0],X[1],y,Z[1]);}
    for(let i=1;i<(courses||0);i++){const y=y0+h*i/courses;
      EB.line(X[0],y,Z[0],X[1],y,Z[0]);EB.line(X[0],y,Z[1],X[1],y,Z[1]);
      EB.line(X[0],y,Z[0],X[0],y,Z[1]);EB.line(X[1],y,Z[0],X[1],y,Z[1]);}},
  // a revolve: vertical staves plus horizontal rings
  cyl(cx,y0,cz,r,h,seg,rings){
    seg=seg||12;rings=rings===undefined?4:rings;
    for(let i=0;i<seg;i++){const a=i/seg*TAU;EB.line(cx+Math.cos(a)*r,y0,cz+Math.sin(a)*r,cx+Math.cos(a)*r,y0+h,cz+Math.sin(a)*r);}
    for(let j=0;j<=rings;j++){const y=y0+h*j/rings;
      for(let i=0;i<seg;i++){const a=i/seg*TAU,b2=(i+1)/seg*TAU;
        EB.line(cx+Math.cos(a)*r,y,cz+Math.sin(a)*r,cx+Math.cos(b2)*r,y,cz+Math.sin(b2)*r);}}},
  // a dome: meridians plus latitude rings
  dome(cx,y0,cz,r,sy,seg,rings){
    seg=seg||12;rings=rings||5;sy=sy||1;
    for(let i=0;i<seg;i++){const a=i/seg*TAU;
      for(let j=0;j<rings;j++){const p1=j/rings*Math.PI/2,p2=(j+1)/rings*Math.PI/2;
        EB.line(cx+Math.cos(a)*Math.cos(p1)*r,y0+Math.sin(p1)*r*sy,cz+Math.sin(a)*Math.cos(p1)*r,
                cx+Math.cos(a)*Math.cos(p2)*r,y0+Math.sin(p2)*r*sy,cz+Math.sin(a)*Math.cos(p2)*r);}}
    for(let j=1;j<=rings;j++){const p=j/rings*Math.PI/2,rr=Math.cos(p)*r,y=y0+Math.sin(p)*r*sy;
      for(let i=0;i<seg;i++){const a=i/seg*TAU,b2=(i+1)/seg*TAU;
        EB.line(cx+Math.cos(a)*rr,y,cz+Math.sin(a)*rr,cx+Math.cos(b2)*rr,y,cz+Math.sin(b2)*rr);}}},
  // a semicircular arch in the plane facing `ax` ('x' spans x, 'z' spans z)
  arch(cx,y0,cz,w,h,sp,ax,seg){
    seg=seg||10;const X=ax==='z';
    for(const s of [-1,1]){const px=X?cx:cx+s*w,pz=X?cz+s*w:cz;EB.line(px,y0,pz,px,y0+sp,pz);}
    for(let i=0;i<seg;i++){const a1=i/seg*Math.PI,a2=(i+1)/seg*Math.PI;
      const o1=Math.cos(a1)*w,o2=Math.cos(a2)*w,y1=y0+sp+Math.sin(a1)*(h-sp),y2=y0+sp+Math.sin(a2)*(h-sp);
      EB.line(X?cx:cx+o1,y1,X?cz+o1:cz,X?cx:cx+o2,y2,X?cz+o2:cz);}},
  grid(cx,y,cz,hw,hd,n){for(let i=0;i<=n;i++){const t=i/n;
    EB.line(cx-hw+2*hw*t,y,cz-hd,cx-hw+2*hw*t,y,cz+hd);EB.line(cx-hw,y,cz-hd+2*hd*t,cx+hw,y,cz-hd+2*hd*t);}}
};
let edgeScene=null;
function buildEdges(id){
  if(edgeScene===id)return;
  edgeScene=id;
  const def=SC[id]&&SC[id].edges;
  if(!def){eGeo.setDrawRange(0,0);edgeLines.visible=false;return;}
  EB.reset(SC[id].at);def(EB);
  eGeo.getAttribute('position').needsUpdate=true;eGeo.setDrawRange(0,eN*2);edgeLines.visible=true;
}

function load(s,id){
  const e=finish(id),P=s?pB:pA,L=s?lB:lA;
  if(hooks.onSceneLoad)hooks.onSceneLoad(s,id,e);
  P.array.set(e.pts);P.needsUpdate=true;const Nn=s?nB:nA;Nn.array.set(e.nrm);Nn.needsUpdate=true;L.array.set(e.lines);L.needsUpdate=true;
  slotId[s]=id;slotSp[s]=e.sp;slotGrid[s]=SC[id].grid||(SC[id].scale||1)*1.6;uniforms[s?'uCB':'uCA'].value.fromArray(SC[id].at);
}
// put scene x (and y, when morphing) into the two slots and return the morph weight toward slot B
function useScenes(x,y,t){
  if(x===y){let s=slotId.indexOf(x);if(s<0){s=slotId[0]===null?0:(uniforms.uW.value<.5?1:0);load(s,x);}return s;}
  let sx=slotId.indexOf(x),sy=slotId.indexOf(y);
  if(sx<0&&sy<0){load(0,x);load(1,y);sx=0;}
  else if(sx<0){sx=1-sy;load(sx,x);}
  else if(sy<0){load(1-sx,y);}
  return sx===0?t:1-t;
}
load(0,SHOTS[0].scene);
setTimeout(work,60);

/* far stars ride with the camera, like a sky at infinity */
const SN=small?1500:3000,sp=new Float32Array(SN*3);
for(let i=0;i<SN;i++){const [x,y,z]=inBall(),l=Math.hypot(x,y,z)||1,r=rn(900,1200);sp[i*3]=x/l*r;sp[i*3+1]=Math.abs(y/l*r)*.9+40;sp[i*3+2]=z/l*r;}
const sGeo=new THREE.BufferGeometry();sGeo.setAttribute('position',new THREE.BufferAttribute(sp,3));
const stars=new THREE.Points(sGeo,new THREE.PointsMaterial({size:1.2,sizeAttenuation:false,color:0xb9bcc2,transparent:true,opacity:.28,depthWrite:false,depthTest:false}));
stars.frustumCulled=false;scene.add(stars);
const ON=small?160:320,oPos=new Float32Array(ON*3),oB=new Float32Array(ON);
for(let i=0;i<ON;i++){const core=i<ON*.55,[x,y,z]=inBall(),r=core?.18:1;oPos[i*3]=x*r;oPos[i*3+1]=y*r;oPos[i*3+2]=z*r;oB[i]=core?1:.2+.3*R();}
const oGeo=new THREE.BufferGeometry();oGeo.setAttribute('position',new THREE.BufferAttribute(oPos,3));oGeo.setAttribute('aB',new THREE.BufferAttribute(oB,1));
const oU={uTime:uniforms.uTime,uScale:uniforms.uScale,uRS:uniforms.uRS,uSz:{value:.05}};
const orbPts=new THREE.Points(oGeo,new THREE.ShaderMaterial(Object.assign({uniforms:oU,
  vertexShader:`attribute float aB;uniform float uTime,uScale,uRS,uSz;varying float vB;
  void main(){vec3 p=position+vec3(sin(uTime*1.3+position.y*9.),cos(uTime*1.1+position.x*7.),sin(uTime*.9+position.z*8.))*.08;
    vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
    gl_PointSize=clamp(uSz*(aB>.9?1.:.55)*uScale/max(-mv.z,.1)*uRS,1.,48.*uRS);vB=aB*(.75+.25*sin(uTime*3.+p.x*20.));}`,
  fragmentShader:`varying float vB;void main(){vec2 c=gl_PointCoord*2.-1.;float d=dot(c,c);if(d>1.)discard;float a=exp(-d*3.)*vB;gl_FragColor=vec4(vec3(.8,.83,.88)*a*1.3,a);}`},ADD)));
orbPts.frustumCulled=false;scene.add(orbPts);

/* ---------- 3D headings: particles that write each letter in space ---------- */
const tScene=new THREE.Scene(),tCam=new THREE.PerspectiveCamera(30,innerWidth/innerHeight,10,30000);
const tGeo=new THREE.BufferGeometry();
const tAttr={aT:new Float32Array(TXMAX*3),aS:new Float32Array(TXMAX*3),aO:new Float32Array(TXMAX),aB:new Float32Array(TXMAX),aR:new Float32Array(TXMAX)};
tGeo.setAttribute('position',new THREE.BufferAttribute(tAttr.aT,3).setUsage(THREE.DynamicDrawUsage));
tGeo.setAttribute('aS',new THREE.BufferAttribute(tAttr.aS,3).setUsage(THREE.DynamicDrawUsage));
tGeo.setAttribute('aO',new THREE.BufferAttribute(tAttr.aO,1).setUsage(THREE.DynamicDrawUsage));
tGeo.setAttribute('aB',new THREE.BufferAttribute(tAttr.aB,1).setUsage(THREE.DynamicDrawUsage));
tGeo.setAttribute('aR',new THREE.BufferAttribute(tAttr.aR,1).setUsage(THREE.DynamicDrawUsage));
tGeo.setDrawRange(0,0);
const tU={uReveal:{value:0},uOut:{value:0},uTime:{value:0},uRS:{value:RS},uD:{value:1},uPx:{value:1.4},uWin:{value:.1},uFs:{value:40}};
const tPts=new THREE.Points(tGeo,new THREE.ShaderMaterial(Object.assign({uniforms:tU,
  vertexShader:`attribute vec3 aS;attribute float aO,aB,aR;
  uniform float uReveal,uOut,uTime,uRS,uD,uPx,uWin,uFs;
  varying float vA,vG;
  void main(){
    float lp=clamp((uReveal*(1.+uWin)-aO)/uWin,0.,1.),e=1.-pow(1.-lp,3.);
    vec3 p=mix(position+aS,position,e);
    p.xy+=vec2(sin(aR*21.+lp*3.),cos(aR*17.+lp*3.))*(1.-e)*uFs*.22;
    p.z+=sin(uTime*.7+aR*6.2831)*uFs*.012*e;
    float oo=uOut*uOut;
    p+=vec3((aR-.5)*uFs*.8,(fract(aR*7.3)-.5)*uFs*.8+uFs*.2,uFs*2.5)*oo;
    vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
    vG=lp*(1.-lp)*4.;
    vA=aB*smoothstep(0.,.3,lp)*(1.-uOut);
    float sz=uPx*uRS*uD/max(-mv.z,1.)*(1.+vG*.5);
    if(sz<1.4){vA*=sz*sz/1.96;sz=1.4;}
    gl_PointSize=sz;
  }`,
  fragmentShader:`varying float vA,vG;
  void main(){vec2 c=gl_PointCoord*2.-1.;float d=dot(c,c);if(d>1.)discard;float a=exp(-d*3.2)*vA;
    vec3 col=vec3(.92,.94,.97)*1.1+vec3(.8,.84,.9)*vG*.8;gl_FragColor=vec4(col*a,a);}`},ADD)));
tPts.frustumCulled=false;tScene.add(tPts);
const TXT={el:null,dur:1};
const tcv=document.createElement('canvas'),tctx=tcv.getContext('2d',{willReadFrequently:true});

/* ---------- post: HDR tone mapping, restrained glow, atmospheric haze ---------- */
const post=new THREE.Scene(),pcam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2));quad.frustumCulled=false;post.add(quad);
const QV='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
const mkRT=d=>new THREE.WebGLRenderTarget(4,4,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:!!d,type:hdr?THREE.HalfFloatType:THREE.UnsignedByteType});
// rtMain carries depth so a page can put real geometry in the scene (see PointStory hooks)
const rtMain=mkRT(true),rtA=mkRT(),rtB=mkRT(),rtC=mkRT(),rtD=mkRT(),rtGod=mkRT();
const clay=hdr;   // the clay layer needs float render targets
const dofOn=!!S.dof;
const DOFS=S.dofStrength===undefined?1:S.dofStrength;   // 1 keeps the original aperture   // depth of field (and the defocus-only chromatic aberration it drives) is off by default — pass {dof:true} per-story to re-enable
const rtDepth=new THREE.WebGLRenderTarget(4,4,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true,type:THREE.HalfFloatType});
const clayM=new THREE.ShaderMaterial({vertexShader:QV,depthTest:false,depthWrite:false,
  uniforms:{tD:{value:rtDepth.texture},uTx:{value:new THREE.Vector2()},uTanH:{value:.5},uAsp:{value:1},uRad:{value:2},
    uL:{value:new THREE.Vector3()},uInvView:{value:new THREE.Matrix4()},uGrid:{value:1},uFogD:{value:S.fog||1/250},
    uLamp:{value:new THREE.Vector3()},uFocus:{value:new THREE.Vector3()},uFocusR:{value:30},uPxW:{value:.001},uClay:{value:1},
    uOrb:uniforms.uOrb,uOrbR:uniforms.uOrbR,uGlowS:uniforms.uGlowS,uGlowA:uniforms.uGlowA,uTime:uniforms.uTime,
    uMouse:uniforms.uMouse,uMouseRing:uniforms.uMouseRing,uMouseFade:uniforms.uMouseFade,uMouseR:uniforms.uMouseR,uCamPos:{value:new THREE.Vector3()},
    uTodNear:uniforms.uTodNear,uTodMid:uniforms.uTodMid,uTodFar:uniforms.uTodFar,uTodCon:uniforms.uTodCon,uFD:{value:40}},
  fragmentShader:GRADE+`uniform sampler2D tD;uniform vec2 uTx;uniform float uFD;uniform float uTanH,uAsp,uRad,uGrid,uFogD,uFocusR,uPxW,uClay,uOrbR,uGlowS,uGlowA,uTime,uMouseRing,uMouseFade,uMouseR;
  uniform vec3 uL,uLamp,uFocus,uOrb,uMouse,uCamPos;uniform mat4 uInvView;varying vec2 vUv;
  float h3(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
  float vn(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}
  float glowF(vec3 w){vec3 q=w/uGlowS+vec3(uTime*.09,uTime*.05,-uTime*.07);float n=vn(q)*.62+vn(q*2.3+vec3(7.1,3.3,1.7)-uTime*.11)*.38;return smoothstep(.6,.86,n)*uGlowA;}
  vec3 vpos(vec2 uv,float lz){float z=exp2(lz);vec2 n=uv*2.-1.;return vec3(n.x*uTanH*uAsp*z,n.y*uTanH*z,-z);}
  float S(vec2 o,float lz){vec4 s=texture2D(tD,vUv+o*uTx);return (s.a>.5&&s.b<.5)?s.r:lz+2.5;}
  float line(float v,float per,float w){float d=abs(fract(v/per+.5)-.5)*per;return 1.-smoothstep(w*.5,w*1.5,d);}
  float hash(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
  void main(){
    vec4 c=texture2D(tD,vUv);
    if(c.a<.5||c.b>.5){gl_FragColor=vec4(0.,0.,0.,1.);return;}
    float lz=c.r,r=uRad;
    float d1=S(vec2(r,0.),lz),d2=S(vec2(-r,0.),lz),d3=S(vec2(0.,r),lz),d4=S(vec2(0.,-r),lz);
    float d5=S(vec2(r,r)*.71,lz),d6=S(vec2(-r,r)*.71,lz),d7=S(vec2(r,-r)*.71,lz),d8=S(vec2(-r,-r)*.71,lz);
    // eye-dome lighting: pixels behind their neighbours fall into shadow, like a scanned relief
    float resp=max(0.,lz-d1)+max(0.,lz-d2)+max(0.,lz-d3)+max(0.,lz-d4)+max(0.,lz-d5)+max(0.,lz-d6)+max(0.,lz-d7)+max(0.,lz-d8);
    float edl=exp(-resp*6.);
    vec3 p=vpos(vUv,lz);
    vec3 px=abs(d1-lz)<abs(d2-lz)?vpos(vUv+vec2(r,0.)*uTx,d1)-p:p-vpos(vUv-vec2(r,0.)*uTx,d2);
    vec3 py=abs(d3-lz)<abs(d4-lz)?vpos(vUv+vec2(0.,r)*uTx,d3)-p:p-vpos(vUv-vec2(0.,r)*uTx,d4);
    // a second, wider normal smooths splat noise so the light reads as form
    float r2=r*3.,e1=S(vec2(r2,0.),lz),e2=S(vec2(-r2,0.),lz),e3=S(vec2(0.,r2),lz),e4=S(vec2(0.,-r2),lz);
    vec3 qx=abs(e1-lz)<abs(e2-lz)?vpos(vUv+vec2(r2,0.)*uTx,e1)-p:p-vpos(vUv-vec2(r2,0.)*uTx,e2);
    vec3 qy=abs(e3-lz)<abs(e4-lz)?vpos(vUv+vec2(0.,r2)*uTx,e3)-p:p-vpos(vUv-vec2(0.,r2)*uTx,e4);
    vec3 n=normalize(normalize(cross(px,py))*.4+normalize(cross(qx,qy))*.6);
    // ambient occlusion at two wider radii: corners, crevices and the ground under things darken
    float ao=0.;
    for(int i=0;i<8;i++){float a=float(i)*.785+.39;vec2 dir=vec2(cos(a),sin(a));
      float s1=S(dir*r*7.,lz),s2=S(dir*r*18.,lz);
      ao+=smoothstep(.0,.06,lz-s1)*(1.-smoothstep(.3,.6,lz-s1))+.6*smoothstep(.0,.1,lz-s2)*(1.-smoothstep(.4,.8,lz-s2));}
    ao=1.-clamp(ao/8.,0.,1.)*.75;
    float disc=max(max(abs(d1-lz),abs(d2-lz)),max(abs(d3-lz),abs(d4-lz)));
    vec3 wp=(uInvView*vec4(p,1.)).xyz;
    // micro-fracture: a whisper of hash-noise on the shading normal for surface tactility — kept small so it reads
    // as texture, not the salt-and-pepper black speckle a stronger perturbation causes on flat, evenly-lit ground
    vec3 mf=vec3(hash(wp*220.+11.3)-.5,hash(wp*220.+5.7)-.5,hash(wp*220.+31.1)-.5);
    n=normalize(n+mf*.07);
    vec3 wn=normalize(mat3(uInvView)*n);
    float dif=max(dot(n,uL),0.),hemi=.5+.5*wn.y,alb=clamp(c.g,0.,1.6);
    float sh=(.22*hemi*ao+1.05*pow(dif,1.3))*edl*ao*(.55+.45*min(alb,1.2));
    // cheap subsurface-scattering approximation: a faint neutral wrap past the terminator on thin forms
    float wrap=clamp((dot(n,uL)+.35)/1.35,0.,1.),sss=pow(wrap,1.8)*(1.-dif)*ao*.25;
    vec3 col=mix(vec3(.094,.106,.125)*.4,vec3(.353,.388,.431),clamp(sh,0.,1.3));   // charcoal shadow to muted steel-grey fill — the wire carries the brightest light, never the fill
    col+=vec3(.3,.31,.33)*sss;
    // rim light on edges turning away from the camera gives every object a silhouette of light
    float rim=pow(1.-clamp(n.z,0.,1.),3.)*edl;
    col+=vec3(.88,.9,.93)*rim*.2;
    vec3 dl=wp-uLamp;float lamp=exp(-dot(dl,dl)*.012*900./(uFocusR*uFocusR));
    float df=length(wp-uFocus),focus=exp(-df*df/(2.*uFocusR*uFocusR));
    // front-facing surfaces stay legible; surfaces turning away sink toward the dark, like an unlit CAD shell
    float frontness=clamp(n.z*.5+.5,0.,1.);
    col*=(.06+.36*frontness)*(.5+.55*focus);col+=vec3(.34,.36,.39)*lamp*sh;
    // fine grain of a scanned surface, only where a grain cell is bigger than a pixel
    float z=-p.z,pxw=uPxW*z,gc=uGrid*.03,amt=smoothstep(1.,3.,gc/pxw);
    col*=1.+(hash(floor(wp/gc))-.5)*.12*amt;
    // the wandering light: a neutral point light that rakes across the surface
    vec3 lo=uOrb-wp;float dd=length(lo),att=exp(-dd*dd/(2.*uOrbR*uOrbR));
    col+=vec3(.4,.43,.46)*att*(.14+max(dot(wn,lo/max(dd,1e-3)),0.)*.85);
    // interactive flashlight: a soft torch follows the pointer and reveals micro-surface detail underfoot
    vec3 mo=uMouse-wp;float mdd=length(mo),torch=exp(-mdd*mdd/(2.*uMouseR*uMouseR))*uMouseFade;
    col+=vec3(.55,.58,.62)*torch*(.2+max(dot(wn,normalize(uCamPos-wp)),0.)*1.);
    // the scan-ring: a bright band sweeps outward from the pointer, catching edges as it passes
    float mring=exp(-pow(mdd-uMouseRing,2.)/10.)*uMouseFade;
    col+=vec3(.7,.73,.78)*mring*.85;
    // random patches of glow drifting over the surfaces
    float sw=glowF(wp);
    col+=vec3(.45,.47,.5)*sw*.2*(.35+sh);
    // architectural wireframe: crisp, razor-thin contour rings and grid lines, silver on edges, steel-grey on the regular mesh
    float w=pxw*.7;
    float g=max(line(wp.y,uGrid,w)*.9,max(line(wp.x,uGrid,w)*(1.-abs(wn.x)),line(wp.z,uGrid,w)*(1.-abs(wn.z)))*.6);
    float gm=max(line(wp.y,uGrid*.25,w),max(line(wp.x,uGrid*.25,w)*(1.-abs(wn.x)),line(wp.z,uGrid*.25,w)*(1.-abs(wn.z))));
    float gm2=max(line(wp.y,uGrid*.08,w)*.8,max(line(wp.x,uGrid*.08,w)*(1.-abs(wn.x)),line(wp.z,uGrid*.08,w)*(1.-abs(wn.z))))*.6; // an extra-fine tier for ornament-level micro-detail
    float fadeG=1.-smoothstep(uGrid*60.,uGrid*260.,z),fine=smoothstep(5.,12.,uGrid*.25/pxw),vfine=smoothstep(9.,20.,uGrid*.08/pxw);
    float edge=smoothstep(.015,.05,disc);   // a tight threshold: only true creases and silhouettes qualify, so they read razor-sharp
    float fineNearEdge=fine*(1.+edge*2.4);  // contour density thickens near ornamentation and edges, not just up close
    // a laser scan-band sweeps slowly through the scene, brightening whatever contour it crosses
    float sweepP=uGrid*16.,sweep=exp(-pow(mod(wp.y-uTime*2.6,sweepP)-sweepP*.5,2.)/(uGrid*uGrid*2.8+.001));
    vec3 wireSteel=vec3(.353,.388,.431),wireSilver=vec3(.863,.890,.922),wireCharcoal=vec3(.094,.106,.125);
    // back-facing wires drop to charcoal and fade out exponentially with depth, so inner structure never clutters
    float backFade=exp(-max(0.,-n.z)*2.2)*exp(-z*uFogD*1.4);
    vec3 wireBody=mix(wireCharcoal,wireSteel,backFade);
    vec3 wire=wireBody*((g*.32+gm*.11*fineNearEdge+gm2*vfine*edge*.8)*fadeG*(1.+sw*1.4+att*.8))
             +wireSilver*(edge*1.1*fadeG+sweep*1.1*fadeG)*backFade;
    float fog=1.-exp(-pow(z*uFogD,2.));
    col=(col*.42+wire*(.45+.28*focus))*(1.-fog*.9);
    col=depthGrade(col,z,uFD);   // near surfaces gain contrast and champagne bite; far ones sink to cool slate
    gl_FragColor=vec4(min(col*uClay,vec3(.85)),1.);   // hard ceiling: no fragment can blow out to solid white
  }`});
// depth of field: blur by each pixel's distance from the focal plane (half resolution), then blend with the sharp frame
const DOFC=`uniform sampler2D tD;uniform float uF,uAp,uMax;
  float coc(vec2 uv){vec4 d=texture2D(tD,uv);float z=d.a>.5?exp2(d.r):3000.;return min(uMax,abs(z-uF)/z*uAp);}`;
const rtDofH=mkRT(),rtDof=mkRT();
const dofBlurM=new THREE.ShaderMaterial({vertexShader:QV,depthTest:false,
  uniforms:{tS:{value:rtMain.texture},tD:{value:rtDepth.texture},uTx:{value:new THREE.Vector2()},uF:{value:40},uAp:{value:10},uMax:{value:14}},
  fragmentShader:DOFC+`uniform sampler2D tS;uniform vec2 uTx;varying vec2 vUv;
  void main(){
    float c0=coc(vUv);vec3 acc=texture2D(tS,vUv).rgb;float ws=1.;
    for(int i=0;i<28;i++){
      float fi=float(i)+.5,r=sqrt(fi/28.)*c0,a=fi*2.39996;
      vec2 uv=vUv+vec2(cos(a),sin(a))*r*uTx;
      float w=clamp(coc(uv)-r*.5+.5,0.,1.);   // a sample spreads only as far as its own blur reaches
      acc+=texture2D(tS,uv).rgb*w;ws+=w;
    }
    gl_FragColor=vec4(acc/ws,1.);
  }`});
const dofMixM=new THREE.ShaderMaterial({vertexShader:QV,depthTest:false,
  uniforms:{tS:{value:rtMain.texture},tB:{value:rtDofH.texture},tD:{value:rtDepth.texture},uF:dofBlurM.uniforms.uF,uAp:dofBlurM.uniforms.uAp,uMax:dofBlurM.uniforms.uMax},
  fragmentShader:DOFC+`uniform sampler2D tS,tB;varying vec2 vUv;
  void main(){gl_FragColor=vec4(mix(texture2D(tS,vUv).rgb,texture2D(tB,vUv).rgb,smoothstep(.7,2.4,coc(vUv))),1.);}`});
const scrimM=new THREE.ShaderMaterial({vertexShader:QV,depthTest:false,depthWrite:false,transparent:true,
  blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.DstColorFactor,blendDst:THREE.ZeroFactor,
  uniforms:{uR:{value:new THREE.Vector4(.5,.5,.3,.2)},uR2:{value:new THREE.Vector4(-9,-9,.1,.1)},uA:{value:0},
    tL:{value:null},uLumGain:{value:1.9}},
  // The scrim reads last frame's blurred bright-pass as a cheap measure of what is behind the
  // caption, and deepens itself exactly where the cloud is bright. Over black it stays light,
  // so it never flattens an empty sky; over a dense lit wall it darkens until the text holds.
  fragmentShader:'uniform vec4 uR,uR2;uniform float uA,uLumGain;uniform sampler2D tL;varying vec2 vUv;'+
  'void main(){vec2 d=(vUv-uR.xy)/uR.zw,e=(vUv-uR2.xy)/uR2.zw;'+
  'vec3 l=texture2D(tL,vUv).rgb;float lum=dot(l,vec3(.299,.587,.114));'+
  'float a=min(.72,uA*(1.+clamp(lum*uLumGain,0.,1.4)));'+
  'gl_FragColor=vec4(vec3((1.-a*exp(-dot(d,d)*.42))*(1.-a*exp(-dot(e,e)*.42))),1.);}'});
scrimM.uniforms.tL.value=rtC.texture;
const brightM=new THREE.ShaderMaterial({uniforms:{tD:{value:null},uTx:{value:new THREE.Vector2()}},vertexShader:QV,depthTest:false,
  fragmentShader:`uniform sampler2D tD;uniform vec2 uTx;varying vec2 vUv;
  void main(){vec3 c=(texture2D(tD,vUv+uTx*vec2(-1.,-1.)).rgb+texture2D(tD,vUv+uTx*vec2(1.,-1.)).rgb+texture2D(tD,vUv+uTx*vec2(-1.,1.)).rgb+texture2D(tD,vUv+uTx).rgb)*.25;
  float l=max(c.r,max(c.g,c.b));gl_FragColor=vec4(c*smoothstep(.62,1.05,l),1.);}`});   // fragments are capped at .85, so the knee sits below that to catch only true silver highlights
const blurM=new THREE.ShaderMaterial({uniforms:{tD:{value:null},uDir:{value:new THREE.Vector2()}},vertexShader:QV,depthTest:false,
  fragmentShader:`uniform sampler2D tD;uniform vec2 uDir;varying vec2 vUv;
  void main(){vec4 c=texture2D(tD,vUv)*.227;
  c+=(texture2D(tD,vUv+uDir*1.385)+texture2D(tD,vUv-uDir*1.385))*.316;
  c+=(texture2D(tD,vUv+uDir*3.231)+texture2D(tD,vUv-uDir*3.231))*.07;gl_FragColor=c;}`});
// volumetric god-rays: a cheap radial streak from the key light's screen position through the bright-pass buffer
const godM=new THREE.ShaderMaterial({uniforms:{tD:{value:rtA.texture},uSun:{value:new THREE.Vector2(.5,.5)},uDecay:{value:.96},uWeight:{value:.55},uDensity:{value:.85}},
  vertexShader:QV,depthTest:false,
  fragmentShader:`uniform sampler2D tD;uniform vec2 uSun;uniform float uDecay,uWeight,uDensity;varying vec2 vUv;
  void main(){
    vec2 uv=vUv,delta=(uv-uSun)*(uDensity/24.);
    vec3 col=vec3(0.);float ill=1.;
    for(int i=0;i<24;i++){uv-=delta;col+=texture2D(tD,uv).rgb*ill;ill*=uDecay;}
    gl_FragColor=vec4(col*uWeight/24.,1.);
  }`});
const compM=new THREE.ShaderMaterial({vertexShader:QV,depthTest:false,
  uniforms:{tS:{value:rtMain.texture},tA:{value:rtA.texture},tC:{value:rtC.texture},tG:{value:rtGod.texture},tD:{value:rtDepth.texture},
    uF:dofBlurM.uniforms.uF,uAp:dofBlurM.uniforms.uAp,uMax:dofBlurM.uniforms.uMax,uHasDepth:{value:(clay&&dofOn)?1:0},
    uTx:{value:new THREE.Vector2()},uTime:{value:0},uAsp:{value:1},
    uExp:{value:(hdr?1.2:1.1)*(S.exposure||1)},uGlow:{value:.14},uHaze:{value:.08},uGod:{value:0},uCA:{value:S.aberration===undefined?(dofOn?.08:0):S.aberration}},
  fragmentShader:DOFC+`uniform sampler2D tS,tA,tC,tG;uniform vec2 uTx;uniform float uTime,uAsp,uExp,uGlow,uHaze,uGod,uCA,uHasDepth;varying vec2 vUv;
  float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
  vec3 ACES(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}   // ACES filmic fit (Narkowicz)
  void main(){
    vec2 d=vUv-.5;d.x*=uAsp;
    // chromatic fringing only appears where the image is already out of focus, like a real lens wide open
    float cocAmt=uHasDepth>.5?smoothstep(.15,1.3,coc(vUv)):.3;
    vec2 caOff=d*dot(d,d)*uCA*cocAmt*uTx*55.;
    vec3 c;
    c.g=(texture2D(tS,vUv+uTx*vec2(-.5,-.5)).g+texture2D(tS,vUv+uTx*vec2(.5,-.5)).g+texture2D(tS,vUv+uTx*vec2(-.5,.5)).g+texture2D(tS,vUv+uTx*.5).g)*.25;
    c.r=(texture2D(tS,vUv+uTx*vec2(-.5,-.5)+caOff).r+texture2D(tS,vUv+uTx*vec2(.5,-.5)+caOff).r+texture2D(tS,vUv+uTx*vec2(-.5,.5)+caOff).r+texture2D(tS,vUv+uTx*.5+caOff).r)*.25;
    c.b=(texture2D(tS,vUv+uTx*vec2(-.5,-.5)-caOff).b+texture2D(tS,vUv+uTx*vec2(.5,-.5)-caOff).b+texture2D(tS,vUv+uTx*vec2(-.5,.5)-caOff).b+texture2D(tS,vUv+uTx*.5-caOff).b)*.25;
    c+=texture2D(tA,vUv).rgb*uGlow+texture2D(tC,vUv).rgb*uHaze*vec3(1.,.93,.82)+texture2D(tG,vUv).rgb*uGod;
    c=ACES(c*uExp);
    float l=dot(c,vec3(.2126,.7152,.0722));
    c=mix(c*vec3(.98,.99,1.02),c*vec3(1.03,1.,.95),smoothstep(.2,.85,l));
    c*=1.-smoothstep(.3,1.05,length(d))*.62;
    c+=vec3(.012,.011,.01)+(h(gl_FragCoord.xy+fract(uTime*.37)*97.)-.5)*.014;
    gl_FragColor=vec4(max(c,0.),1.);
  }`});
function pass(m,target){quad.material=m;renderer.setRenderTarget(target);renderer.render(post,pcam);}
function sizeAll(){
  RS=rsFor();
  const w=Math.max(4,Math.floor(innerWidth*RS)),h=Math.max(4,Math.floor(innerHeight*RS));
  rtMain.setSize(w,h);rtDepth.setSize(w,h);rtDof.setSize(w,h);rtDofH.setSize(Math.max(2,w>>1),Math.max(2,h>>1));dofBlurM.uniforms.uTx.value.set(1/w,1/h);clayM.uniforms.uTx.value.set(1/w,1/h);clayM.uniforms.uRad.value=Math.max(2,RS*2.4);
  const qw=Math.max(2,Math.floor(innerWidth*PR/4)),qh=Math.max(2,Math.floor(innerHeight*PR/4));
  rtA.setSize(qw,qh);rtB.setSize(qw,qh);rtC.setSize(qw>>1||1,qh>>1||1);rtD.setSize(qw>>1||1,qh>>1||1);rtGod.setSize(qw,qh);
  blurM.userData.q=[1/qw,1/qh];blurM.userData.e=[2/qw,2/qh];
  brightM.uniforms.uTx.value.set(.5/qw,.5/qh);
  compM.uniforms.uTx.value.set(1/w,1/h);compM.uniforms.uAsp.value=innerWidth/innerHeight;
  uniforms.uRS.value=RS;tU.uRS.value=RS;
  uniforms.uScale.value=(innerHeight/2)/Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
  tU.uD.value=(innerHeight/2)/Math.tan(THREE.MathUtils.degToRad(15));
  tCam.aspect=innerWidth/innerHeight;tCam.position.set(0,0,tU.uD.value);tCam.lookAt(0,0,0);tCam.updateProjectionMatrix();
}
sizeAll();

/* ---------- the journey: one shot per caption ---------- */
const V=(a,b)=>new THREE.Vector3(a[0]+b[0],a[1]+b[1],a[2]+b[2]);
const CAM=SHOTS.map(s=>V(SC[s.scene].at,s.cam)),TGT=SHOTS.map(s=>V(SC[s.scene].at,s.tgt));
const GRAIN=SHOTS.map(s=>s.grain||1),ORBIT=SHOTS.map(s=>s.orbit===undefined?1:s.orbit);
const camCurve=new THREE.CatmullRomCurve3(CAM,false,'centripetal');
const tgtCurve=new THREE.CatmullRomCurve3(TGT,false,'centripetal');
document.querySelector('.track').style.height=(NC*160)+'vh';
const DOFA=SHOTS.map(s=>s.dof===undefined?1:s.dof);
/* Time-of-day states. Each names the depth ramp's near/mid/far hue cast (ratios around unit luminance,
   so they tint without changing exposure), a contrast scale, and a background.
   A shot picks one with `tod:'dawn'`; a story sets its default with `tod:` at the top level. */
const TOD={
  night:    {near:[.996,1.002,1.014],mid:[.976,.994,1.030],far:[.946,.976,1.058],con:1.18,bg:[.041,.043,.050]},
  moonlight:{near:[.990,1.000,1.022],mid:[.968,.992,1.040],far:[.936,.970,1.070],con:1.22,bg:[.038,.041,.050]},
  dawn:     {near:[1.030,1.006,.976],mid:[.994,.998,1.010],far:[.948,.978,1.052],con:1.10,bg:[.052,.052,.058]},
  sunset:   {near:[1.048,1.004,.960],mid:[1.006,.998,.998],far:[.950,.976,1.048],con:1.06,bg:[.050,.048,.052]}
};
const TODS=SHOTS.map(s=>TOD[s.tod]||TOD[S.tod]||TOD.night);
const todMix=(a,b,t,k)=>a[k].map((v,i)=>v+(b[k][i]-v)*t);

/* ---------- GSAP: scroll scrubbing, chapter jumps, the intro, the moving light ---------- */
const G=window.gsap,ST=window.ScrollTrigger,STO=window.ScrollToPlugin;
if(G){if(ST)G.registerPlugin(ST);if(STO)G.registerPlugin(STO);}
const story={s:0};let stAnim=null;
// scrub is the lag between the wheel and the story; higher reads as a heavier, calmer camera
if(G&&ST&&!reduce){stAnim=G.to(story,{s:1,ease:'none',scrollTrigger:{trigger:'.track',start:'top top',end:'bottom bottom',scrub:S.scrub===undefined?2.4:S.scrub}});ST.refresh();}
const orbOff={x:.8,y:.35,z:.2};
function wander(){G.to(orbOff,{x:rn(-1,1),y:rn(.05,.85),z:rn(-1,1),duration:rn(3.5,7.5),ease:'sine.inOut',onComplete:wander});}
if(G&&!reduce){
  G.fromTo(uniforms.uIntro,{value:0},{value:1,duration:3.6,ease:'power2.inOut'});
  G.fromTo(uniforms.uGlowA,{value:0},{value:1,duration:4,delay:2,ease:'sine.inOut'});
  wander();
}else if(reduce)uniforms.uIntro.value=1;

/* ---------- captions ---------- */
const segr=(typeof Intl!=='undefined'&&Intl.Segmenter)?new Intl.Segmenter('ar',{granularity:'grapheme'}):null;
function graphemes(s){
  if(segr)return Array.from(segr.segment(s),x=>x.segment);
  const out=[];for(const ch of s){if(/[ً-ٰٟۖ-ۭ]/.test(ch)&&out.length)out[out.length-1]+=ch;else out.push(ch);}return out;
}
// captions move around the frame: corners, a centred base line, or heading and text split apart
const LAYS=['br','sa','tl','bc','tr','sb','bl'];
document.head.insertAdjacentHTML('beforeend',`<style>
.cap--side{inset:0;width:auto;display:block}
.cap-grp{position:absolute;display:flex;flex-direction:column;gap:.55rem;width:min(21rem,31vw)}
.cap-head,.cap-body{display:flex;flex-direction:column;gap:.55rem;width:min(21rem,31vw)}
.lay-br .cap-grp{right:max(2.2vw,14px);bottom:calc(9vh + env(safe-area-inset-bottom,0px))}
.lay-tr .cap-grp{right:max(2.2vw,14px);top:calc(11vh + env(safe-area-inset-top,0px))}
.lay-bl .cap-grp{left:calc(max(2vw,12px) + 150px);bottom:calc(9vh + env(safe-area-inset-bottom,0px))}
.lay-tl .cap-grp{left:calc(max(2vw,12px) + 150px);top:calc(11vh + env(safe-area-inset-top,0px))}
.lay-bc .cap-grp{left:50%;transform:translateX(-50%);bottom:calc(7vh + env(safe-area-inset-bottom,0px));width:min(40rem,84vw);text-align:center;align-items:center}
.lay-bc .cap-head,.lay-bc .cap-body{width:100%;align-items:center}
.lay-sa .cap-grp,.lay-sb .cap-grp{display:contents}
.lay-sa .cap-head,.lay-sa .cap-body,.lay-sb .cap-head,.lay-sb .cap-body{position:absolute}
.lay-sa .cap-head{right:max(7vw,24px);top:calc(11vh + env(safe-area-inset-top,0px))}
.lay-sa .cap-body{left:calc(max(3vw,16px) + 190px);bottom:calc(9vh + env(safe-area-inset-bottom,0px))}
.lay-sb .cap-head{left:calc(max(3vw,16px) + 190px);top:calc(11vh + env(safe-area-inset-top,0px))}
.lay-sb .cap-body{right:max(7vw,24px);bottom:calc(9vh + env(safe-area-inset-bottom,0px))}
@media (max-width:760px){
  .cap--side .cap-grp,.cap--side .cap-head,.cap--side .cap-body{position:absolute;display:flex;transform:none;left:48px;right:18px;width:auto;text-align:right;align-items:stretch}
  .cap--side .cap-grp{bottom:calc(7vh + env(safe-area-inset-bottom,0px));top:auto}
  .lay-sa .cap-head,.lay-sb .cap-head,.lay-tl .cap-grp,.lay-tr .cap-grp{top:calc(9vh + env(safe-area-inset-top,0px));bottom:auto}
  .lay-sa .cap-body,.lay-sb .cap-body{bottom:calc(7vh + env(safe-area-inset-bottom,0px));top:auto}
}
</style>`);
let sideN=0;
document.querySelectorAll('.cap--side').forEach(sec=>{
  const grp=document.createElement('div'),head=document.createElement('div'),body=document.createElement('div');
  grp.className='cap-grp';head.className='cap-head';body.className='cap-body';
  [...sec.children].forEach(ch=>(ch.classList.contains('kicker')||ch.tagName==='H2'?head:body).append(ch));
  grp.append(head,body);sec.append(grp);
  sec.classList.add('lay-'+(sec.dataset.pos||LAYS[sideN++%LAYS.length]));
});
/* Screen anchor of each layout slot, as a fraction of the viewport. showCap() uses these to put
   an unpositioned caption in whichever corner is furthest from the shot's subject — the subject
   is where the cloud is densest and brightest, so this is where text stays readable. */
const LAYPT={br:[.78,.85],tr:[.78,.18],bl:[.25,.85],tl:[.25,.18],bc:[.5,.9],sa:[.6,.5],sb:[.4,.5]};
const caps=[...document.querySelectorAll('.cap')].map(el=>({el,groups:[...el.querySelectorAll('.cap-head,.cap-body')],tws:[...el.querySelectorAll('.tw')].map(n=>{
  const text=n.textContent.trim().replace(/\s+/g,' '),g=graphemes(text),is3d=n.classList.contains('tw3d');n.textContent='';
  const gh=document.createElement('span');gh.className='gh';gh.textContent=text;n.append(gh);
  const t={n,g,text,is3d,k:0,acc:0,rate:+n.dataset.tw||30,started:false,tx:null,cw:null};
  if(!is3d){
    const ink=document.createElement('span');ink.setAttribute('aria-hidden','true');
    t.tx=document.createElement('span');t.tx.className='tx';const pen=document.createElement('i');pen.className='pen';
    ink.append(t.tx,pen);n.append(ink);
  }
  return t;
})}));
if(caps.length!==NC)console.warn('captions',caps.length,'shots',NC);

let fontsReady=!document.fonts;
if(document.fonts){Promise.all([document.fonts.load('700 40px Amiri'),document.fonts.load('400 20px Amiri')]).catch(()=>{}).then(()=>document.fonts.ready).then(()=>{fontsReady=true;});
  setTimeout(()=>{fontsReady=true;},3500);}

function buildText(t){
  const el=t.n,cs=getComputedStyle(el),fs=parseFloat(cs.fontSize);
  let lh=parseFloat(cs.lineHeight);if(!(lh>0))lh=fs*1.25;
  const w=el.clientWidth,font=`${cs.fontWeight} ${fs}px ${cs.fontFamily}`,center=cs.textAlign==='center';
  tctx.font=font;
  const words=t.text.split(' '),ls=[];let line='';
  for(const wd of words){const tl=line?line+' '+wd:wd;if(line&&tctx.measureText(tl).width>w+.5){ls.push(line);line=wd;}else line=tl;}
  if(line)ls.push(line);
  const hT=ls.length*lh,Sx=2,pad=Math.ceil(fs*.8),CW=w+pad*2,CH=hT+pad*2;
  tcv.width=Math.ceil(CW*Sx);tcv.height=Math.ceil(CH*Sx);
  tctx.setTransform(Sx,0,0,Sx,0,0);tctx.clearRect(0,0,CW,CH);
  tctx.font=font;tctx.direction='rtl';tctx.textBaseline='middle';tctx.fillStyle='#fff';tctx.textAlign=center?'center':'right';
  const L=[];let gTot=0;
  ls.forEach((ln,i)=>{
    const lw=tctx.measureText(ln).width;tctx.fillText(ln,pad+(center?w/2:w),pad+(i+.5)*lh);
    const gg=graphemes(ln),acc=[];let m=0,pre='';
    for(const g of gg){pre+=g;m=Math.max(m,tctx.measureText(pre).width);acc.push(m);}
    L.push({right:center?w/2+lw/2:w,acc,g0:gTot});gTot+=gg.length;
  });
  const IW=tcv.width,IH=tcv.height,img=tctx.getImageData(0,0,IW,IH).data;
  const A=(x,y)=>(x<0||y<0||x>=IW||y>=IH)?0:img[(y*IW+x)*4+3];
  let filled=0;for(let y=0;y<IH;y+=4)for(let x=0;x<IW;x+=4)if(A(x,y)>127)filled++;
  const est=filled*16/(Sx*Sx),step=Math.max(small?.9:.7,Math.sqrt(est*1.7/TXMAX)),ext=fs*.2;
  let n=0;
  for(let cy=0;cy<CH&&n<TXMAX;cy+=step)for(let cx=0;cx<CW&&n<TXMAX;cx+=step){
    const jx=cx+R()*step,jy=cy+R()*step,ix=Math.floor(jx*Sx),iy=Math.floor(jy*Sx);
    if(A(ix,iy)<128)continue;
    const e=A(ix+3,iy)<128||A(ix-3,iy)<128||A(ix,iy+3)<128||A(ix,iy-3)<128;
    const x=jx-pad,y=jy-pad,li=Math.min(ls.length-1,Math.max(0,Math.floor(y/lh))),Ld=L[li],dx=Ld.right-x;
    let k=0;while(k<Ld.acc.length-1&&Ld.acc[k]<dx)k++;
    const prev=k?Ld.acc[k-1]:0,within=Math.min(1,Math.max(0,(dx-prev)/Math.max(1,Ld.acc[k]-prev)));
    const ord=(Ld.g0+k+within*.85)/Math.max(1,gTot);
    const layers=e?4:1;
    for(let l=0;l<layers&&n<TXMAX;l++){
      tAttr.aT[n*3]=x-w/2;tAttr.aT[n*3+1]=-(y-hT/2);tAttr.aT[n*3+2]=l?-ext*l/3:gs()*fs*.008;
      tAttr.aS[n*3]=gs()*fs*.9;tAttr.aS[n*3+1]=gs()*fs*.6+fs*.25;tAttr.aS[n*3+2]=-(fs*3+R()*fs*9);
      tAttr.aO[n]=Math.min(.999,ord+l*.35/Math.max(1,gTot));
      tAttr.aB[n]=l?[.42,.26,.15][l-1]:(e?1:.62);
      tAttr.aR[n]=R();n++;
    }
  }
  ['position','aS','aO','aB','aR'].forEach(k=>tGeo.getAttribute(k).needsUpdate=true);
  tGeo.setDrawRange(0,n);
  tU.uPx.value=step*1.45;tU.uWin.value=Math.min(.5,2.4/Math.max(1,gTot));tU.uFs.value=fs;
  TXT.el=el;
}
function placeText(){
  if(!TXT.el)return;const r=TXT.el.getBoundingClientRect();
  tPts.position.set(r.left+r.width/2-innerWidth/2,innerHeight/2-(r.top+r.height/2),0);
}

let cur=-1,op=0,wi=0,pause=0;const scrimRect=new THREE.Vector4(.5,.5,.3,.2),scrimRect2=new THREE.Vector4(-9,-9,.1,.1);
function rectOf(nodes,v){
  let l=1e9,t=1e9,r=-1e9,b=-1e9;
  nodes.forEach(n=>{const q=n.getBoundingClientRect();if(!q.width)return;l=Math.min(l,q.left);t=Math.min(t,q.top);r=Math.max(r,q.right);b=Math.max(b,q.bottom);});
  if(r<l){v.set(-9,-9,.1,.1);return {l,t,r,b};}
  v.set((l+r)/2/innerWidth,1-(t+b)/2/innerHeight,Math.max(.12,(r-l)/innerWidth*.72),Math.max(.1,(b-t)/innerHeight*.8));return {l,t,r,b};
}
function measureScrim(c){
  const split=c.el.matches('.lay-sa,.lay-sb');
  if(split&&c.groups.length===2){rectOf([c.groups[0]],scrimRect);rectOf([c.groups[1]],scrimRect2);}
  else{rectOf(c.tws.map(x=>x.n),scrimRect);scrimRect2.set(-9,-9,.1,.1);}
}
function showCap(i){
  cur=i;const c=caps[i];
  c.tws.forEach(t=>{t.k=0;t.acc=0;t.started=false;t.cw=null;if(t.tx)t.tx.textContent='';t.n.classList.remove('live','done');});
  // Only the side captions are positioned by the engine, and only when the page did not author
  // a data-pos. Those are the ones we steer away from the subject; everything else is left alone.
  if(c.el.matches('.cap--side')&&!c.el.dataset.pos){
    const sp=tmp.copy(look).project(camera);
    const fx=sp.x*.5+.5,fy=.5-sp.y*.5;
    let best=null,bd=-1;
    for(const k of LAYS){const p=LAYPT[k];const dd=(p[0]-fx)*(p[0]-fx)+(p[1]-fy)*(p[1]-fy);
      if(dd>bd){bd=dd;best=k;}}
    if(best){LAYS.forEach(k=>c.el.classList.remove('lay-'+k));c.el.classList.add('lay-'+best);
      c.groups=[...c.el.querySelectorAll('.cap-head,.cap-body')];}
  }
  wi=0;pause=reduce?0:.35;op=1;c.el.classList.add('on');c.el.style.opacity='1';c.el.style.filter='';
  TXT.el=null;tGeo.setDrawRange(0,0);tU.uOut.value=0;tU.uReveal.value=0;
  measureScrim(c);
}
function typeInto(t,from,to){ // words enter in 3D; letters are written one by one inside the current word
  for(let i=from;i<to;i++){const g=t.g[i];
    if(g===' '){t.tx.append(' ');t.cw=null;continue;}
    if(!t.cw){t.cw=document.createElement('span');t.cw.className='w';t.tx.append(t.cw);}
    t.cw.textContent+=g;}
}
function capTick(dt,target){
  if(!caps.length)return;
  target=Math.min(target,caps.length-1);
  if(cur!==target){
    if(cur>=0){
      op-=dt/(reduce?.01:.5);const c=caps[cur],v=Math.max(0,op);
      c.el.style.opacity=v.toFixed(3);c.el.style.filter=reduce?'':`blur(${((1-v)*4).toFixed(2)}px)`;
      tU.uOut.value=1-v;
      if(op<=0){c.el.classList.remove('on');c.el.style.opacity='';c.el.style.filter='';cur=-1;}
    }else showCap(target);
    return;
  }
  const c=caps[cur];if(wi>=c.tws.length)return;
  if(pause>0){pause-=dt;return;}
  const t=c.tws[wi];
  if(t.is3d){
    if(!t.started){if(!fontsReady)return;buildText(t);placeText();t.started=true;TXT.dur=Math.max(.9,t.g.length/t.rate);tU.uReveal.value=0;}
    tU.uReveal.value=reduce?1:Math.min(1,tU.uReveal.value+dt/TXT.dur);
    if(tU.uReveal.value>=1){wi++;pause=reduce?0:.25;}
    return;
  }
  t.n.classList.add('live');
  const before=t.k;
  if(reduce)t.k=t.g.length;else{t.acc+=dt*t.rate;const add=Math.floor(t.acc);if(add){t.acc-=add;t.k=Math.min(t.g.length,t.k+add);}}
  if(t.k!==before){if(reduce)t.tx.textContent=t.text;else typeInto(t,before,t.k);}
  if(t.k>=t.g.length){t.n.classList.remove('live');t.n.classList.add('done');wi++;pause=reduce?0:.3;}
}

/* ---------- ui ---------- */
const btns=[...document.querySelectorAll('[data-go]')];
const chapStart=btns.map(b=>+b.dataset.go);
const maxScroll=()=>document.documentElement.scrollHeight-innerHeight;
function jumpTo(p){ // far jumps land at once and the cloud regathers around the new scene
  scrollTo({top:p*maxScroll(),behavior:'auto'});
  if(stAnim){const tw=stAnim.scrollTrigger&&stAnim.scrollTrigger.getTween&&stAnim.scrollTrigger.getTween();if(tw)tw.progress(1);stAnim.progress(p);}
  sS=p;
  if(G&&!reduce)G.fromTo(uniforms.uIntro,{value:.25},{value:1,duration:1.8,ease:'power2.out'});
}
function goTo(i){
  const p=i===0?0:(i+.5)/NC,y=p*maxScroll();
  if(reduce||Math.abs(i-Math.floor(sS*NC+1e-4))>2){jumpTo(p);return;}
  if(G&&STO)G.to(window,{scrollTo:{y,autoKill:true},duration:1.8,ease:'power2.inOut'});else scrollTo({top:y,behavior:'smooth'});
}
btns.forEach(b=>b.addEventListener('click',()=>goTo(+b.dataset.go)));
const isUI=t=>!!(t&&t.closest&&t.closest('button,a,.rail,.pc-ui'));
let moved=0;
addEventListener('click',e=>{ // a click anywhere on the story moves to the next moment
  if(isUI(e.target)||e.target.closest('.pc-hs')||free||moved>6)return;
  if(hsHover>=0){openHS(hsHover);return;}      // clicking a hotspot opens its card instead of advancing
  if(hsOpen>=0){hsOpen=-1;hsCard.classList.remove('on');return;}
  goTo(Math.min(NC-1,Math.floor(sS*NC+1e-4)+1));
});
const again=document.getElementById('again');if(again)again.addEventListener('click',()=>jumpTo(0));
const prog=document.getElementById('prog');
// a point-cloud style progress rail: a scatter of dots that light up as the reader descends the story
let dotEls=null;
{const railEl=document.querySelector('.rail');
  if(railEl){
    document.head.insertAdjacentHTML('beforeend','<style>.rail .prog{opacity:.12}.pc-dots{position:absolute;left:0;top:6px;bottom:6px;width:8px;pointer-events:none}.pc-dots i{position:absolute;left:var(--jx,0);width:2px;height:2px;border-radius:50%;background:var(--faint,rgba(255,255,255,.3));transition:background .3s,box-shadow .3s}.pc-dots i.lit{background:var(--warm,#e8d6ba);box-shadow:0 0 4px 1px rgba(232,214,186,.55)}</style>');
    const wrap=document.createElement('div');wrap.className='pc-dots';
    const DOTS=26;dotEls=[];
    for(let i=0;i<DOTS;i++){const di=document.createElement('i');di.style.setProperty('--jx',rn(-2,2).toFixed(1)+'px');di.style.top=(i/(DOTS-1)*100).toFixed(2)+'%';wrap.appendChild(di);dotEls.push(di);}
    railEl.appendChild(wrap);
  }}
const ptr={x:0,y:0},ptrS={x:0,y:0};
addEventListener('pointermove',e=>{ptr.x=e.clientX/innerWidth*2-1;ptr.y=-(e.clientY/innerHeight*2-1);});

/* ---------- spatial audio (opt-in via S.audio): an ambient drone, a scan-hum on chapter change, and a
   real-time amplitude feed into uAudioLevel for a subtle audio-reactive point pulse ---------- */
const audio={ctx:null,master:null,analyser:null,freqData:null,filt:null};
function startAudio(){
  if(audio.ctx||!S.audio)return;
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
  const ctx=new AC();audio.ctx=ctx;
  const master=ctx.createGain();master.gain.value=0;master.connect(ctx.destination);
  master.gain.linearRampToValueAtTime(.5,ctx.currentTime+2.5);
  const analyser=ctx.createAnalyser();analyser.fftSize=64;master.connect(analyser);
  audio.master=master;audio.analyser=analyser;audio.freqData=new Uint8Array(analyser.frequencyBinCount);
  // a low, slowly filtered drone: two detuned tones through a swept lowpass, for an ambient cybernetic hum
  const filt=ctx.createBiquadFilter();filt.type='lowpass';filt.frequency.value=340;filt.Q.value=.7;filt.connect(master);
  [0,-6].forEach(det=>{const o=ctx.createOscillator();o.type='sine';o.frequency.value=55;o.detune.value=det;
    const g=ctx.createGain();g.gain.value=.16;o.connect(g);g.connect(filt);o.start();});
  const lfo=ctx.createOscillator();lfo.frequency.value=.05;const lfoG=ctx.createGain();lfoG.gain.value=180;
  lfo.connect(lfoG);lfoG.connect(filt.frequency);lfo.start();
  audio.filt=filt;
  buildWind(ctx,master);
  buildBed(ctx,master);

}
/* The ambient bed. No oscillator melodies: two wide noise layers and a slow breath in the
   filters, which is what gives a room its own sound. Everything is generated, no audio files. */
function buildBed(ctx,dest){
  const mk=(seconds,brown)=>{const len=Math.floor(ctx.sampleRate*seconds),b=ctx.createBuffer(1,len,ctx.sampleRate),d=b.getChannelData(0);
    let last=0;for(let i=0;i<len;i++){const w=R()*2-1;if(brown){last=(last+.014*w)/1.014;d[i]=last*7;}else{last=(last+.32*w)/1.32;d[i]=last*1.4;}}
    return b;};
  // deep air: brown noise under a low shelf, the floor of the room
  const air=ctx.createBufferSource();air.buffer=mk(7,true);air.loop=true;
  const airF=ctx.createBiquadFilter();airF.type='lowpass';airF.frequency.value=190;airF.Q.value=.4;
  const airG=ctx.createGain();airG.gain.value=.30;
  air.connect(airF);airF.connect(airG);airG.connect(dest);air.start();
  // distant hiss: a thin band far above, so the space reads as open rather than sealed
  const hiss=ctx.createBufferSource();hiss.buffer=mk(5,false);hiss.loop=true;
  const hissF=ctx.createBiquadFilter();hissF.type='bandpass';hissF.frequency.value=1500;hissF.Q.value=.55;
  const hissG=ctx.createGain();hissG.gain.value=.022;
  hiss.connect(hissF);hissF.connect(hissG);hissG.connect(dest);hiss.start();
  // a very slow breath across both filters
  const lfo=ctx.createOscillator();lfo.frequency.value=.021;
  const la=ctx.createGain();la.gain.value=70;lfo.connect(la);la.connect(airF.frequency);
  const lb=ctx.createGain();lb.gain.value=520;lfo.connect(lb);lb.connect(hissF.frequency);
  lfo.start();
  audio.bed={airG,hissG};
}
/* spatial wind: filtered noise through a 3D panner placed out in the scene, so it moves with the camera */
function buildWind(ctx,dest){
  const len=ctx.sampleRate*3,buf=ctx.createBuffer(1,len,ctx.sampleRate),d=buf.getChannelData(0);
  let last=0;for(let i=0;i<len;i++){const w=R()*2-1;last=(last+.02*w)/1.02;d[i]=last*3.5;}
  const src=ctx.createBufferSource();src.buffer=buf;src.loop=true;
  const bp=ctx.createBiquadFilter();bp.type='bandpass';bp.frequency.value=520;bp.Q.value=.6;
  const g=ctx.createGain();g.gain.value=.12;
  const pan=ctx.createPanner();pan.panningModel='HRTF';pan.distanceModel='inverse';pan.refDistance=14;pan.maxDistance=900;
  src.connect(bp);bp.connect(g);g.connect(pan);pan.connect(dest);src.start();
  audio.windGain=g;audio.windPan=pan;audio.windFilt=bp;
}
function hsPing(){ // a soft two-tone chime when a hotspot card opens
  if(!audio.ctx)return;const ctx=audio.ctx,t0=ctx.currentTime;
  [880,1320].forEach((f,i)=>{const o=ctx.createOscillator();o.type='sine';o.frequency.value=f;
    const g=ctx.createGain();g.gain.setValueAtTime(.0001,t0+i*.07);
    g.gain.exponentialRampToValueAtTime(.08,t0+i*.07+.02);g.gain.exponentialRampToValueAtTime(.0001,t0+i*.07+.42);
    o.connect(g);g.connect(audio.master);o.start(t0+i*.07);o.stop(t0+i*.07+.45);});
}
function hsTick(){ // a soft, short chime when the cursor first touches a hotspot
  if(!audio.ctx)return;const ctx=audio.ctx,t0=ctx.currentTime;
  const o=ctx.createOscillator();o.type='sine';o.frequency.setValueAtTime(1180,t0);
  o.frequency.exponentialRampToValueAtTime(1560,t0+.09);
  const g=ctx.createGain();g.gain.setValueAtTime(.0001,t0);
  g.gain.exponentialRampToValueAtTime(.045,t0+.015);g.gain.exponentialRampToValueAtTime(.0001,t0+.22);
  o.connect(g);g.connect(audio.master);o.start(t0);o.stop(t0+.25);
}
/* a slow filtered-noise swell for a scene change: the room tone opens and closes again */
function sceneSweep(){
  if(!audio.ctx)return;const ctx=audio.ctx,t0=ctx.currentTime;
  const len=Math.floor(ctx.sampleRate*1.6),buf=ctx.createBuffer(1,len,ctx.sampleRate),d=buf.getChannelData(0);
  let last=0;for(let i=0;i<len;i++){const w=R()*2-1;last=(last+.03*w)/1.03;d[i]=last*3.2;}
  const src=ctx.createBufferSource();src.buffer=buf;
  const bp=ctx.createBiquadFilter();bp.type='bandpass';bp.Q.value=1.1;
  bp.frequency.setValueAtTime(260,t0);bp.frequency.exponentialRampToValueAtTime(2400,t0+.9);
  bp.frequency.exponentialRampToValueAtTime(420,t0+1.5);
  const g=ctx.createGain();g.gain.setValueAtTime(.0001,t0);
  g.gain.linearRampToValueAtTime(.085,t0+.35);g.gain.exponentialRampToValueAtTime(.0001,t0+1.5);
  src.connect(bp);bp.connect(g);g.connect(audio.master);src.start(t0);src.stop(t0+1.55);
}
function scanHum(){ // a short rising blip on chapter change, like a sensor confirming a new target
  if(!audio.ctx)return;const ctx=audio.ctx,t0=ctx.currentTime;
  const o=ctx.createOscillator();o.type='sine';o.frequency.setValueAtTime(220,t0);o.frequency.exponentialRampToValueAtTime(660,t0+.35);
  const g=ctx.createGain();g.gain.setValueAtTime(.0001,t0);g.gain.linearRampToValueAtTime(.12,t0+.05);g.gain.exponentialRampToValueAtTime(.0001,t0+.5);
  o.connect(g);g.connect(audio.master);o.start(t0);o.stop(t0+.55);
}
if(S.audio){const kick=()=>{startAudio();removeEventListener('pointerdown',kick);removeEventListener('keydown',kick);removeEventListener('wheel',kick);};
  addEventListener('pointerdown',kick,{once:true});addEventListener('keydown',kick,{once:true});addEventListener('wheel',kick,{once:true});}

/* ---------- free rotation: drag to turn around the subject, wheel or pinch to zoom ---------- */
const user={yaw:0,pitch:0,zoom:1};let free=false,drag=false,backTw=null;
document.head.insertAdjacentHTML('beforeend',`<style>
.pc-ui{position:fixed;left:max(3vw,16px);bottom:calc(3.5vh + env(safe-area-inset-bottom,0px));z-index:3;display:flex;align-items:center;gap:.7rem;direction:rtl}
.pc-free{display:none!important;appearance:none;align-items:center;gap:.5rem;background:rgba(5,5,5,.55);color:var(--ink,#eee);border:1px solid var(--faint,rgba(255,255,255,.2));border-radius:999px;padding:.5rem .95rem;font:inherit;font-size:.85rem;cursor:pointer;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);transition:border-color .3s,box-shadow .3s}
.pc-free svg{width:1.05em;height:1.05em;flex:none}
.pc-free[aria-pressed="true"]{border-color:var(--warm,#e8d6ba);box-shadow:0 0 16px -6px var(--warm,#e8d6ba)}
.pc-free:focus-visible{outline:2px solid var(--ink,#eee);outline-offset:3px}
.pc-hint{font-size:.78rem;color:var(--dim,rgba(255,255,255,.6));opacity:0;transition:opacity .4s;pointer-events:none}
.pc-free[aria-pressed="true"]+.pc-hint{opacity:1}
html.pc-freemode .captions{opacity:.2;transition:opacity .5s}
html.pc-freemode,html.pc-freemode body{overflow:hidden;touch-action:none}
html.pc-freemode .track{cursor:grab}
@media (max-width:760px){.pc-hint{display:none}}
</style>`);
const ui=document.createElement('div');ui.className='pc-ui';
ui.innerHTML='<button class="pc-free" type="button" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/></svg><span>تدوير حر</span></button><span class="pc-hint">اسحب للتدوير · العجلة للتقريب · Esc للرجوع</span>';
document.body.append(ui);
// inspector mode: live scene/camera/photogrammetry stats, shown only during free orbit
document.head.insertAdjacentHTML('beforeend','<style>.pc-inspect{position:fixed;right:max(3vw,16px);top:calc(3.5vh + env(safe-area-inset-top,0px));z-index:3;font:12px/1.7 ui-monospace,Menlo,Consolas,monospace;color:var(--dim,rgba(255,255,255,.75));background:rgba(5,5,5,.55);border:1px solid var(--faint,rgba(255,255,255,.18));border-radius:10px;padding:.6rem .85rem;white-space:pre-line;direction:ltr;text-align:left;opacity:0;transform:translateY(-4px);transition:opacity .3s,transform .3s;pointer-events:none;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}.pc-inspect.on{opacity:1;transform:translateY(0)}@media (max-width:760px){.pc-inspect{display:none}}</style>');
const inspect=document.createElement('div');inspect.className='pc-inspect';document.body.append(inspect);

/* ---------- hotspots: glowing markers at places of interest, with a card of historical context ----------
   Declared per story:  hotspots:[{scene:'kaaba', at:[x,y,z], title:'…', body:'…'}] */
const HS=(S.hotspots||[]).map(h=>({...h,world:new THREE.Vector3(...SC[h.scene].at).add(new THREE.Vector3(...h.at)),sx:0,sy:0,vis:0}));
let hsHover=-1,hsOpen=-1;
const hsGeo=new THREE.BufferGeometry(),hsPts=(()=>{
  if(!HS.length)return null;
  const p=new Float32Array(HS.length*3);HS.forEach((h,i)=>h.world.toArray(p,i*3));
  hsGeo.setAttribute('position',new THREE.BufferAttribute(p,3));
  hsGeo.setAttribute('aI',new THREE.BufferAttribute(new Float32Array(HS.map((_,i)=>i)),1));
  const u={uTime:uniforms.uTime,uScale:uniforms.uScale,uRS:uniforms.uRS,uHover:{value:-1},uVis:{value:new Float32Array(Math.max(1,HS.length))}};
  const m=new THREE.ShaderMaterial(Object.assign({uniforms:u,
    vertexShader:`attribute float aI;uniform float uTime,uScale,uRS,uHover;uniform float uVis[${Math.max(1,HS.length)}];
      varying float vP,vH,vSeed;
      void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
        float vis=uVis[int(aI)];vH=abs(uHover-aI)<.5?1.:0.;
        float pulse=.5+.5*sin(uTime*1.35+aI*1.7);
        vP=(.78+.22*pulse)*vis;                  // a slow breath, not a blink
        vSeed=aI;
        gl_PointSize=clamp((26.+vH*16.)*uRS*(.84+.16*vP),8.,72.*uRS)*step(.01,vis);}`,
    fragmentShader:`uniform float uTime;varying float vP,vH,vSeed;
      void main(){vec2 c=gl_PointCoord*2.-1.;float d=length(c);if(d>1.)discard;
        // a point of light: a tight core inside a wide, gently falling halo — the same register
        // as the wandering lamp, so an interactive place glows rather than wearing UI colour
        float core=exp(-d*d*17.)*1.35;
        float halo=exp(-d*d*3.0)*.34;
        // radar: three rings expanding out of the point and thinning as they go
        float t=uTime*.5+vSeed*.37,rings=0.;
        for(int i=0;i<3;i++){
          float ph=fract(t+float(i)*.3333),rr=ph*.96;
          rings+=smoothstep(rr-.038,rr,d)*(1.-smoothstep(rr,rr+.038,d))*(1.-ph);
        }
        float a=(core+halo+rings*1.15)*vP*(.78+.42*vH);
        vec3 col=mix(vec3(.90,.90,.90),vec3(1.,1.,1.),vH);   // neutral white, brighter under the cursor
        gl_FragColor=vec4(col*a*2.0,a);}`},ADD));
  const pts=new THREE.Points(hsGeo,m);pts.frustumCulled=false;scene.add(pts);return pts;})();
document.head.insertAdjacentHTML('beforeend','<style>'+
'.pc-hs{position:fixed;z-index:4;width:min(21rem,72vw);background:rgba(8,9,12,.9);border:1px solid rgba(226,232,240,.24);border-radius:12px;padding:.85rem 1rem;color:var(--ink,#e2e8f0);opacity:0;transform:translateY(6px) scale(.98);transition:opacity .28s,transform .28s;pointer-events:none;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:0 10px 40px -12px #000}'+
'.pc-hs.on{opacity:1;transform:none;pointer-events:auto}'+
'.pc-hs h3{margin:0 0 .35rem;font-size:1rem;font-weight:700;letter-spacing:.01em}'+
'.pc-hs p{margin:0;font-size:.84rem;line-height:1.75;color:var(--dim,rgba(226,232,240,.75))}'+
'.pc-hs .k{display:block;font-size:.68rem;letter-spacing:.14em;color:rgba(226,232,240,.5);margin-bottom:.3rem}'+
'.pc-hs button{position:absolute;top:.4rem;left:.5rem;appearance:none;background:none;border:0;color:inherit;opacity:.55;font-size:1.05rem;line-height:1;cursor:pointer;padding:.2rem .35rem}'+
'.pc-hs button:hover{opacity:1}html.pc-freemode .pc-hs{display:none}</style>');
const hsCard=document.createElement('div');hsCard.className='pc-hs';hsCard.setAttribute('role','dialog');
hsCard.innerHTML='<button type="button" aria-label="إغلاق">✕</button><span class="k"></span><h3></h3><p></p>';
document.body.append(hsCard);
hsCard.querySelector('button').addEventListener('click',()=>{hsOpen=-1;hsCard.classList.remove('on');});
function openHS(i){
  hsOpen=i;const h=HS[i];
  hsCard.querySelector('.k').textContent=h.kicker||'';
  hsCard.querySelector('h3').textContent=h.title||'';
  hsCard.querySelector('p').textContent=h.body||'';
  hsCard.classList.add('on');
}
/* a ring cursor: the native arrow is a desktop artefact in a scene like this, and the ring
   doubles as the scan brush's own footprint, widening when it finds something interactive */
document.head.insertAdjacentHTML('beforeend','<style>'+
'html.pc-ring,html.pc-ring *{cursor:none!important}'+
'.pc-ring-dot{position:fixed;left:0;top:0;width:30px;height:30px;margin:-15px 0 0 -15px;border:1px solid rgba(238,242,250,.5);border-radius:50%;pointer-events:none;z-index:9;opacity:0;transition:width .22s cubic-bezier(.2,.8,.3,1),height .22s cubic-bezier(.2,.8,.3,1),margin .22s cubic-bezier(.2,.8,.3,1),border-color .25s,opacity .3s}'+
'.pc-ring-dot::after{content:"";position:absolute;left:50%;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;border-radius:50%;background:rgba(238,242,250,.85)}'+
'.pc-ring-dot.on{opacity:1}'+
'.pc-ring-dot.hot{width:52px;height:52px;margin:-26px 0 0 -26px;border-color:rgba(122,235,166,.9)}'+
'@media (hover:none){.pc-ring-dot{display:none}html.pc-ring,html.pc-ring *{cursor:auto!important}}'+
'</style>');
const ringDot=document.createElement('div');ringDot.className='pc-ring-dot';document.body.append(ringDot);
if(matchMedia('(hover:hover)').matches)document.documentElement.classList.add('pc-ring');
addEventListener('pointermove',e=>{ringDot.style.transform='translate('+e.clientX+'px,'+e.clientY+'px)';ringDot.classList.add('on');},{passive:true});
addEventListener('pointerleave',()=>ringDot.classList.remove('on'),{passive:true});
const wrapFade=document.createElement('div');
wrapFade.style.cssText='position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:8';
document.body.append(wrapFade);let wrapT=-1;
const freeBtn=ui.querySelector('.pc-free');
function returnCam(delay){if(backTw&&backTw.kill)backTw.kill();
  if(G&&!reduce)backTw=G.to(user,{yaw:0,pitch:0,zoom:1,duration:2.4,delay:delay||0,ease:'power3.inOut'});else{user.yaw=user.pitch=0;user.zoom=1;}}
function setFree(on){free=on;freeBtn.setAttribute('aria-pressed',String(on));document.documentElement.classList.toggle('pc-freemode',on);
  if(on){if(backTw&&backTw.kill)backTw.kill();}else{returnCam(0);inspect.classList.remove('on');}}
freeBtn.addEventListener('click',()=>setFree(!free));
// the control is hidden, so free orbit is reached by key or double-click instead
addEventListener('keydown',e=>{if((e.key==='r'||e.key==='R')&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!isUI(e.target))setFree(!free);});
addEventListener('dblclick',e=>{if(!isUI(e.target))setFree(!free);});
addEventListener('keydown',e=>{if(e.key==='Escape'&&free)setFree(false);});
const touches=new Map();
addEventListener('pointerdown',e=>{moved=0;if(isUI(e.target))return;
  if(e.pointerType!=='mouse'&&!free)return;            // on touch screens, dragging scrolls the story unless free rotation is on
  touches.set(e.pointerId,{x:e.clientX,y:e.clientY});drag=true;if(backTw&&backTw.kill)backTw.kill();});
addEventListener('pointermove',e=>{
  if(!drag||!touches.has(e.pointerId))return;const q=touches.get(e.pointerId);
  if(touches.size===2){const [p1,p2]=[...touches.values()],d0=Math.hypot(p1.x-p2.x,p1.y-p2.y);q.x=e.clientX;q.y=e.clientY;
    const d1=Math.hypot(p1.x-p2.x,p1.y-p2.y);if(d0>0&&d1>0)user.zoom=Math.max(.25,Math.min(3,user.zoom*d0/d1));moved+=99;return;}
  const dx=e.clientX-q.x,dy=e.clientY-q.y;q.x=e.clientX;q.y=e.clientY;moved+=Math.abs(dx)+Math.abs(dy);
  user.yaw-=dx*.0055;user.pitch=Math.max(-1.3,Math.min(1.3,user.pitch+dy*.0045));
});
function endDrag(e){touches.delete(e.pointerId);if(touches.size)return;if(drag&&moved>6&&!free)returnCam(2);drag=false;}
addEventListener('pointerup',endDrag);addEventListener('pointercancel',endDrag);
addEventListener('wheel',e=>{if(!free)return;e.preventDefault();user.zoom=Math.max(.25,Math.min(3,user.zoom*Math.exp(e.deltaY*.0012)));},{passive:false});
addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);sizeAll();
  if(cur>=0){measureScrim(caps[cur]);const t=caps[cur].tws.find(x=>x.is3d&&x.started);if(t){const rv=tU.uReveal.value;buildText(t);tU.uReveal.value=rv;placeText();}}
});

/* ---------- loop ---------- */
const clock=new THREE.Clock();
const look=TGT[0].clone(),tmp=new THREE.Vector3(),UP=new THREE.Vector3(0,1,0),bg=new THREE.Color(0x040406);
const shake=(t,seed)=>Math.sin(t*1.7+seed)*.5+Math.sin(t*4.1+seed*2.3)*.3+Math.sin(t*9.3+seed*4.7)*.2;   // cheap band-limited noise for handheld sway
const hasHover=matchMedia('(hover:hover)').matches;
const raycaster=new THREE.Raycaster(),mousePlane=new THREE.Plane(),mouseWorld=new THREE.Vector3();
const sunDir=new THREE.Vector3(LD[0],LD[1],LD[2]),sunWorld=new THREE.Vector3(),sunNdc=new THREE.Vector3(),camDirCache=new THREE.Vector3();
let sS=0,prevSS=0,active=-1,fAcc=0,fN=0,pingT=0,mouseA=0,inspAcc=0,audioLevel=0,windV=0,lastSceneId=null;
const camSm=new THREE.Vector3();let camSmOn=false;   // low-passed camera position
// lower = heavier filtering = smoother but laggier; 99 is effectively the old unfiltered behaviour
const CAMSM=S.camSmooth===undefined?3.4:S.camSmooth;
function tick(){
  const dt=Math.min(clock.getDelta(),.1),t=clock.elapsedTime;
  const max=maxScroll();
  // scroll loop: at the foot of the track, wrap back to the head. The tween is reset rather than
  // scrubbed so the story restarts instead of rewinding through every chapter.
  if(S.loop&&max>0){
    // dip out across the last stretch of the track
    const RUN=Math.min(900,max*.05);
    if(wrapT<0)wrapFade.style.opacity=Math.max(0,Math.min(1,(scrollY-(max-RUN))/RUN)).toFixed(3);
  }
  if(wrapT>=0){                       // and come back up once the story has restarted
    const k=Math.min(1,(t-wrapT)/.85);
    wrapFade.style.opacity=(1-k).toFixed(3);
    if(k>=1)wrapT=-1;
  }
  if(S.loop&&max>0&&scrollY>=max-2){
    scrollTo(0,0);
    if(stAnim){stAnim.scrollTrigger.scroll(0);stAnim.progress(0);}
    /* Tear the closing caption down properly. Just dropping `cur` left the last section still
       carrying .on and opacity 1, so the opening verse typed itself on top of it and the wrap
       announced itself. Reset the 3D heading buffers with it, exactly as showCap() would. */
    if(cur>=0){
      const cc=caps[cur];
      cc.el.classList.remove('on');cc.el.style.opacity='';cc.el.style.filter='';
      cc.tws.forEach(t=>{t.k=0;t.acc=0;t.started=false;t.cw=null;
        if(t.tx)t.tx.textContent='';t.n.classList.remove('live','done');});
    }
    TXT.el=null;tGeo.setDrawRange(0,0);tU.uOut.value=0;tU.uReveal.value=0;
    wi=0;op=1;pause=reduce?0:.35;
    scrimM.uniforms.uA.value=0;          // no scrim left hanging over an empty frame
    story.s=0;sS=0;prevSS=0;camSmOn=false;cur=-1;active=-1;
    wrapFade.style.opacity='1';wrapT=t;   // hold black through the cut, then rise
  }
  const s=max>0?Math.min(1,Math.max(0,scrollY/max)):0;
  if(stAnim)sS=story.s;                               // GSAP ScrollTrigger scrubs the story with a soft lag
  else sS+=reduce?(s-sS):(s-sS)*(1-Math.exp(-dt*2.2));

  const x=sS*NC-.5,i0=Math.max(0,Math.min(NC-1,Math.floor(x))),f=Math.min(1,Math.max(0,x-i0));
  // a wider ease window spreads each shot hand-over over more of the scroll, so the camera
  // glides between keyframes instead of easing hard in the middle
  const u=Math.max(0,Math.min(NC-1,x<0?0:i0+smooth(.04,.96,f)));
  const a=Math.floor(u),b=Math.min(NC-1,a+1),fu=u-a;
  curShot=Math.round(u);
  uniforms.uW.value=useScenes(SHOTS[a].scene,SHOTS[b].scene,fu);
  uniforms.uTime.value=t;tU.uTime.value=t;
  if(!G&&!reduce)uniforms.uIntro.value=smooth(0,3.6,t);
  const grain=GRAIN[a]+(GRAIN[b]-GRAIN[a])*fu,dofAmt=DOFA[a]+(DOFA[b]-DOFA[a])*fu;
  { // time of day: the depth ramp and the background cross-fade between the two shots' states
    const ta=TODS[a],tb=TODS[b];
    uniforms.uTodNear.value.fromArray(todMix(ta,tb,fu,'near'));
    uniforms.uTodMid.value.fromArray(todMix(ta,tb,fu,'mid'));
    uniforms.uTodFar.value.fromArray(todMix(ta,tb,fu,'far'));
    uniforms.uTodCon.value=ta.con+(tb.con-ta.con)*fu;
    bg.fromArray(todMix(ta,tb,fu,'bg'));
  }
  const W=uniforms.uW.value,spw=slotSp[0]*(1-W)+slotSp[1]*W;
  uniforms.uWorld.value=Math.max(base0*grain,spw*.24);uniforms.uSpacing.value=spw;
  clayM.uniforms.uGrid.value=slotGrid[0]*(1-W)+slotGrid[1]*W; // sparse, wide scenes get larger splats so their surfaces stay solid

  // the path point itself was applied raw, so every wobble in the scroll reached the lens.
  // Filter it like the look-at already is, but snap on a far chapter jump rather than gliding.
  const camT=camCurve.getPoint(u/(NC-1));
  if(camSmOn&&camSm.distanceTo(camT)<uniforms.uFocusDist.value*2.5)camSm.lerp(camT,reduce?1:1-Math.exp(-dt*CAMSM));
  else{camSm.copy(camT);camSmOn=true;}
  camera.position.copy(camSm);
  look.lerp(tgtCurve.getPoint(u/(NC-1)),reduce?1:1-Math.exp(-dt*2.2));
  if(!reduce){ // the camera never rests: a slow orbit, a gentle push in and out, a soft rise and fall
    const orb=(ORBIT[a]+(ORBIT[b]-ORBIT[a])*fu)*(free?0:1),ang=(Math.sin(t*.031)*.2+Math.sin(t*.013+1)*.12)*orb;
    tmp.copy(camera.position).sub(look).applyAxisAngle(UP,ang).multiplyScalar(1+Math.sin(t*.047)*.05);
    camera.position.copy(look).add(tmp);camera.position.y+=Math.sin(t*.071)*.9*grain;
  }
  if(user.yaw||user.pitch||user.zoom!==1){ // the viewer's own rotation and zoom around the subject
    tmp.copy(camera.position).sub(look).applyAxisAngle(UP,user.yaw);
    const r=tmp.length()||1,el=Math.asin(Math.max(-1,Math.min(1,tmp.y/r))),el2=Math.max(-1.3,Math.min(1.45,el+user.pitch)),hz=Math.hypot(tmp.x,tmp.z)||1e-6,k=Math.cos(el2)*r/hz;
    tmp.set(tmp.x*k,Math.sin(el2)*r,tmp.z*k).multiplyScalar(user.zoom);camera.position.copy(look).add(tmp);
  }
  camera.lookAt(look);
  ptrS.x+=(ptr.x-ptrS.x)*.04;ptrS.y+=(ptr.y-ptrS.y)*.04;
  if(!reduce&&!free&&!drag){camera.translateX(ptrS.x*1.6*grain);camera.translateY(ptrS.y*.9*grain);}
  const scrollSpeed=Math.abs(sS-prevSS)/Math.max(dt,1e-4);prevSS=sS;
  // wind rises with scroll velocity and eases back down, so leaves, sand and flames gust as the reader moves
  windV+=(Math.min(1,scrollSpeed*55)-windV)*Math.min(1,dt*(scrollSpeed>windV?5:1.2));
  uniforms.uWind.value=reduce?0:windV;
  if(!reduce&&!free){ // handheld sway: a faint, non-repeating wobble that grows while the reader pauses to look
    const pause=Math.max(0,1-scrollSpeed*45);
    camera.translateX(shake(t*1.1,3.7)*.035*pause*grain);camera.translateY(shake(t*.9,11.2)*.028*pause*grain);
    camera.rotateZ(shake(t*.7,5.9)*.0025*pause);
  }

  uniforms.uFocus.value.copy(look);
  uniforms.uFocusDist.value=Math.max(1,camera.position.distanceTo(look));
  clayM.uniforms.uFD.value=edgeU.uFD.value=uniforms.uFocusDist.value;   // the depth ramp is keyed to how far the subject is
  buildEdges(SHOTS[curShot].scene);
  uniforms.uFocusR.value=Math.max(30*grain,uniforms.uFocusDist.value*.42); // wide shots light the whole subject
  uniforms.uLamp.value.set(look.x+Math.cos(t*.13)*18*grain,look.y+(8+Math.sin(t*.21)*5)*grain,look.z+Math.sin(t*.13)*18*grain);
  stars.position.copy(camera.position);stars.rotation.y=t*.003;
  // the wandering light drifts between random places around the subject; glow patches bloom at random
  const R0=uniforms.uFocusR.value*.55;
  if(!G&&!reduce){orbOff.x=Math.sin(t*.23)*Math.cos(t*.071);orbOff.y=.45+.35*Math.sin(t*.17);orbOff.z=Math.sin(t*.13+2)*Math.cos(t*.09);uniforms.uGlowA.value=1;}
  if(reduce)uniforms.uOrb.value.set(0,-1e4,0);
  else uniforms.uOrb.value.set(look.x+orbOff.x*R0,look.y+orbOff.y*R0,look.z+orbOff.z*R0*.8);
  uniforms.uOrbR.value=R0*.42;orbPts.visible=!reduce;orbPts.position.copy(uniforms.uOrb.value);orbPts.scale.setScalar(R0*.1);oU.uSz.value=R0*.012;
  camera.updateMatrixWorld();
  uniforms.uGlowS.value=R0*.35;if(reduce)uniforms.uGlowA.value=0;
  uniforms.uNearFade.value=2.4*grain;   // close-ups need the guard to kick in nearer
  uniforms.uDispAmp.value=Math.min(spw*1.7,grain*.22);uniforms.uDispF.value=1/(clayM.uniforms.uGrid.value*1.3);
  uniforms.uScat.value=uniforms.uFocusR.value/30;

  // interactive pointer: unproject the cursor onto the focus plane for the scan-ring sweep and the flashlight
  if(hasHover&&!reduce){
    mousePlane.setFromNormalAndCoplanarPoint(tmp.copy(camera.position).sub(look).normalize(),look);
    raycaster.setFromCamera({x:ptr.x,y:ptr.y},camera);
    const hit=!free&&!drag&&raycaster.ray.intersectPlane(mousePlane,mouseWorld);
    mouseA+=((hit?1:0)-mouseA)*Math.min(1,dt*3);
    if(hit)uniforms.uMouse.value.copy(mouseWorld);
    pingT=(pingT+dt)%2.6;
    uniforms.uMouseRing.value=pingT*24*grain;uniforms.uMouseFade.value=mouseA*(1-smooth(1.6,2.6,pingT));uniforms.uMouseR.value=8*grain;
    clayM.uniforms.uCamPos.value.copy(camera.position);
  }else uniforms.uMouseFade.value=0;

  // volumetric god-rays: project the key light far along its baked direction and stream the bright-pass buffer toward it
  camera.getWorldDirection(camDirCache);
  sunWorld.copy(camera.position).addScaledVector(sunDir,600);sunNdc.copy(sunWorld).project(camera);
  const facing=Math.max(0,camDirCache.dot(sunDir));
  godM.uniforms.uSun.value.set(sunNdc.x*.5+.5,sunNdc.y*.5+.5);
  compM.uniforms.uGod.value=(S.godrays||0)*smooth(0,.35,facing);   // god-rays are opt-in now (pass {godrays:0.06} per-story) — off by default for a clean, crisp render

  // audio-reactive micro-pulse: a real amplitude feed when audio is enabled, a gentle synthetic breathing otherwise
  if(audio.analyser){audio.analyser.getByteFrequencyData(audio.freqData);
    let sum=0;for(let i=0;i<audio.freqData.length;i++)sum+=audio.freqData[i];
    audioLevel+=(sum/audio.freqData.length/255-audioLevel)*Math.min(1,dt*4);
  }else audioLevel+=((Math.sin(t*.6)*.5+.5)*.3-audioLevel)*Math.min(1,dt*2);
  uniforms.uAudioLevel.value=audioLevel;

  // hotspots: show only those whose scene is loaded, project them to screen, track hover, follow with the card
  if(hsPts){
    // a forgiving hit radius: the marker drifts with the slow camera orbit, so a tight target is hard to catch
    const hitR=small?54:66,vis=hsPts.material.uniforms.uVis.value;let best=-1,bestD=hitR*hitR;
    for(let i=0;i<HS.length;i++){
      const h=HS[i],loaded=slotId.indexOf(h.scene)>=0;
      tmp.copy(h.world).project(camera);
      const on=loaded&&tmp.z<1&&camera.position.distanceTo(h.world)<uniforms.uFocusDist.value*3.2;
      h.vis+=((on&&!free?1:0)-h.vis)*Math.min(1,dt*3);vis[i]=h.vis;
      h.sx=(tmp.x*.5+.5)*innerWidth;h.sy=(-tmp.y*.5+.5)*innerHeight;
      if(h.vis>.5){const px=(ptr.x*.5+.5)*innerWidth,py=(-ptr.y*.5+.5)*innerHeight;
        const d2=(px-h.sx)*(px-h.sx)+(py-h.sy)*(py-h.sy);if(d2<bestD){bestD=d2;best=i;}}
    }
    hsHover=best;hsPts.material.uniforms.uHover.value=best;
    ringDot.classList.toggle('hot',best>=0);
    document.body.style.cursor=best>=0?'pointer':'';
    if(hsOpen>=0){const h=HS[hsOpen];
      if(h.vis<.25){hsOpen=-1;hsCard.classList.remove('on');}
      else{const cw2=Math.min(336,innerWidth*.72);
        hsCard.style.left=Math.max(12,Math.min(innerWidth-cw2-12,h.sx-cw2/2))+'px';
        hsCard.style.top=Math.max(12,Math.min(innerHeight-160,h.sy+22))+'px';}}
  }
  if(audio.windPan){ // the wind sits out past the subject and is heard from wherever the camera stands
    const L=audio.ctx.listener,wp=look;
    if(L.positionX){L.positionX.value=camera.position.x;L.positionY.value=camera.position.y;L.positionZ.value=camera.position.z;}
    else if(L.setPosition)L.setPosition(camera.position.x,camera.position.y,camera.position.z);
    camera.getWorldDirection(camDirCache);
    if(L.forwardX){L.forwardX.value=camDirCache.x;L.forwardY.value=camDirCache.y;L.forwardZ.value=camDirCache.z;L.upX.value=0;L.upY.value=1;L.upZ.value=0;}
    else if(L.setOrientation)L.setOrientation(camDirCache.x,camDirCache.y,camDirCache.z,0,1,0);
    if(audio.windPan.positionX){audio.windPan.positionX.value=wp.x;audio.windPan.positionY.value=wp.y+12;audio.windPan.positionZ.value=wp.z;}
    else if(audio.windPan.setPosition)audio.windPan.setPosition(wp.x,wp.y+12,wp.z);
    audio.windGain.gain.value=.06+windV*.22;                       // gusts track the scroll-driven wind
    audio.windFilt.frequency.value=420+windV*680;
  }

  const target=Math.min(NC-1,Math.floor(sS*NC+1e-4));
  if(t>.4||reduce)capTick(dt,target);
  if(prog)prog.style.transform=`scaleY(${sS.toFixed(4)})`;
  if(dotEls){const litN=Math.round(sS*(dotEls.length-1));for(let i=0;i<dotEls.length;i++)dotEls[i].classList.toggle('lit',i<=litN);}
  let ch=0;chapStart.forEach((c,k)=>{if(target>=c)ch=k;});
  if(ch!==active){active=ch;btns.forEach((bt,k)=>k===ch?bt.setAttribute('aria-current','step'):bt.removeAttribute('aria-current'));}
  // a scene change (not merely a new caption) gets the atmospheric sweep
  {const sid=SHOTS[Math.max(0,Math.min(NC-1,Math.round(u)))].scene;
   if(sid!==lastSceneId){if(lastSceneId!==null)sceneSweep();lastSceneId=sid;}}
  scrimM.uniforms.uR.value.copy(scrimRect);scrimM.uniforms.uR2.value.copy(scrimRect2);scrimM.uniforms.uA.value=cur>=0?.40*Math.max(0,Math.min(1,op)):0;
  if(!reduce){tPts.rotation.y=Math.sin(t*.21)*.09+ptrS.x*.06;tPts.rotation.x=Math.sin(t*.17)*.05-ptrS.y*.04;}
  if(inspect){inspAcc+=dt;if(free&&inspAcc>.2){inspAcc=0;
    const activeN=Math.floor(N*[1,.85,.72,.6][quality]);
    inspect.textContent=`نقاط نشطة: ${activeN.toLocaleString('ar')} / ${N.toLocaleString('ar')}
المشاهد المحمّلة: ${slotId[0]||'—'}  ·  ${slotId[1]||'—'}
كاميرا: ${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}
مسافة التركيز: ${uniforms.uFocusDist.value.toFixed(1)} م
دقة العرض: ${Math.round(RS*100)}٪  ·  DPR ${PR.toFixed(2)}  ·  جودة ${quality}`;
    inspect.classList.add('on');
  }else if(!free)inspect.classList.remove('on');}

  // render: scene -> darken behind the caption -> 3D heading -> glow, haze, tone map
  camera.updateMatrixWorld();
  if(hooks.onFrame)hooks.onFrame(dt,t);   // pages driving extra geometry update it here, after the camera settles
  if(clay){ // depth of the clay splats, then shade them as a lit, scanned surface
    renderer.setRenderTarget(rtDepth);renderer.setClearColor(0x000000,0);renderer.clear();renderer.render(clayScene,camera);
    const cu=clayM.uniforms;cu.uTanH.value=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));cu.uAsp.value=camera.aspect;
    cu.uL.value.set(-.45,.72,.53).normalize().transformDirection(camera.matrixWorldInverse);cu.uInvView.value.copy(camera.matrixWorld);
    cu.uLamp.value.copy(uniforms.uLamp.value);cu.uFocus.value.copy(uniforms.uFocus.value);cu.uFocusR.value=uniforms.uFocusR.value;
    cu.uPxW.value=2*cu.uTanH.value/(innerHeight*RS);
    // clear rtMain explicitly before the clay resolve, so no intensity from the previous frame can survive
    renderer.setRenderTarget(rtMain);renderer.setClearColor(bg,1);renderer.clear();
    pass(clayM,rtMain);
  }else{renderer.setRenderTarget(rtMain);renderer.setClearColor(bg,1);renderer.clear();}
  renderer.setRenderTarget(rtMain);renderer.render(scene,camera);
  let base=rtMain;
  if(clay&&dofOn){ // depth of field, focused on what the camera looks at
    const du=dofBlurM.uniforms;du.uF.value=uniforms.uFocusDist.value;du.uAp.value=dofAmt*DOFS*Math.min(innerWidth,innerHeight)*RS*(small?.0075:.0095);du.uMax.value=(small?7:9)*RS*Math.min(1,DOFS*1.6);   // sized to the short side, so portrait phones blur like desktops
    pass(dofBlurM,rtDofH);pass(dofMixM,rtDof);base=rtDof;
  }
  pass(scrimM,base);
  renderer.render(tScene,tCam);
  compM.uniforms.tS.value=base.texture;
  brightM.uniforms.tD.value=base.texture;pass(brightM,rtA);
  godM.uniforms.tD.value=rtA.texture;pass(godM,rtGod);   // god-rays streak the same bright-pass buffer toward the key light
  const q=blurM.userData.q,e=blurM.userData.e;
  blurM.uniforms.tD.value=rtA.texture;blurM.uniforms.uDir.value.set(q[0],0);pass(blurM,rtB);
  blurM.uniforms.tD.value=rtB.texture;blurM.uniforms.uDir.value.set(0,q[1]);pass(blurM,rtA);
  blurM.uniforms.tD.value=rtA.texture;blurM.uniforms.uDir.value.set(e[0]*1.5,0);pass(blurM,rtD);
  blurM.uniforms.tD.value=rtD.texture;blurM.uniforms.uDir.value.set(0,e[1]*1.5);pass(blurM,rtC);
  blurM.uniforms.tD.value=rtC.texture;blurM.uniforms.uDir.value.set(e[0]*3,0);pass(blurM,rtD);
  blurM.uniforms.tD.value=rtD.texture;blurM.uniforms.uDir.value.set(0,e[1]*3);pass(blurM,rtC);
  compM.uniforms.uTime.value=t;
  pass(compM,null);

  // adaptive quality: if frames run slow, render fewer pixels and thin the cloud
  if(t>5){fAcc+=dt;fN++;if(fN>=90){if(fAcc/fN>1/40&&quality<3){quality++;sizeAll();
    geo.setDrawRange(0,Math.floor(N*[1,.85,.72,.6][quality]));}fAcc=0;fN=0;}}
  requestAnimationFrame(tick);
}
if(S.onReady)S.onReady({
  THREE,renderer,scene,camera,uniforms,hooks,
  shots:SHOTS,scenes:SC,
  shot:()=>curShot,
  sceneOf:i=>SHOTS[Math.max(0,Math.min(NC-1,i))].scene,
  sceneData:id=>finish(id),          // {pts,nrm,lines,sp} — world-space cloud for this scene
  sceneOffset:id=>SC[id].at,
  sceneScale:id=>SC[id].scale||1,
  slots:()=>slotId.slice(),
  isSmall:small,
  reduced:reduce
});
tick();
}

window.PointStory={H,run};
})();
