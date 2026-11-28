export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const out = await page.evaluate(async () => {
    const { yieldToMain, runSliced } = await import('/src/scheduler/index.ts');
    const seq = async (lane, n) => { const s = performance.now(); for (let i = 0; i < n; i++) await yieldToMain(lane); return Math.round(performance.now() - s); };
    const idle = await seq('viewport', 10);
    // a background parse: sliced work on the default (input) lane, slices of ~2 ms
    const ac = new AbortController();
    const bg = runSliced((slice) => { while (!slice.expired()) {} return 'more'; }, { budgetMs: 2, signal: ac.signal });
    await new Promise((r) => setTimeout(r, 50));
    const busyViewport = await seq('viewport', 10);
    const busyInput = await seq('input', 10);
    ac.abort(); await bg;
    return { idle_ms_for_10_viewport_yields: idle, with_input_lane_busy_viewport: busyViewport, with_input_lane_busy_input: busyInput };
  });
  console.log(JSON.stringify(out));
};
