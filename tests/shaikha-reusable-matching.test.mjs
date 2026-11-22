import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalItemType, mandatoryItemType, reusableEvidence, MATCHING_CONTRACT, EVIDENCE_SOURCE } from '../app/protected/requests/reusable-evidence.ts';
import { parsePacket, eligibleCandidates, assembleWeightedMatches } from '../app/protected/requests/matching-contract.ts';
import { FACTOR_WEIGHTS, calculateCompatibility } from '../app/protected/requests/scoring.ts';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const rule = value => ({field:'item_type',operator:'eq',value});
const evidence = (type='printer',patch={}) => ({specifications:{item_type:type,duplex:true}, safetyStatus:'clear',
  inspectionRequired:true,inspection:{result:'passed',inspectedOn:'2026-11-01',validUntil:'2026-12-31'},
  earliestReceiptDate:'2026-11-23',...patch});
const candidate = (n=1,type='printer',patch={}) => ({asset_id:id(n),name:`Fictional asset ${n}`,
  description:'Fictional teaching-lab equipment',condition:'Good',available_quantity:2,
  category_id:id(90),is_published:true,asset_state:'Available',evidence:evidence(type),
  evidence_snapshot:{contract:MATCHING_CONTRACT,provider:EVIDENCE_SOURCE,reusable_evidence:evidence(type)},...patch});
const packet = (type='printer',patch={}) => ({contract_version:MATCHING_CONTRACT,evidence_source:EVIDENCE_SOURCE,
  request_id:id(99),specifications:'Fictional equipment request',purpose:'Teaching lab',category_id:id(90),quantity:1,
  preferred_condition:'Good',required_date:'2026-11-24',preferred_location:null,request_status:'Submitted',
  assessment_date:'2026-11-22',base_total:2,candidate_limit:25,mandatory_requirements:[rule(type)],
  preferred_requirements:[],candidates:[candidate()],...patch});
const semantic = n => ({asset_id:id(n),similarity:.8,explanation:'Suitable for the same documented teaching-lab purpose.'});

