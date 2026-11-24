import assert from 'node:assert/strict';
import test from 'node:test';
const { AssetClassifier } = await import('../lib/ai/AssetClassifier.ts');
const cats = ['Audio-Visual','Furniture','IT Equipment','Laboratory Equipment','Office Supplies'];
test('laptop → IT Equipment, Good', () => { const s = AssetClassifier.byRules('HP Laptop','laptop, 16 GB RAM, works well',cats); assert.equal(s.categoryName,'IT Equipment'); assert.equal(s.condition,'Good'); assert.equal(s.source,'rules'); });
test('cracked fume hood → Laboratory, Poor', () => { const s = AssetClassifier.byRules('Fume hood','cracked glass, weak fan',cats); assert.equal(s.categoryName,'Laboratory Equipment'); assert.equal(s.condition,'Poor'); });
test('whole words only: frame ≠ ram', () => { const s = AssetClassifier.byRules('Photo frame','wooden frame',cats); assert.ok(!s.tags.includes('ram')); });
test('unknown text → no category, asks the user', () => { const s = AssetClassifier.byRules('Thing','something',cats); assert.equal(s.categoryName,null); assert.match(s.reason,/choose the fields yourself/); });
test('tags cleaned and max 8', () => { const t = AssetClassifier.cleanTags(['A B','a-b','x','y','z','1','2','3','4','5']); assert.deepEqual(t.slice(0,2),['a-b','x']); assert.equal(t.length,8); });
