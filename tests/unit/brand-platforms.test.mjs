import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';

const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root));
const text=path=>read(path).toString('utf8');
const native='apps/editor/src-tauri/';
const source=`${native}android/app/src/main/`;
const paths=svg=>[...svg.matchAll(/(?:\bd|android:pathData)="([^"]+)"/g)].map(m=>m[1]);

// Decode the actual committed RGBA pixels, not just the PNG/ICO header or its hash.
function rgbaPng(bytes){
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  let width,height,ended=false;const chunks=[];
  for(let at=8;at+12<=bytes.length;){
    const length=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8);
    assert.ok(at+12+length<=bytes.length);
    const data=bytes.subarray(at+8,at+8+length);at+=12+length;
    if(type==='IHDR'){
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      assert.equal(data[8],8);assert.equal(data[9],6);assert.equal(data[12],0);
    }
    if(type==='IDAT')chunks.push(data);
    if(type==='IEND'){ended=true;break;}
  }
  assert.ok(ended&&width>0&&height>0);
  const stride=width*4,raw=inflateSync(Buffer.concat(chunks)),pixels=Buffer.alloc(stride*height);
  assert.equal(raw.length,(stride+1)*height);
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];assert.ok(filter<=4);
    for(let x=0;x<stride;x++){
      const i=y*stride+x,a=x>=4?pixels[i-4]:0,b=y?pixels[i-stride]:0,c=y&&x>=4?pixels[i-stride-4]:0;
      const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
      const predictor=[0,a,b,Math.floor((a+b)/2),pa<=pb&&pa<=pc?a:pb<=pc?b:c][filter];
      pixels[i]=(raw[y*(stride+1)+1+x]+predictor)&255;
    }
  }
  return {width,height,pixels};
}
function icoFrames(bytes){
  assert.equal(bytes.readUInt16LE(0),0);assert.equal(bytes.readUInt16LE(2),1);
  return Array.from({length:bytes.readUInt16LE(4)},(_,i)=>{
    const at=6+16*i,offset=bytes.readUInt32LE(at+12),length=bytes.readUInt32LE(at+8);
    const frame=rgbaPng(bytes.subarray(offset,offset+length));
    assert.equal(frame.width,bytes[at]||256);assert.equal(frame.height,bytes[at+1]||256);
    return frame;
  });
}
function componentCount({width,height,pixels},threshold){
  const seen=new Uint8Array(width*height);let count=0;
  for(let first=0;first<seen.length;first++){
    if(seen[first]||pixels[first*4+3]<threshold)continue;
    count++;seen[first]=1;const stack=[first];
    while(stack.length){
      const i=stack.pop(),x=i%width,y=Math.floor(i/width);
      for(const j of [x?i-1:-1,x<width-1?i+1:-1,y?i-width:-1,y<height-1?i+width:-1]){
        if(j<0||seen[j]||pixels[j*4+3]<threshold)continue;
        seen[j]=1;stack.push(j);
      }
    }
  }
  return count;
}
function checkWindows(frame){
  const {width:n,height,pixels}=frame;assert.equal(n,height);
  const alpha=(x,y)=>pixels[(y*n+x)*4+3];let occupied=0,opaque=0;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const i=(y*n+x)*4,a=pixels[i+3];
    if(a)occupied++;
    if(a===255){opaque++;assert.deepEqual([...pixels.subarray(i,i+3)],[49,94,219]);}
    if(x===0||y===0||x===n-1||y===n-1)assert.equal(a,0);
  }
  assert.ok(opaque>n*n*.30);
  assert.ok(occupied<n*n*.65,'Windows must not contain a filled background plate');
  for(const [u,v]of [[.5,.5],[.08,.5],[.92,.5],[21/48,.3],[27/48,.7]]){
    assert.equal(alpha(Math.floor(u*n),Math.floor(v*n)),0,`${n}px transparent margin/channel`);
  }
  for(const threshold of [32,128,224])assert.equal(componentCount(frame,threshold),2,`${n}px at alpha ${threshold}`);
}

