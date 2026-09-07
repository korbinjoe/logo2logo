const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require(process.env.SHARP_PATH || 'sharp');
(async () => {
  const dir = path.resolve('outputs/reference-check'); await fs.mkdir(dir,{recursive:true});
  const prompt = 'Change only the black shape in the input image to vivid red. Keep its exact silhouette, position, size and white background unchanged. Do not add text or other shapes.';
  const records=[];
  for(const [name, shape] of [['circle','<circle cx="256" cy="256" r="150"/>'],['cross','<path d="M200 70H312V200H442V312H312V442H200V312H70V200H200Z"/>'],['circle-repeat','<circle cx="256" cy="256" r="150"/>']]) {
    const png=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="white"/>${shape}</svg>`)).png().toBuffer();
    await fs.writeFile(path.join(dir,name+'-input.png'),png);
    console.log('START',name);
    const r=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'x/flux2-klein:latest',prompt,images:[png.toString('base64')],width:512,height:512,options:{seed:12345},stream:true}),signal:AbortSignal.timeout(300000)});
    if(!r.ok) throw new Error(await r.text());
    let buffer='',output;const decoder=new TextDecoder();
    const consume=line=>{if(!line.trim())return;const m=JSON.parse(line);if(m.error)throw new Error(m.error);if(m.image)output=Buffer.from(m.image,'base64');if(m.completed)console.log(name,m.completed,m.total);};
    for await(const chunk of r.body){buffer+=decoder.decode(chunk,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();lines.forEach(consume);}consume(buffer);
    if(!output)throw new Error('No output image');await fs.writeFile(path.join(dir,name+'-output.png'),output);
    const raw=await sharp(output).raw().toBuffer();records.push({name,sha256:crypto.createHash('sha256').update(raw).digest('hex')});
    await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({prompt,seed:12345,records},null,2));console.log(records.at(-1));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
