/* ============================================================
 * calc.js — pure calculation + formatting helpers.
 *
 * Deliberately free of any DOM or app-state dependency so the
 * money math and the Deal Analyzer verdict can be unit-tested in
 * isolation (see tests/unit/calc.test.cjs). Loaded as a plain
 * browser global (window.Calc) and also exported for Node tests.
 * ============================================================ */

(function () {
  // House-flipping rule of thumb, as named constants (no magic numbers):
  // return-on-cost at/above GOOD is a green light, between CAUTION and GOOD
  // is a thin margin, below CAUTION is a pass.
  const GOOD_DEAL_ROI = 0.15;
  const THIN_MARGIN_ROI = 0.05;

  function money(n) {
    const v = Math.round(Number(n) || 0);
    return '$' + v.toLocaleString('en-US');
  }

  function moneyExact(n) {
    return '$' + (Number(n) || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }

  // Line total with the app's rule: unchecked or non-positive qty = 0.
  function lineTotal(checked, qty, unitCost) {
    if (!checked) return 0;
    const q = parseFloat(qty);
    if (!q || q <= 0) return 0;
    return q * (Number(unitCost) || 0);
  }

  // Everything the Deal Analyzer needs, from raw inputs.
  // Returns { totalCost, profit, roi, hasInputs, verdict, badge, cls }.
  function dealMetrics(input) {
    const purchase = Number(input.purchase) || 0;
    const arv = Number(input.arv) || 0;
    const extra = Number(input.extra) || 0;
    const repair = Number(input.repair) || 0;

    const totalCost = purchase + repair + extra;
    const profit = arv - totalCost;
    const roi = totalCost > 0 ? profit / totalCost : null;
    const hasInputs = purchase > 0 || arv > 0;

    let verdict = 'pending', badge = 'Enter numbers', cls = 'caution';
    if (hasInputs && roi != null) {
      if (roi >= GOOD_DEAL_ROI) { verdict = 'go'; cls = 'go'; badge = '✅ Good Deal'; }
      else if (roi >= THIN_MARGIN_ROI) { verdict = 'thin'; cls = 'caution'; badge = '⚠ Thin Margin'; }
      else { verdict = 'pass'; cls = 'nogo'; badge = '⛔ Pass'; }
    }
    return { purchase, arv, extra, repair, totalCost, profit, roi, hasInputs, verdict, badge, cls };
  }

  const Calc = {
    money, moneyExact, lineTotal, dealMetrics,
    GOOD_DEAL_ROI, THIN_MARGIN_ROI,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Calc; // Node unit tests
  if (typeof window !== 'undefined') window.Calc = Calc;                      // browser
})();