test('Windows PNG and every ICO frame are cobalt glyphs with transparent margins and channel',()=>{
  const frames=icoFrames(read(`${native}icons/icon.ico`));
  assert.deepEqual(frames.map(x=>x.width),[16,24,32,48,64,128,256]);
  for(const frame of frames)checkWindows(frame);
  const png=rgbaPng(read(`${native}icons/icon.png`));checkWindows(png);
  assert.deepEqual(png,frames.at(-1));
  const micro=frames[0],alpha=(x,y)=>micro.pixels[(y*16+x)*4+3];
  for(const x of [6,7])assert.equal(alpha(x,5),0);
  for(const x of [8,9])assert.equal(alpha(x,10),0);
});

test('Windows source changes paint only, preserving approved normal and optical-small paths',()=>{
  for(const small of [false,true]){
    const name=small?'symbol-small-black.svg':'symbol-black.svg';
    const win=text(`design/brand/windows${small?'-small':''}.svg`);
    assert.deepEqual(paths(win),paths(text(`design/brand/${name}`)));
    assert.match(win,/viewBox="0 0 48 48"/);assert.match(win,/fill="#315EDB"/);
    assert.doesNotMatch(win,/<(?:rect|circle|ellipse|image|filter|mask|clipPath|linearGradient)\b|transform=/);
  }
});

test('Android keeps full-bleed system-shaped background and glyph-only foreground/monochrome',()=>{
  const normal=paths(text('design/brand/symbol-black.svg'));
  assert.match(text(source+'res/values/pando_brand.xml'),/<color name="pando_icon_background">#315EDB<\/color>/);
  for(const kind of ['foreground','monochrome']){
    const path=`res/drawable/pando_icon_${kind}.xml`,xml=text(source+path);
    assert.deepEqual(paths(xml),normal);
    assert.equal((xml.match(/<path\b/g)||[]).length,2);
    assert.match(xml,/android:viewportWidth="108"/);assert.match(xml,/android:translateX="22"/);
    assert.doesNotMatch(xml,/<clip-path\b|#315EDB/);
    assert.deepEqual(read(source+path),read(`${native}gen/android/app/src/main/${path}`));
  }
  for(const api of [26,33])for(const name of ['pando_launcher','pando_launcher_round']){
    const path=`res/mipmap-anydpi-v${api}/${name}.xml`,xml=text(source+path);
    assert.match(xml,/<background android:drawable="@color\/pando_icon_background"/);
    assert.match(xml,/<foreground android:drawable="@drawable\/pando_icon_foreground"/);
    if(api===33)assert.match(xml,/<monochrome android:drawable="@drawable\/pando_icon_monochrome"/);
    assert.deepEqual(read(source+path),read(`${native}gen/android/app/src/main/${path}`));
  }
});

test('web uses a white plate and cobalt optical-small glyph while Windows keeps transparency',()=>{
  const svg=text('shared/frontend/static/brand/favicon.svg');
  assert.match(svg,/<rect\b[^>]*fill="#FFFFFF"/);
  assert.equal((svg.match(/<path\b[^>]*fill="#315EDB"/g)||[]).length,2);
  assert.deepEqual(paths(svg),paths(text('design/brand/windows-small.svg')));
  for(const frame of icoFrames(read('shared/frontend/static/brand/favicon.ico'))){
    const sample=(x,y)=>[...frame.pixels.subarray((y*frame.width+x)*4,(y*frame.width+x)*4+4)];
    assert.deepEqual(sample(Math.floor(frame.width/2),Math.floor(frame.height/2)),[255,255,255,255]);
    assert.deepEqual(sample(Math.floor(frame.width/4),Math.floor(frame.height/4)),[49,94,219,255]);
    assert.equal(sample(0,0)[3],0);
  }
});
