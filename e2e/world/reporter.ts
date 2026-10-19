import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/** TEST-2.5: each run prints the suite's time and how long Worlds took to start. */
export default class WorldTimingReporter implements Reporter {
  private readonly starts: { title: string; ms: number }[] = [];

  onTestEnd(test: TestCase, _result: TestResult): void {
    for (const a of test.annotations) {
      if (a.type === 'world-start' && a.description) this.starts.push({ title: test.title, ms: Number(a.description) });
    }
  }

  onEnd(result: FullResult): void {
    const suite = `${(result.duration / 1000).toFixed(1)} s`;
    if (this.starts.length === 0) {
      console.log(`\nBehaviour suite: ${suite} · no World started`);
      return;
    }
    const ms = this.starts.map((s) => s.ms);
    const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
    const slowest = this.starts.reduce((a, b) => (b.ms > a.ms ? b : a));
    const s = (n: number) => `${(n / 1000).toFixed(2)} s`;
    console.log(
      `\nBehaviour suite: ${suite} · World start ${s(mean)} mean, ${s(slowest.ms)} max (${slowest.title.split(':')[0]}) over ${ms.length} Worlds`,
    );
  }

  printsToStdio(): boolean {
    return false;
  }
}
