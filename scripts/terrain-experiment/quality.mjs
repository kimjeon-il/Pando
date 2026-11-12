// Experiment-only numeric policy. Source arrays remain unchanged.
export const HEIGHT_STOPS = Object.freeze([0,256,750,1500,2500,3500,4500,6500]);
export const LIGHT_LAND = Object.freeze(['#70CFA3','#9BDE91','#C3DF8C','#E6D89A',
  '#F1C6A1','#DEB09C','#C5A9A3','#F4F1EB']);

export function roundHalfEven(value) {
  if (!Number.isFinite(value)) throw new RangeError('Finite value required');
  const lower=Math.floor(value),fraction=value-lower;
  return fraction>0.5 || (fraction===0.5 && lower%2!==0) ? lower+1 : lower;
}

export function quantizationStep(value, policy='Q1') {
  if (!Number.isFinite(value)) throw new RangeError('Finite elevation required');
  if (!['Q1','Q2','Q3'].includes(policy)) throw new RangeError('Unknown quantization policy');
  const magnitude=Math.abs(value);
  if (value<0) return magnitude<256?16:magnitude<1024?64:128;
  if (policy==='Q1') return magnitude<512?4:magnitude<2560?8:16;
  if (policy==='Q2') return magnitude<512?8:16;
  return magnitude<512?4:8;
}

export function quantizeHeight(value, policy='Q1') {
  const step=quantizationStep(value,policy), result=roundHalfEven(Math.abs(value)/step)*step;
  return value<0 && result!==0 ? -result : result;
}

function endpoint(h0,h1,d0,d1) {
  let value=((2*h0+h1)*d0-h0*d1)/(h0+h1);
  if (Math.sign(value)!==Math.sign(d0)) return 0;
  if (Math.sign(d0)!==Math.sign(d1) && Math.abs(value)>3*Math.abs(d0)) value=3*d0;
  return value;
}

// Fritsch-Carlson/PCHIP slopes per sRGB channel, with endpoint clamping.
export function createPchip(stops, values) {
  if (!Array.isArray(stops)||!Array.isArray(values)||stops.length<2||stops.length!==values.length
      ||stops.some((x,i)=>!Number.isFinite(x)||(i>0&&x<=stops[i-1]))||values.some(x=>!Number.isFinite(x)))
    throw new TypeError('PCHIP requires finite ordered stops and matching values');
  const h=stops.slice(1).map((x,i)=>x-stops[i]);
  const d=h.map((width,i)=>(values[i+1]-values[i])/width),m=new Array(stops.length);
  if(d.length===1)m[0]=m[1]=d[0];
  else {
    m[0]=endpoint(h[0],h[1],d[0],d[1]);
    m[m.length-1]=endpoint(h.at(-1),h.at(-2),d.at(-1),d.at(-2));
    for(let i=1;i<m.length-1;i++){
      if(d[i-1]===0||d[i]===0||Math.sign(d[i-1])!==Math.sign(d[i]))m[i]=0;
      else {const a=2*h[i]+h[i-1],b=h[i]+2*h[i-1];m[i]=(a+b)/(a/d[i-1]+b/d[i]);}
    }
  }
  return x=>{
    if(!Number.isFinite(x))throw new RangeError('Finite PCHIP input required');
    if(x<=stops[0])return values[0];if(x>=stops.at(-1))return values.at(-1);
    let i=0;while(x>stops[i+1])i++;
    const t=(x-stops[i])/h[i],t2=t*t,t3=t2*t;
    return (2*t3-3*t2+1)*values[i]+(t3-2*t2+t)*h[i]*m[i]
      +(-2*t3+3*t2)*values[i+1]+(t3-t2)*h[i]*m[i+1];
  };
}

export function createLandPalette(colors=LIGHT_LAND) {
  if(!Array.isArray(colors)||colors.length!==HEIGHT_STOPS.length||colors.some(value=>!/^#[0-9a-f]{6}$/i.test(value)))
    throw new TypeError('Eight RGB palette colors required');
  const curves=[1,3,5].map(offset=>createPchip(HEIGHT_STOPS,colors.map(color=>parseInt(color.slice(offset,offset+2),16))));
  return height=>curves.map(curve=>curve(height));
}
