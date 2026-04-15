import { registerKubeObjectGlance } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { Box } from '@mui/material';
import { HealthyStatus, InstalledStatus, RevisionHealthyStatus, RuntimeHealthyStatus } from '../ConditionStatus';

type StatusChip = (props: { item: KubeObject }) => JSX.Element;

function makeGlance(kind: string, chips: StatusChip[]) {
  return function GlanceComponent({ node }: { node: any }) {
    const item = node.kubeObject as KubeObject | undefined;
    if (item?.kind !== kind) return null;
    return (
      <Box display="flex" gap={0.5} flexWrap="wrap">
        {chips.map((Chip, i) => <Chip key={i} item={item} />)}
      </Box>
    );
  };
}

registerKubeObjectGlance({
  id: 'crossplane-provider-glance',
  component: makeGlance('Provider', [InstalledStatus, HealthyStatus]),
});
registerKubeObjectGlance({
  id: 'crossplane-provider-revision-glance',
  component: makeGlance('ProviderRevision', [RuntimeHealthyStatus, RevisionHealthyStatus]),
});
registerKubeObjectGlance({
  id: 'crossplane-function-glance',
  component: makeGlance('Function', [InstalledStatus, HealthyStatus]),
});
registerKubeObjectGlance({
  id: 'crossplane-function-revision-glance',
  component: makeGlance('FunctionRevision', [RuntimeHealthyStatus, RevisionHealthyStatus]),
});
