import { ExpandContext } from './types';

export function addEdge(ctx: ExpandContext, source: string, target: string) {
  const id = `${source}-->${target}`;
  if (!ctx.edgeSet.has(id)) {
    ctx.edgeSet.add(id);
    ctx.edges.push({ id, source, target });
  }
}
