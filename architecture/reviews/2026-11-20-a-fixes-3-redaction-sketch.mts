// Prototype of A-fixes-3's redaction (M1, M2, M3), for the ruling only.
const ASSIGNMENT = /(?<![A-Za-z0-9])(?:password|passwd|secret|api[_-]?key)(?!_detected\b)(?:_[A-Za-z0-9]{1,32}){0,4}\s*[:=]\s*["']?/;
const VALUE = /[^\s"'\\]{8,}/;
const BLOCKS = {
  private_key: { begin: /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/i, end: /-----END [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/i },
  putty_key: { begin: /PuTTY-User-Key-File-\d{1,2}:/, end: /Private-MAC:[ \t]*[0-9a-f]{1,128}/i },
};
const TOKENS = [/\bsk-ant-[A-Za-z0-9_-]{20,}/, /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/, /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/, /\bxox[abposr]-[A-Za-z0-9-]{10,}/, /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/];
export function findSecret(t: string) { return [...Object.values(BLOCKS).map(b=>b.begin), ...TOKENS, new RegExp(ASSIGNMENT.source+VALUE.source,"i")].some(r=>r.test(t)) ? "x" : null; }
type S=[number,number];
const all=(t:string,re:RegExp)=>Array.from(t.matchAll(new RegExp(re.source, re.flags.replace("g","")+"g")), m=>[m.index!, m.index!+m[0].length] as S);
const merge=(sp:S[])=>{sp.sort((a,b)=>a[0]-b[0]);const o:S[]=[];for(const [s,e] of sp){const l=o.at(-1);if(l&&s<=l[1])l[1]=Math.max(l[1],e);else o.push([s,e]);}return o;};
const apply=(t:string,sp:S[],mark:string)=>{let k="",at=0;for(const [s,e] of merge(sp)){k+=t.slice(at,s)+mark;at=e;}return k+t.slice(at);};
// M2: each BEGIN through the first END of its kind after it; none after: its own line.
function blockSpans(t:string,b:{begin:RegExp;end:RegExp}):S[]{const B=all(t,b.begin),E=all(t,b.end);const sp:S[]=[];let e=0;
  for(const [s,be] of B){while(e<E.length&&E[e]![0]<be)e++; if(e<E.length) sp.push([s,E[e]![1]]); else {const m=/[\r\n]/g;m.lastIndex=s;sp.push([s,m.exec(t)?.index??t.length]);}}
  return sp;}
// M1: every span on the original text, unioned, replaced once. A prefix's value is the run of value characters
// from its end; it redacts [keyword, run end] when the run is 8+, or when the run reaches another span (through it).
function assignmentSpans(t:string,other:S[]):S[]{
  const runs=all(t,/[^\s"'\\]+/);
  const pre=all(t,new RegExp(ASSIGNMENT.source,"i"));
  const ends:number[]=[];let r=0;for(const [,q] of pre){while(r<runs.length&&runs[r]![1]<=q)r++;ends.push(r<runs.length&&runs[r]![0]<=q?runs[r]![1]:q);}
  const out:S[]=[];let oi=other.length-1;let next:S|null=null;
  for(let i=pre.length-1;i>=0;i--){const [p,q]=pre[i]!;const end=ends[i]!;
    while(oi>=0&&other[oi]![1]>q){ if(!next||other[oi]![0]<next[0]) next=other[oi]!; oi--; }
    const reach = next && next[0]<=Math.max(end,q) && next[1]>q ? next[1] : -1;
    if(end-q>=8||reach>=0){const sp:S=[p,Math.max(end,reach)];out.push(sp);next=sp;}
  }
  return out;}
export function redact(text:string,mark:string){
  const other:S[]=[];for(const b of Object.values(BLOCKS))other.push(...blockSpans(text,b));
  for(const re of TOKENS)other.push(...all(text,re));
  for(let i=text.indexOf(mark);i>=0;i=text.indexOf(mark,i+mark.length))other.push([i,i+mark.length]);
  const m=merge(other);
  return apply(text,[...m,...assignmentSpans(text,m)],mark);}
