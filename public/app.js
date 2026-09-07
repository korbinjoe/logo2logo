const $ = s => document.querySelector(s);
let busy = false;
let selectedReference = null;
let logos = [];
let visibleCount = 48;
let planState=null;
const planningRetry=document.createElement('button');planningRetry.type='button';planningRetry.className='text-button';planningRetry.textContent='仅重试失败方向';planningRetry.hidden=true;
$('#message').after(planningRetry);
function errorText(data){return `${data.error || '请求失败'}${data.requestId?`（请求编号 ${data.requestId}）`:''}`;}
function reportBrowserError(error){fetch('/api/client-errors',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:String(error?.message || error).slice(0,2000),stack:String(error?.stack || '').slice(0,4000)}),keepalive:true}).catch(()=>{});}
window.addEventListener('error',event=>reportBrowserError(event.error || event.message));
window.addEventListener('unhandledrejection',event=>reportBrowserError(event.reason));
const editorStatus = document.createElement('p'); editorStatus.setAttribute('role', 'status');
document.querySelector('main').prepend(editorStatus);
async function updateEditorStatus() {
  const state = await fetch('/api/editor-status').then(r=>r.json()).catch(()=>({state:'unavailable'}));
  editorStatus.textContent = ({downloading:'参考图编辑引擎正在下载，普通生成仍可使用。',verifying:'参考图编辑引擎正在运行图像对照验证。',ready:'本地引擎已就绪：借鉴参考风格探索新主体，选中草案后再图片微调。',failed:'参考图编辑验证失败，尚未启用。',blocked:'参考图编辑下载未完成，尚未启用。'})[state.state] || '';
}
updateEditorStatus();setInterval(updateEditorStatus,30000);
const plaza = document.createElement('section');
plaza.className = 'plaza';
plaza.innerHTML = '<p class="eyebrow">FIND YOUR DIRECTION</p><h2>先选一个，找到你的感觉。</h2><p>真实品牌参考 · 选择喜欢的构成，再为你的品牌探索新图形。</p><div class="gallery-tools"><input id="logoSearch" type="search" placeholder="搜索品牌，例如 Linear、Figma、Slack" aria-label="搜索品牌"><select id="logoFilter" aria-label="筛选标志"><option value="">全部风格</option>单色</option><option>多色</option><option>渐变</option><option>紧凑图形</option><option>横向标志</option></select></div><p id="galleryStatus" role="status">正在读取本地 Logo 库…</p><div id="logoGrid" class="logo-grid"></div><button id="loadMore" type="button" class="text-button">显示更多 ↓</button><p class="attribution">参考素材来自 SVG Logos，各标志归所属品牌所有。分类由 SVG 结构自动提取。</p>';
document.querySelector('.hero').replaceWith(plaza);
const selection = document.createElement('div'); selection.id = 'referenceSelection'; selection.className = 'reference-selection';
$('#briefForm').prepend(selection);
function showLogos() {
  const query = $('#logoSearch').value.trim().toLowerCase(); const filter = $('#logoFilter').value;
  const matches = logos.filter(l => (l.name.toLowerCase().includes(query) || l.id.includes(query) || l.variants.some(v=>v.file.toLowerCase().includes(query))) && (!filter || l.variants.some(v=>v.tags.includes(filter))));
  $('#galleryStatus').textContent = `${matches.length} 个品牌${selectedReference ? ' · 已选 ' + selectedReference.name : ' · 点击选择参考'}`;
  $('#logoGrid').replaceChildren();
  for (const logo of matches.slice(0,visibleCount)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'logo-tile'; button.disabled = busy;
    button.setAttribute('aria-pressed', String(selectedReference?.id === logo.id));
    const img = document.createElement('img'); img.src = '/reference/' + encodeURIComponent(logo.file); img.alt = logo.name; img.loading = 'lazy';
    const name = document.createElement('strong'); name.textContent = logo.name;
    const tags = document.createElement('small'); tags.textContent = `${logo.tags.join(' · ')} · ${logo.variants.length} 个版本`;
    button.append(img,name,tags); button.onclick = () => { if(!busy)showVariants(logo); };
    $('#logoGrid').append(button);
  }
  $('#loadMore').hidden = matches.length <= visibleCount;
}
const variantDialog = document.createElement('dialog'); variantDialog.className='variant-dialog'; document.body.append(variantDialog);
function showVariants(logo) {
  variantDialog.replaceChildren();
  const close=document.createElement('button');close.textContent='关闭 ×';close.type='button';close.className='text-button';close.onclick=()=>variantDialog.close();
  const title=document.createElement('h2');title.textContent=`${logo.name} · 选择参考版本`;title.id='variantTitle';variantDialog.setAttribute('aria-labelledby',title.id);
  const grid=document.createElement('div');grid.className='variant-grid';
  for(const v of logo.variants){
    const button=document.createElement('button');button.type='button';button.className='logo-tile';button.setAttribute('aria-pressed',String(selectedReference?.id===logo.id&&selectedReference?.file===v.file));
    const image=document.createElement('img');image.src='/reference/'+encodeURIComponent(v.file);image.alt=v.file;
    const label=document.createElement('strong');label.textContent=v.file;
    const meta=document.createElement('small');meta.textContent=v.tags.join(' · ');
    button.append(image,label,meta);button.onclick=()=>{if(busy)return;selectedReference={...logo,...v};variantDialog.close();showSelection();showLogos();$('#briefForm').scrollIntoView({behavior:'smooth',block:'center'});};grid.append(button);
  }
  variantDialog.append(close,title,grid);variantDialog.showModal();
}
function showSelection() {
  selection.replaceChildren(); if (!selectedReference) return;
  const image = document.createElement('img'); image.src='/reference/'+encodeURIComponent(selectedReference.file); image.alt=selectedReference.name;
  const text=document.createElement('span'); text.textContent=`参考 ${selectedReference.name} · ${selectedReference.file} · ${selectedReference.tags.join(' / ')}`;
  const link=document.createElement('a'); if(/^https?:\/\//.test(selectedReference.url))link.href=selectedReference.url;link.textContent='品牌来源 ↗';link.target='_blank';link.rel='noopener noreferrer';
  const clear=document.createElement('button');clear.type='button';clear.textContent='取消选择';clear.onclick=()=>{if(busy)return;selectedReference=null;showSelection();showLogos();};selection.append(image,text,link,clear);
}
$('#logoSearch').oninput=$('#logoFilter').onchange=()=>{visibleCount=48;showLogos();};
$('#loadMore').onclick=()=>{visibleCount+=48;showLogos();};
fetch('/api/logos').then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);logos=d.logos;const featured=['linear','figma','slack','notion','vercel','airbnb','stripe','dropbox','github','discord','replit','claude'];logos.sort((a,b)=>{const ai=featured.indexOf(a.id),bi=featured.indexOf(b.id);return (ai<0?999:ai)-(bi<0?999:bi)||a.name.localeCompare(b.name);});showLogos();}).catch(e=>{$('#galleryStatus').textContent='Logo 库读取失败：'+e.message;$('#loadMore').hidden=true;});
function lock(v) { busy = v; document.querySelectorAll('button').forEach(b => b.disabled = v); }
$('#briefForm').onsubmit = e => {e.preventDefault();void runPlanning(false);};
planningRetry.onclick=()=>runPlanning(true);
async function runPlanning(resume) {
  if (busy) return;
  const input={description:$('#description').value,style:$('[name=style]:checked').value,referenceId:selectedReference?.id,referenceFile:selectedReference?.file};
  if(resume && JSON.stringify(input)!==JSON.stringify(planState?.input)){$('#message').textContent='描述或参考图已改变，请重新点击生成，开始新的设计。';return;}
  if(!resume){planState={input,rendered:new Set()};$('#conceptGrid').replaceChildren();planningRetry.hidden=true;}
  lock(true);$('#message').textContent=resume?'仅重新规划失败方向，已成功的草案保持不变…':'正在探索三个不同方向，检查主体辨识特征…';
  try {
    const r = await fetch('/api/territories', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({...input,...(resume?{resumeId:planState.resumeId}:{})}) });
    const p = await r.json();if(!r.ok){if(['PLAN_EXPIRED','PLANNER_CHANGED'].includes(p.code))planningRetry.hidden=true;throw new Error(errorText(p));}
    planState.resumeId=p.resumeId;
    $('#summary').textContent = `${p.summary || p.name} · 规划模型：${p.plannerModel}`;$('#board').classList.remove('hidden');$('#board').scrollIntoView({behavior:'smooth'});
    const failures=(p.failures || []).map(f=>`「${f.name}」${f.message} [${f.code}${f.field?'/'+f.field:''}]`).join('；');
    if(failures)$('#message').textContent=`${failures} 正在绘制已通过的方向…`;
    for(const c of p.territories)if(!planState.rendered.has(c.id)){planState.rendered.add(c.id);await generate(c);}
    planningRetry.hidden=p.status!=='partial';
    $('#message').textContent=failures?`${failures} 已保留成功方案，可仅重试失败方向。（请求编号 ${p.requestId}）`:'先看主体是否正确，再比较轮廓。视觉初筛不代表审美认证；淘汰不合格草案，选中后才微调。';
  } catch(e) { $('#message').textContent = e.message; } finally { lock(false); }
}
async function generate(c) {
  const card = document.createElement('article'); card.className = 'concept-card';
  const title = document.createElement('h3'); title.textContent = c.name;
  const explanation = document.createElement('p'); explanation.textContent = c.thesis;
  const area = document.createElement('div'); area.className = 'canvas'; area.textContent = '正在绘制…';
  card.append(area,title,explanation); $('#conceptGrid').append(card);
  if(c.designSpec){const details=document.createElement('details');details.className='design-details';const summary=document.createElement('summary');summary.textContent='查看设计依据';const description=document.createElement('p');description.textContent=c.designSpec.constructionZh;const variation=document.createElement('p');variation.textContent=c.phase==='refine'?'基于选中图片微调，保留原稿。':'独立探索方向；先判断主体与轮廓，不是同一构型的重复微调。';details.append(summary,description,variation);card.append(details);}
  try {
    const r = await fetch('/api/generate', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:c.prompt,seed:c.seed,sourceId:c.sourceId,referenceId:c.referenceId,referenceFile:c.referenceFile,promptVersion:c.promptVersion,designSpec:c.designSpec,variation:c.variation})});
    if (!r.ok) throw new Error(errorText(await r.json()));
    const reader = r.body.getReader(), decoder = new TextDecoder(); let buffer = '', url, outputId, review;
    function consume(line) { if (!line.trim()) return; const m = JSON.parse(line); if (m.error) throw new Error(errorText({...m,requestId:m.requestId || r.headers.get('x-request-id')})); if(m.total) area.textContent = `正在绘制 ${Math.round((m.completed || 0)/m.total*100)}%`; if(m.stage==='reviewing')area.textContent='正在检查实际图像中的主体与结构…'; if(m.imageUrl){url=m.imageUrl;outputId=m.id;review=m.review;} }
    while(true) { const {value,done}=await reader.read(); buffer+=decoder.decode(value,{stream:!done}); const lines=buffer.split('\n'); buffer=lines.pop(); lines.forEach(consume); if(done) {consume(buffer);break;} }
    if(!url) throw new Error('没有返回图片，请重试。');
    const image=new Image(); image.src=url; await image.decode();
    const canvas=document.createElement('canvas'); canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const original=ctx.getImageData(0,0,canvas.width,canvas.height);area.replaceChildren(canvas);
    const verdict=document.createElement('p');verdict.className='visual-review';verdict.setAttribute('role','status');
    verdict.textContent=({pass:'主体初筛通过（非审美认证）',reject:'初筛建议淘汰',unreviewed:'未完成视觉检查'})[review?.status] || '未完成视觉检查';
    card.append(verdict);
    if(review?.reason){const evidence=document.createElement('details');evidence.className='design-details';const label=document.createElement('summary');label.textContent='查看初筛依据';const reason=document.createElement('p');reason.textContent=review.reason;evidence.append(label,reason);card.append(evidence);}
    function colorize(hex) {const rgb=hex.match(/\w\w/g).map(v=>parseInt(v,16));const pixels=new ImageData(new Uint8ClampedArray(original.data),canvas.width,canvas.height);for(let i=0;i<pixels.data.length;i+=4){const dark=(original.data[i]+original.data[i+1]+original.data[i+2])/3<170;for(let j=0;j<3;j++) pixels.data[i+j]=dark?rgb[j]:255;}ctx.putImageData(pixels,0,0);}
    const tests=document.createElement('div');tests.className='versions';
    for(const size of [16,32,64]){const small=document.createElement('canvas');small.width=size;small.height=size;small.getContext('2d').drawImage(canvas,0,0,size,size);const label=document.createElement('span');label.textContent=size===64?'反白':`${size}px`;if(size===64)small.style.filter='invert(1)';label.append(small);tests.append(label);}card.append(tests);
    const actions=document.createElement('div');actions.className='actions';const color=document.createElement('input');color.type='color';color.value='#111111';color.title='调整颜色';color.oninput=()=>colorize(color.value);actions.append(color);
    function button(text,fn){const b=document.createElement('button');b.textContent=text;b.onclick=fn;actions.append(b);}
    button('下载 PNG',()=>{const a=document.createElement('a');a.href=canvas.toDataURL();a.download='forma-logo.png';a.click();});
    button('恢复原图',()=>ctx.putImageData(original,0,0));
    button('淘汰此稿',()=>{if(busy)return;card.hidden=true;});
    button('重做此方向',async()=>{if(busy)return;lock(true);try{await generate({...c,seed:c.seed+1});}finally{lock(false);}});
    if(review?.status==='pass')for(const [label,instruction] of [['选中 · 优化留白','Slightly open the internal negative spaces without changing the outer silhouette.'],['选中 · 调整比例','Make the mark slightly more compact horizontally, keeping its recognizable anatomy and topology.']])button(label,async()=>{if(busy)return;lock(true);try{await generate({...c,name:label.replace('选中 · ',''),phase:'refine',sourceId:outputId,referenceId:undefined,referenceFile:undefined,variation:instruction,prompt:`Edit the supplied selected logo, do not redesign it. ${instruction} Preserve its subject (${c.designSpec?.subject || 'the original symbol'}), recognition features (${c.designSpec?.recognitionCue || 'original silhouette'}), colors and lettering. Single flat mark on a plain white background. No new decorative elements.`});}finally{lock(false);}});
    const note=document.createElement('small');note.textContent=review?.status!=='pass'?'尚未通过主体初筛，不进入微调；可重做或下载草稿自行检查。':'选中后以这张实际图片为输入微调，不再从品牌参考图重抽。';actions.append(note);card.append(actions);
  }catch(e){area.textContent=e.message;const retry=document.createElement('button');retry.textContent='重试此方案';retry.onclick=async()=>{if(busy)return;lock(true);await generate(c);lock(false);};card.append(retry);}
}
