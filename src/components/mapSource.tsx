import './map/glances';
import { Icon } from '@iconify/react';
import { K8s, registerMapSource } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { CrossplaneFunction, FunctionRevision, getXRScope, makeXRClass, Provider, ProviderRevision, XRScope } from '../resources';
import { FunctionMapDetail, FunctionRevisionMapDetail, ProviderMapDetail, ProviderRevisionMapDetail } from './map/detailComponents';
import { makePackageSource } from './map/packageGraph';
import { useXrTreeGraph } from './map/useXrTreeGraph';

export function registerCrossplaneMapSource(xrds: KubeObject[]): void {
  // Build lookup structures from XRDs
  const xrdGroupSet = new Set<string>();
  const claimKindSet = new Set<string>();
  const xrdScopeMap = new Map<string, XRScope>();

  for (const xrd of xrds) {
    const group: string = xrd.jsonData?.spec?.group ?? '';
    const kind: string = xrd.jsonData?.spec?.names?.kind ?? '';
    if (group && kind) {
      const key = `${group}/${kind}`;
      xrdGroupSet.add(key);
      xrdScopeMap.set(key, getXRScope(xrd));
    }
    const claimKind: string | undefined = xrd.jsonData?.spec?.claimNames?.kind;
    if (group && claimKind) {
      claimKindSet.add(`${group}/${claimKind}`);
    }
  }

  const subSources = xrds.map(xrd => {
    const scope = getXRScope(xrd);
    const DynClass = makeXRClass(xrd);
    const kind = (xrd.jsonData?.spec?.names?.kind as string | undefined) ?? xrd.metadata.name;
    const plural = (xrd.jsonData?.spec?.names?.plural as string | undefined) ?? xrd.metadata.name;

    return {
      id: `crossplane-xr-${plural}`,
      label: kind,
      icon: <Icon icon="mdi:layers-outline" width="100%" height="100%" />,
      useData() {
        const [items] = DynClass.useList();
        const [crds] = K8s.ResourceClasses.CustomResourceDefinition.useList();
        return useXrTreeGraph(
          items,
          scope,
          xrdGroupSet,
          claimKindSet,
          xrdScopeMap,
          crds ?? null,
        );
      },
    };
  });

  const compositeResourcesSource = {
    id: 'crossplane-composite-resources',
    label: 'Composite Resources',
    icon: <Icon icon="mdi:layers-outline" width="100%" height="100%" />,
    sources: subSources,
  };

  const providersSource = makePackageSource(
    'crossplane-providers',
    'Providers',
    Provider.useList.bind(Provider),
    ProviderRevision.useList.bind(ProviderRevision),
    {
      rootSubtitle: 'Provider',
      rootIcon: <Icon icon="mdi:puzzle-outline" width="100%" height="100%" />,
      rootDetailsComponent: ProviderMapDetail,
      revisionSubtitle: 'ProviderRevision',
      revisionDetailsComponent: ProviderRevisionMapDetail,
    },
  );

  const functionsSource = makePackageSource(
    'crossplane-functions',
    'Functions',
    CrossplaneFunction.useList.bind(CrossplaneFunction),
    FunctionRevision.useList.bind(FunctionRevision),
    {
      rootSubtitle: 'Function',
      rootIcon: <Icon icon="mdi:function" width="100%" height="100%" />,
      rootDetailsComponent: FunctionMapDetail,
      revisionSubtitle: 'FunctionRevision',
      revisionDetailsComponent: FunctionRevisionMapDetail,
    },
  );

  registerMapSource({
    id: 'crossplane',
    label: 'Crossplane',
    icon: <Icon icon="logos:crossplane-icon" width="100%" height="100%" />,
    sources: [compositeResourcesSource, providersSource, functionsSource],
  } as any);
}
