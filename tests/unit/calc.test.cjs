/* Unit tests for the pure calculation logic (js/calc.js).
 * Run with: npm run test:unit   (uses Node's built-in test runner). */
const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../../js/calc.js');

test('money rounds and formats with thousands separators', () => {
  assert.equal(Calc.money(0), '$0');
  assert.equal(Calc.money(1234.56), '$1,235');
  assert.equal(Calc.money(29588), '$29,588');
  assert.equal(Calc.money('not a number'), '$0');
});

test('moneyExact keeps two decimals', () => {
  assert.equal(Calc.moneyExact(2.35), '$2.35');
  assert.equal(Calc.moneyExact(1100), '$1,100.00');
});

test('lineTotal respects checked state and quantity', () => {
  assert.equal(Calc.lineTotal(false, '5', 10), 0);      // unchecked
  assert.equal(Calc.lineTotal(true, '', 10), 0);        // no qty
  assert.equal(Calc.lineTotal(true, '0', 10), 0);       // zero qty
  assert.equal(Calc.lineTotal(true, '-3', 10), 0);      // negative qty
  assert.equal(Calc.lineTotal(true, '25', 2.35), 58.75);
  assert.equal(Calc.lineTotal(true, '3', 375), 1125);
});

test('dealMetrics computes total cost, profit and ROI', () => {
  const m = Calc.dealMetrics({ purchase: 110000, arv: 189000, extra: 14000, repair: 30738 });
  assert.equal(m.totalCost, 154738);
  assert.equal(m.profit, 34262);
  assert.ok(Math.abs(m.roi - 0.2214) < 0.001);
  assert.equal(m.verdict, 'go');
  assert.equal(m.cls, 'go');
});

test('dealMetrics verdict thresholds (good / thin / pass)', () => {
  // exactly at the good-deal threshold → go
  assert.equal(Calc.dealMetrics({ purchase: 100, arv: 115, repair: 0 }).verdict, 'go');
  // between thin and good → thin
  assert.equal(Calc.dealMetrics({ purchase: 100, arv: 108, repair: 0 }).verdict, 'thin');
  // below thin → pass
  assert.equal(Calc.dealMetrics({ purchase: 100, arv: 102, repair: 0 }).verdict, 'pass');
});

test('dealMetrics is safe with no / partial input', () => {
  const empty = Calc.dealMetrics({});
  assert.equal(empty.hasInputs, false);
  assert.equal(empty.roi, null);          // no total cost → no ROI, no divide-by-zero
  assert.equal(empty.badge, 'Enter numbers');
});

test('repair estimate flows into the cost basis', () => {
  const noRepair = Calc.dealMetrics({ purchase: 100000, arv: 150000, repair: 0 });
  const withRepair = Calc.dealMetrics({ purchase: 100000, arv: 150000, repair: 40000 });
  assert.equal(withRepair.totalCost - noRepair.totalCost, 40000);
  assert.equal(withRepair.profit, noRepair.profit - 40000);
});
