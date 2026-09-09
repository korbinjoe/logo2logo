import test from 'node:test';
import assert from 'node:assert/strict';
import {readPreferences,writePreference} from '../src/lib/preferences.ts';
function memory(value){let data=value;return {getItem:()=>data,setItem:(_,v)=>data=v};}
test('preferences survive a new read while unrelated choices are preserved',()=>{
  const storage=memory(null);
  writePreference('draft',{description:'Mori 森林阅读',referenceId:'notion',referenceFile:'notion.svg',style:'soft'},storage);
  writePreference('gallery',{query:'notion',filter:'单色',visible:216},storage);
  writePreference('selectedPlan','creator',storage);
  const p=readPreferences(storage);assert.equal(p.draft.description,'Mori 森林阅读');assert.equal(p.draft.referenceFile,'notion.svg');assert.equal(p.gallery.visible,216);assert.equal(p.selectedPlan,'creator');
  assert.equal(writePreference('sessionToken','must-not-be-saved',storage),false);
});
test('corrupt, outdated, and malformed preferences recover to valid controls',()=>{
  for(const value of ['null','[]','{broken'])assert.equal(readPreferences(memory(value)).gallery.visible,72);
  const p=readPreferences(memory(JSON.stringify({gallery:{query:99,filter:'invalid',visible:-5},draft:{description:5},selectedPlan:'free-unlimited',themeCategory:'invalid',disclosures:{a:true,b:'open'},workspaces:{'../user':[{id:'x'}],user:[{id:'../../etc',c:{}},{id:'image-id',c:{name:'A'},color:'#ff0000',selected:true}]}})));
  assert.deepEqual(p.gallery,{query:'',filter:'',visible:72});assert.equal(p.selectedPlan,null);assert.equal(p.themeCategory,'all');assert.deepEqual(p.disclosures,{a:true});assert.equal(p.workspaces.user.length,1);assert.equal(p.workspaces.user[0].color,'#ff0000');assert.equal(p.workspaces['../user'],undefined);
});
test('storage denied or exhausted never crashes the studio',()=>{
  const blocked={getItem(){throw new Error('denied');},setItem(){throw new Error('quota');}};
  assert.equal(readPreferences(blocked).gallery.visible,72);assert.equal(writePreference('selectedPlan','creator',blocked),false);
});
