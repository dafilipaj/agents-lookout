// Prints the tests Vitest collects, as `vitest list --json` does, but with each test's describe titles
// and its own title kept apart: `{ path: string[], file }[]`. `vitest list --json` joins them with ` > `,
// so a title that contains ` > ` can't be split back (TEST-3.1). Run by `pnpm req-check`; arguments filter
// the test files, as they do for `vitest list`.
//
// The titles come from collecting: Vitest imports each test file, after its setup files, and runs its
// `describe` callbacks, but no hook and no test body. Its default static parse would count a test inside `if (false)` and leave
// `it.each` titles unexpanded. So a test file does no work at import or in a `describe` callback.
import { createVitest } from 'vitest/node';

const vitest = await createVitest({ watch: false, run: true });
try {
  const { testModules, unhandledErrors } = await vitest.collect(process.argv.slice(2), { staticParse: false });
  const errors = [...unhandledErrors];
  for (const module of testModules) {
    errors.push(...module.errors());
    for (const suite of module.children.allSuites()) errors.push(...suite.errors());
  }
  if (errors.length) {
    for (const e of errors) console.error(e.stack ?? e.message ?? e);
    process.exitCode = 1;
  } else {
    const out = [];
    for (const module of testModules) {
      for (const test of module.children.allTests()) {
        if (test.result().state === 'skipped') continue;
        const path = [];
        for (let task = test; task.type !== 'module'; task = task.parent) path.unshift(task.name);
        out.push({ path, file: module.moduleId });
      }
    }
    console.log(JSON.stringify(out));
  }
} finally {
  await vitest.close();
}
