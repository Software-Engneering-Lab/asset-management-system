import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateCompatibility, compareCandidates } from "../app/protected/requests/scoring.ts";
import { checkEligibility, satisfies } from "../app/protected/requests/eligibility.ts";
import { assembleWeightedMatches, eligibleCandidates, parsePacket, parseRequirements } from "../app/protected/requests/matching-contract.ts";

const factors = { specifications: .9, purposeSimilarity: .84, condition: .8, dateUrgency: 1, locationEffort: .7, financialEffect: .6, environmentalEffect: .8 };
const score = (changes={}) => calculateCompatibility({assetId:"a",factors,aiConfidence:.9,estimatedTransferRepairCost:20,...changes});
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
const request = { categoryId:id(90),quantity:2,requiredDate:"2026-11-20",mandatoryRequirements:[{field:"ram_gb",operator:"gte",value:16}] };
const evidence = { safetyStatus:"clear",inspectionRequired:true,inspection:{result:"passed",inspectedOn:"2026-11-10",validUntil:"2026-12-01"},earliestReceiptDate:"2026-11-18",specifications:{ram_gb:16},locationEffortScore:.7,locationEvidence:"Verified route rubric",estimatedTransferRepairCost:20,costCurrency:"AED",costEvidence:"Estimate including transfer and repair",environmentalEffectScore:.8,environmentalEvidence:"Approved impact rubric" };
const assetFacts = {categoryId:id(90),isPublished:true,state:"Available",availableQuantity:2,condition:"Good",...evidence};
const candidate = (n=1,changes={}) => ({asset_id:id(n),name:`Computer ${n}`,description:"Computer suitable for a teaching lab",condition:"Good",available_quantity:2,category_id:id(90),is_published:true,asset_state:"Available",evidence:structuredClone(evidence),evidence_snapshot:{version:n},...changes});
const packet = (changes={}) => ({contract_version:"weighted-evidence-v1",request_id:id(99),specifications:"16 GB RAM",purpose:"Teaching lab",category_id:id(90),quantity:2,preferred_condition:"Good",required_date:"2026-11-20",preferred_location:"Campus",request_status:"Submitted",assessment_date:"2026-11-14",base_total:1,candidate_limit:25,mandatory_requirements:request.mandatoryRequirements,preferred_requirements:[],candidates:[candidate()],...changes});
const semantic = (n=1,similarity=.84) => ({asset_id:id(n),similarity,explanation:"Intended for the same teaching-lab use."});

