// Match CPython's ties-to-even rounding of the exact IEEE-754 operand.
const roundBits=new DataView(new ArrayBuffer(8));
export function pythonRound(value,digits){
  if(!Number.isFinite(value)||!Number.isInteger(digits)||digits<0||digits>9)throw Error('Invalid Hydro precision');
  if(value===0)return value;
  roundBits.setFloat64(0,Math.abs(value),false);
  const bits=roundBits.getBigUint64(0,false),exponent=Number((bits>>52n)&0x7ffn),fraction=bits&((1n<<52n)-1n);
  const significand=exponent===0?fraction:(1n<<52n)|fraction,shift=(exponent===0?-1022:exponent-1023)-52;
  let numerator=significand*10n**BigInt(digits),denominator=1n;
  if(shift>=0)numerator<<=BigInt(shift);else denominator<<=BigInt(-shift);
  let quotient=numerator/denominator;const twice=(numerator%denominator)*2n;
  if(twice>denominator||(twice===denominator&&quotient%2n===1n))quotient++;
  const rounded=Number(quotient)/10**digits;return value<0?-rounded:rounded;
}
