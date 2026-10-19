/* Node entry for the acceptance checks: `npm run check:parking`. */
import { runAcceptanceChecks } from './checks';

runAcceptanceChecks().then((results) => {
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${String(r.id).padStart(2)}. ${r.name}\n        ${r.detail}`);
  }
  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
});
