/* Node entry for the Health Passport checks: `npm run check:health`. */
import { runHealthChecks } from './checks';

runHealthChecks().then((results) => {
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${String(r.id).padStart(2)}. ${r.name}\n        ${r.detail}`);
  }
  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
});
