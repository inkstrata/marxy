// Loader hooks for a mutation run: as the module named by MARXY_MUTATION_PATCH ({ file, find, replace })
// is loaded, `find` is replaced by `replace`. The patch is the mutation; product code has no switch for it.
// A patch that does not match exactly once throws, so a stale patch fails the run rather than passing it.

const patch = process.env.MARXY_MUTATION_PATCH ? JSON.parse(process.env.MARXY_MUTATION_PATCH) : null;

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!patch || !url.endsWith(`/${patch.file}`) || result.source == null) return result;
  const text = Buffer.from(result.source).toString('utf8');
  const parts = text.split(patch.find);
  if (parts.length !== 2) throw new Error(`mutation patch for ${patch.file} matched ${parts.length - 1} times, not once`);
  return { ...result, source: parts.join(patch.replace) };
}