test('item types normalize case/spacing and screen alias, never names',()=>{
  assert.equal(canonicalItemType(' SCREEN '),'monitor');
  assert.equal(canonicalItemType(' Printer '),'printer');
  for(const value of [null,{},true,42,''])assert.equal(canonicalItemType(value),null);
});
test('exactly one typed mandatory equality rule is needed',()=>{
  assert.equal(mandatoryItemType([rule('screen')]),'monitor');
  for(const rules of [[],[rule('printer'),rule('monitor')],[{...rule('printer'),operator:'gte'}],[rule(1)],[rule('')]])
    assert.throws(()=>mandatoryItemType(rules));
});
test('five-field provider payload is whitelisted and inspection facts are preserved',()=>{
  const actual=reusableEvidence({...evidence('screen'),confidence:1,compatibility_score:100,locationEffortScore:1});
  assert.equal(actual.specifications.item_type,'monitor');
  assert.equal(actual.inspection.result,'passed');
  assert.deepEqual(Object.keys(actual).sort(),['specifications','safetyStatus','inspectionRequired','inspection','earliestReceiptDate'].sort());
});
test('null, incomplete, nested, nonfinite and wrong-type provider facts fail closed',()=>{
  for(const value of [null,{},evidence('printer',{inspectionRequired:null}),evidence('printer',{inspection:undefined}),
    evidence('printer',{safetyStatus:['clear']}),evidence('printer',{earliestReceiptDate:undefined}),
    evidence('printer',{specifications:{item_type:'printer',nested:{x:1}}}),
    evidence('printer',{specifications:{item_type:'printer',watts:Infinity}}),
    evidence('printer',{inspection:{result:'approved',inspectedOn:'2026-11-01',validUntil:'2026-12-31'}})])
    assert.equal(reusableEvidence(value),null,JSON.stringify(value));
});
test('printer requests exclude monitors and include verified printers',()=>{
  const p=packet('printer',{candidates:[candidate(1,'monitor'),candidate(2,'printer')]});
  assert.deepEqual(eligibleCandidates(parsePacket(p)).eligible.map(x=>x.asset_id),[id(2)]);
});
test('monitor requests exclude printers and accept screen-equivalent evidence',()=>{
  const p=packet('monitor',{candidates:[candidate(1,'printer'),candidate(2,'screen')]});
  assert.deepEqual(eligibleCandidates(p).eligible.map(x=>x.asset_id),[id(2)]);
});
test('same verified asset facts serve two independent requests without pair records',()=>{
  const first=packet(); const second=packet('printer',{request_id:id(100)});
  assert.equal(eligibleCandidates(first).eligible.length,1);
  assert.equal(eligibleCandidates(second).eligible.length,1);
  assert.ok(!Object.hasOwn(first.candidates[0].evidence,'request_id'));
});
test('reuse never bypasses the second request mandatory specifications',()=>{
  const p=packet('printer',{mandatory_requirements:[rule('printer'),{field:'duplex',operator:'eq',value:false}]});
  assert.equal(eligibleCandidates(p).eligible.length,0);
});
test('preferred specifications still affect the 35-weight factor',()=>{
  const p=packet('printer',{preferred_requirements:[{field:'duplex',operator:'eq',value:false}]});
  const [match]=assembleWeightedMatches(p,[semantic(1)]);
  assert.equal(match.factor_values.specifications,.5);
});
test('missing item type cannot be guessed from names/descriptions or category',()=>{
  const p=packet('printer',{candidates:[candidate(1,'printer',{name:'Printer',description:'Printer',evidence:evidence('printer',{specifications:{duplex:true}})})]});
  assert.equal(eligibleCandidates(p).eligible.length,0);
});
test('missing provider facts never fall back to an old request-pair record',()=>{
  const p=packet('printer',{candidates:[candidate(1,'printer',{evidence:null,legacy_evidence:evidence('printer')})]});
  assert.equal(eligibleCandidates(p).eligible.length,0);
});
test('untyped, duplicate-type and preferred-only request rules cannot reach ranking',()=>{
  for(const patch of [{mandatory_requirements:[]},{mandatory_requirements:null},
    {mandatory_requirements:[rule('printer'),rule('monitor')]},
    {mandatory_requirements:[],preferred_requirements:[rule('printer')]},
    {preferred_requirements:[rule('monitor')]}])
    assert.equal(eligibleCandidates(packet('printer',patch)).eligible.length,0);
});
test('legacy packet version or evidence-source marker is rejected',()=>{
  assert.throws(()=>parsePacket(packet('printer',{contract_version:'weighted-evidence-v1'})));
  assert.throws(()=>parsePacket(packet('printer',{evidence_source:'request-pair-table'})));
  assert.equal(eligibleCandidates(packet('printer',{contract_version:'weighted-evidence-v1'})).eligible.length,0);
});
test('all basic stock/publication/condition/category restrictions remain',()=>{
  for(const patch of [{is_published:false},{asset_state:'Reserved'},{available_quantity:0},{condition:'Poor'},{category_id:id(91)}])
    assert.equal(eligibleCandidates(packet('printer',{candidates:[candidate(1,'printer',patch)]})).eligible.length,0);
});
test('missing/restricted safety remains ineligible',()=>{
  for(const safetyStatus of ['unknown','restricted',null])
    assert.equal(eligibleCandidates(packet('printer',{candidates:[candidate(1,'printer',{evidence:evidence('printer',{safetyStatus})})]})).eligible.length,0);
});
test('required inspections cannot be missing, failed, expired or future-dated',()=>{
  for(const inspection of [null,{result:'failed',inspectedOn:'2026-11-01',validUntil:'2026-12-31'},
    {result:'passed',inspectedOn:'2026-11-01',validUntil:'2026-11-21'},
    {result:'passed',inspectedOn:'2026-11-23',validUntil:'2026-12-31'},
    {result:'passed',inspectedOn:'2026-11-01',validUntil:'2026-11-23'}])
    assert.equal(eligibleCandidates(packet('printer',{candidates:[candidate(1,'printer',{evidence:evidence('printer',{inspection})})]})).eligible.length,0);
});
test('unknown, invalid or late arrival feasibility cannot satisfy a required date',()=>{
  for(const earliestReceiptDate of [null,'2026-11-25','not-a-date'])
    assert.equal(eligibleCandidates(packet('printer',{candidates:[candidate(1,'printer',{evidence:evidence('printer',{earliestReceiptDate})})]})).eligible.length,0);
});
test('optional arrival date stays optional when request has no deadline',()=>{
  const p=packet('printer',{required_date:null,candidates:[candidate(1,'printer',{evidence:evidence('printer',{earliestReceiptDate:null})})]});
  assert.equal(eligibleCandidates(p).eligible.length,1);
  assert.equal(assembleWeightedMatches(p,[semantic(1)])[0].factor_values.dateUrgency,null);
});
test('shared provider five-field contract does not invent optional ranking factors',()=>{
  const p=packet('printer',{candidates:[candidate(1,'printer',{evidence:{...evidence(),locationEffortScore:1,locationEvidence:'legacy',
    environmentalEffectScore:1,environmentalEvidence:'legacy',estimatedTransferRepairCost:0,costCurrency:'AED',costEvidence:'legacy'}})]});
  const [match]=assembleWeightedMatches(p,[semantic(1)]);
  assert.equal(match.evidence_coverage,80);
  assert.equal(match.factor_values.locationEffort,null);
  assert.equal(match.factor_values.financialEffect,null);
  assert.equal(match.factor_values.environmentalEffect,null);
  assert.equal(match.estimated_transfer_repair_cost,null);
});
test('weights, missing-evidence formula and documented 84.5 example are unchanged',()=>{
  assert.deepEqual(FACTOR_WEIGHTS,{specifications:35,purposeSimilarity:25,condition:10,dateUrgency:10,locationEffort:10,financialEffect:5,environmentalEffect:5});
  const result=calculateCompatibility({assetId:id(1),factors:{specifications:.9,purposeSimilarity:.84,condition:.8,dateUrgency:1,locationEffort:.7,financialEffect:.6,environmentalEffect:.8},aiConfidence:.9,estimatedTransferRepairCost:20});
  assert.equal(result.compatibilityScore,84.5);
});
test('up to five matches still have stable tie ordering, reasons and no invented confidence',()=>{
  const candidates=Array.from({length:7},(_,i)=>candidate(7-i));
  const p=packet('printer',{candidates,base_total:7});
  const ranked=assembleWeightedMatches(p,candidates.map(c=>({asset_id:c.asset_id,similarity:.8,explanation:'Documented intended purpose matches.'})));
  assert.deepEqual(ranked.map(x=>x.asset_id),[1,2,3,4,5].map(id));
  assert.ok(ranked.every(x=>x.confidence===null && x.explanation.length>0));
});

