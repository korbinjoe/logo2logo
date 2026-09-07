import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const logoRoot = process.env.LOGOS_DIR || join(homedir(), 'work/logos');
let cache;
export async function gallery() {
  if (cache) return cache;
  const brands = JSON.parse(await readFile(join(logoRoot, 'logos.json'), 'utf8'));
  const indexed = new Set(brands.flatMap(b => b.files));
  for (const file of await readdir(join(logoRoot, 'logos'))) {
    if (!file.endsWith('.svg') || indexed.has(file)) continue;
    const owner = brands.filter(b => file.startsWith(b.shortname + '-')).sort((a,b)=>b.shortname.length-a.shortname.length)[0];
    if (owner) owner.files.push(file);
    else brands.push({ shortname: file.slice(0,-4), name: file.slice(0,-4), files: [file], url: '' });
  }
  const entries = await Promise.all(brands.map(async b => {
    const variants = (await Promise.all(b.files.map(async file => {
    if (!/^[\w.-]+\.svg$/.test(file)) return null;
    try {
      const svg = await readFile(join(logoRoot, 'logos', file), 'utf8');
      const colors = [...new Set((svg.match(/#[0-9a-f]{3,8}\b/gi) || []).map(c => c.toLowerCase()))];
      const gradient = /<(?:linear|radial)Gradient\b/.test(svg);
      const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1]?.split(/[ ,]+/).map(Number);
      const wide = viewBox && viewBox[2] / viewBox[3] > 2;
      const tags = [gradient ? '渐变' : colors.length > 1 ? '多色' : '单色', wide ? '横向标志' : '紧凑图形'];
      return { file, tags, colors: colors.slice(0,6), features: `SVG-derived features: ${gradient ? 'gradient color' : colors.length > 1 ? 'multiple flat colors' : 'monochrome'}, ${wide ? 'wide horizontal composition' : 'compact composition'}. These are structural attributes, not a full visual analysis.` };
    } catch { return null; }
    }))).filter(Boolean);
    if (!variants.length) return null;
    const primary = variants.find(v=>v.file.endsWith('-icon.svg')) || variants[0];
    return { id: b.shortname, name: b.name, url: b.url, ...primary, variants };
  }));
  cache = entries.filter(Boolean); return cache;
}

export async function resolveReference(id, file) {
  const brand = (await gallery()).find(b=>b.id===id);
  if (!brand) return null;
  const variant = brand.variants.find(v=>v.file===(file || brand.file));
  return variant ? { ...brand, ...variant } : null;
}
