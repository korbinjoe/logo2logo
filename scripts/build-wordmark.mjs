import {writeFile} from 'node:fs/promises';
// Compact standalone wordmark. The orange 2 carries the brand accent;
// the independent module icon remains in the favicon and mobile navigation.
const glyphs={
 L:{w:34,d:'M5 5V34Q5 38 9 38H27'},
 o:{w:35,d:'M16 14H18Q29 14 29 25V27Q29 38 18 38H16Q5 38 5 27V25Q5 14 16 14Z'},
 g:{w:35,d:'M29 16V41Q29 52 18 52H10 M16 14H18Q29 14 29 25V27Q29 38 18 38H16Q5 38 5 27V25Q5 14 16 14Z'},
 '2':{w:38,d:'M5 11C5-3 31-3 31 11C31 18 24 22 17 27L5 38H31'},
 l:{w:17,d:'M7 4V38'}
};
const accent='#f26322',widthScale=0.94,tracking=-1.2;
let x=0;const letters=[...'Logo2logo'].map(c=>{const g=glyphs[c];const p=`<path transform="translate(${x.toFixed(1)} 0)"${c==='2'?` stroke="${accent}"`:''} d="${g.d}"/>`;x+=g.w+tracking;return p;}).join('');
const width=Math.ceil(x*widthScale+6);
for(const [name,color] of [['logo2logo','#242520'],['logo2logo-dark','#f3f5f7']]){
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 64" role="img" aria-label="Logo2logo"><g transform="translate(3 5) scale(${widthScale} 1)" fill="none" stroke="${color}" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round">${letters}</g></svg>`;
 await writeFile(`public/${name}.svg`,svg);
}