const sql=readFileSync(new URL('../supabase/migrations/20261122200000_shaikha_reusable_matching.sql',import.meta.url),'utf8');
test('SQL source guard: sole asset evidence provider is reusable, never request-pair table',()=>{
  assert.ok(sql.includes('public.shaikha_reusable_evidence(public.renad_reusable_asset_evidence(a.asset_id))'));
  assert.ok(!sql.includes('shaikha_asset_match_evidence'));
  assert.ok(sql.indexOf("where f.evidence#>>'{specifications,item_type}'=requested_type") < sql.indexOf('order by (f.a).asset_id limit 25'));
});
test('SQL source guard: stored item type cannot be removed, preferred or changed on edits',()=>{
  assert.match(sql,/if n=0 and old_type is not null then/);
  assert.match(sql,/old_type is not null and new_type<>old_type/);
  assert.match(sql,/Item type must remain mandatory/);
  assert.match(sql,/Exactly one mandatory item type is required/);
});
test('SQL source guard: save, display and accept still re-read packets and compare snapshots',()=>{
  assert.match(sql,/if packet is distinct from p_packet then raise exception 'Stale packet'/);
  assert.match(sql,/m.evidence_snapshot is distinct from candidate->'evidence_snapshot'/);
  assert.match(sql,/m.evidence_snapshot=c.value->'evidence_snapshot'/);
  assert.match(sql,/order by a.asset_id for share/);
  assert.match(sql,/perform 1 from public.asset where asset_id=m.asset_id for share/);
});
test('SQL source guard: requester ownership, private helpers and server-only writer remain',()=>{
  assert.match(sql,/perform public.shaikha_require_requester\(p_actor_id,p_request_id\)/);
  assert.match(sql,/auth.role\(\) is distinct from 'service_role'/);
  assert.match(sql,/public.shaikha_reusable_evidence\(jsonb\).*public.shaikha_matching_packet/s);
  assert.match(sql,/from public,anon,authenticated,service_role/);
});
test('SQL source guard: no requests, history, C8 notices, stock or trigger mutations',()=>{
  assert.doesNotMatch(sql,/insert\s+into\s+public\.(resource_request|request_status_history|shaikha_notification)\b/i);
  assert.doesNotMatch(sql,/update\s+public\.(resource_request|asset|transfer|reservation)\b/i);
  assert.doesNotMatch(sql,/(create|drop|alter)\s+trigger\b|disable\s+trigger\b/i);
  assert.doesNotMatch(sql,/create or replace function public\.(shaikha_submit_request|renad_submit_typed_request|shaikha_notification_on_submission)/i);
});