test("documented weighted example is exactly 84.5 with 100% coverage",()=>{
 const result=score(); assert.equal(result.compatibilityScore,84.5); assert.equal(result.evidenceCoverage,100); assert.equal(result.topPickEligible,true);
});
test("missing optional evidence is excluded, not treated as zero",()=>{
 const result=score({factors:{...factors,financialEffect:null,environmentalEffect:null},aiConfidence:null});
 assert.equal(result.compatibilityScore,86.11);assert.equal(result.evidenceCoverage,90);assert.equal(result.topPickEligible,false);
 assert.deepEqual(result.missingFactors,["financialEffect","environmentalEffect"]);
 assert.notEqual(result.compatibilityScore,score({factors:{...factors,financialEffect:0,environmentalEffect:0}}).compatibilityScore);
});
test("invalid factors, confidence, costs and all-missing evidence are rejected",()=>{
 for(const value of [NaN,Infinity,-.1,1.1,undefined]) assert.throws(()=>score({factors:{...factors,purposeSimilarity:value}}));
 assert.throws(()=>score({aiConfidence:2})); assert.throws(()=>score({estimatedTransferRepairCost:-1}));
 assert.throws(()=>score({factors:Object.fromEntries(Object.keys(factors).map(k=>[k,null]))}));
});
test("incomplete evidence and low compatibility/confidence warn",()=>{
 const result=score({factors:{...factors,specifications:null,purposeSimilarity:.1},aiConfidence:.2});
 assert.equal(result.evidenceCoverage,65); assert.equal(result.topPickEligible,false); assert.equal(result.warnings.length,3);
});
test("ties use known lower transfer/repair cost then stable asset ID",()=>{
 const a=score({assetId:"a",estimatedTransferRepairCost:10}); const b=score({assetId:"b",estimatedTransferRepairCost:10});
 assert.ok(compareCandidates(a,b)<0); assert.ok(compareCandidates(a,score({estimatedTransferRepairCost:20}))<0);
 assert.ok(compareCandidates(a,score({estimatedTransferRepairCost:null}))<0);
});
test("valid verified asset passes all mandatory checks",()=>assert.equal(checkEligibility(request,assetFacts,"2026-11-14").eligible,true));
test("every failed/unknown mandatory gate excludes the asset",()=>{
 for(const changes of [{categoryId:id(91)},{isPublished:false},{state:"Reserved"},{availableQuantity:0},{condition:"Poor"},
 {safetyStatus:"unknown"},{safetyStatus:"restricted"},{inspectionRequired:null},{inspection:null},
 {inspection:{...evidence.inspection,result:"failed"}},{inspection:{...evidence.inspection,inspectedOn:"2026-11-15"}},
 {inspection:{...evidence.inspection,validUntil:"2026-11-19"}},{earliestReceiptDate:null},{earliestReceiptDate:"2026-11-21"},
 {specifications:{}},{specifications:{ram_gb:8}},{specifications:{ram_gb:"16"}}]) {
  assert.equal(checkEligibility(request,{...assetFacts,...changes},"2026-11-14").eligible,false,JSON.stringify(changes));
 }
 assert.equal(checkEligibility({...request,mandatoryRequirements:null},assetFacts,"2026-11-14").eligible,false);
});
test("typed equality is case-insensitive for text, not type-coercing",()=>{
 assert.equal(satisfies(" blue ",{field:"colour",operator:"eq",value:"BLUE"}),true);
 assert.equal(satisfies("16",{field:"ram_gb",operator:"gte",value:16}),false);
});
test("requirement contracts reject malformed fields and values",()=>{
 for(const x of [null,{},[{field:"RAM GB",operator:"gte",value:16}],[{field:"ram_gb",operator:"gte",value:"16"}],
 [{field:"ram_gb",operator:"eq",value:{}}]]) assert.throws(()=>parseRequirements(x));
 assert.deepEqual(parseRequirements([]),[]);
});
test("packet parser rejects legacy and duplicate candidates",()=>{
 assert.equal(parsePacket(packet()).request_id,id(99));
 assert.throws(()=>parsePacket({...packet(),contract_version:"legacy"}));
 assert.throws(()=>parsePacket(packet({candidates:[candidate(),candidate()]})));
});
test("unconfirmed/stale verified evidence cannot reach the model",()=>{
 assert.equal(eligibleCandidates(packet({mandatory_requirements:null})).eligible.length,0);
 for(const changes of [{evidence:null},{evidence:{...evidence,safetyStatus:"unknown"}},
 {evidence:{...evidence,inspectionRequired:null}},{evidence:{...evidence,specifications:{}}}])
 assert.equal(eligibleCandidates(packet({candidates:[candidate(1,changes)]})).eligible.length,0);
});
test("integrated score is derived from factors, never a supplied total/confidence",()=>{
 const [result]=assembleWeightedMatches(packet(),[{...semantic(),compatibility_score:1,confidence:1}]);
 // 35*1 + 25*.84 + 10*1 + 10*1 + 10*.7 + 5*1 + 5*.8 = 92.
 assert.equal(result.compatibility_score,92); assert.equal(result.evidence_coverage,100);
 assert.equal(result.confidence,null); assert.ok(result.warnings.some(x=>x.includes("no top-pick")));
 assert.deepEqual(result.evidence_snapshot,{version:1});
});
test("optional missing specifications omit the 35-weight factor without blocking eligibility",()=>{
 const p=packet({preferred_requirements:[{field:"colour",operator:"eq",value:"blue"}]});
 assert.equal(eligibleCandidates(p).eligible.length,1);
 const [result]=assembleWeightedMatches(p,[semantic()]);assert.equal(result.factor_values.specifications,null);assert.equal(result.evidence_coverage,65);
});
test("only documented AED costs with a source are comparable",()=>{
 const p=packet({candidates:[candidate(1,{evidence:{...evidence,costCurrency:"USD"}})]});
 const [result]=assembleWeightedMatches(p,[semantic()]);assert.equal(result.factor_values.financialEffect,null);assert.equal(result.estimated_transfer_repair_cost,null);
});
test("semantic assessments must cover known eligible candidates exactly once",()=>{
 assert.throws(()=>assembleWeightedMatches(packet(),[]));assert.throws(()=>assembleWeightedMatches(packet(),[semantic(2)]));
 assert.throws(()=>assembleWeightedMatches(packet(),[semantic(),semantic()]));assert.throws(()=>assembleWeightedMatches(packet(),[semantic(1,1.01)]));
});
test("top five only, stable tie ordering and separate weak-semantic warning",()=>{
 const cs=Array.from({length:7},(_,i)=>candidate(7-i));const p=packet({candidates:cs,base_total:7});
 const result=assembleWeightedMatches(p,cs.map(c=>({asset_id:c.asset_id,similarity:.5,explanation:"Partial purpose relevance."})));
 assert.equal(result.length,5); assert.deepEqual(result.map(x=>x.asset_id),[1,2,3,4,5].map(id));
 assert.ok(result[0].warnings.some(x=>x.includes("Weak semantic")));
});
