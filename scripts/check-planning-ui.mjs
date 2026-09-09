// Isolated browser fixture. Uses no GPU; all image outputs live in a unique temp directory.
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'forma-ui-check-'));
const fixture=(await readFile('outputs/cbd62733-c4b4-433d-9df0-0a1f4fb45e49.png')).toString('base64');
let secondAttempts=0;
const constructions=['Two equal-width vertical stems joined by one rising diagonal, with open triangular counters on both sides.','One folded ribbon turns upward at both ends, its overlapping planes suggesting the letter N through alternating thick and thin surfaces.','A single square block is carved by a continuous zigzag white channel revealing an upright N in negative space.'];
const mock=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/api/version')return res.end(JSON.stringify({version:'isolated-ui-fixture'}));
  if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:'qwen3-vl:8b',capabilities:['completion','vision']},{name:'x/flux2-klein:latest'}]}));
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  if(req.url==='/api/generate')return res.end(JSON.stringify({done:true,image:fixture})+'\n');
  if(body.messages.some(message=>message.images))return res.end(JSON.stringify({message:{content:JSON.stringify({observed:'fixture image, not generated for this test',subjectMatches:false,structuralProblem:false,reason:'隔离 UI 测试图，不是实际生成结果。'})}}));
  const input=JSON.parse(body.messages[1].content),index=input.route.includes('close-up')?0:input.route.includes('complete subject')?1:2;
  const spec={brandName:'Nova',name:'UI测试',subject:'letter N',recognitionCue:'Readable N',avoid:'H or M',markType:'lettermark',lettering:'N',rationale:'隔离 UI 测试。',constructionZh:'隔离测试方案，不代表生成质量。',construction:constructions[index],signature:'Open diagonal space',palette:index===1 && ++secondAttempts<=2?'':'Black and white',geometry:'angular'};
  console.log(JSON.stringify({route:index,secondAttempts}));
  res.end(JSON.stringify({message:{content:JSON.stringify(spec)},done_reason:'stop'}));
});
mock.listen(0,'127.0.0.1');await once(mock,'listening');
const child=spawn(process.execPath,['server.ts'],{stdio:'inherit',env:{...process.env,PORT:'0',OLLAMA_URL:`http://127.0.0.1:${mock.address().port}`,OLLAMA_PLANNER:'qwen3-vl:8b',OLLAMA_VISION:'qwen3-vl:8b',LOG_DIR:join(directory,'logs'),OUTPUT_DIR:join(directory,'outputs')}});
console.log(JSON.stringify({temporaryDirectory:directory,childPid:child.pid}));
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;child.kill('SIGTERM');mock.closeAllConnections();mock.close();};
process.on('SIGTERM',stop);process.on('SIGINT',stop);child.on('exit',stop);
