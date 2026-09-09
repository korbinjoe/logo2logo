import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReview,reviewImage} from '../lib/visual-review.ts';
test('subject mismatch or structural defects never pass review',()=>{
  const base={observed:'human avatar',subjectMatches:false,structuralProblem:false,reason:'看起来是人形而非鸟。'};
  assert.equal(normalizeReview(base).status,'reject');
  assert.equal(normalizeReview({...base,subjectMatches:true,structuralProblem:true}).status,'reject');
  assert.equal(normalizeReview({...base,subjectMatches:true}).status,'pass');
  assert.throws(()=>normalizeReview({...base,subjectMatches:'true'}));
});
test('missing subject does not fabricate a successful review',async()=>{
  assert.equal((await reviewImage('unused',{},'unused')).status,'unreviewed');
});
test('rabbit ears cannot pass a parrot review just because a beak is present',()=>{
  assert.equal(normalizeReview({observed:'A hooked beak and two long rabbit ears',subjectMatches:true,structuralProblem:false,reason:'parrot-like'},{subject:'parrot'}).status,'reject');
});

test('English visual-review fallbacks and rejection reasons stay English',async()=>{
 const missing=await reviewImage('unused',{},'unused','en');
 assert.equal(missing.status,'unreviewed');assert.doesNotMatch(missing.reason,/\p{Script=Han}/u);
 const rejected=normalizeReview({observed:'human avatar with rabbit ears',subjectMatches:true,structuralProblem:false,reason:'looks fine'},{subject:'parrot'},'en');
 assert.equal(rejected.status,'reject');assert.match(rejected.reason,/Discard this draft/);
});
