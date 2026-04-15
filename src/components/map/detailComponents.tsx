import {
  Link,
  NameValueTable,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { XRDetailInner } from '../../features/composites/XRDetailPage';
import { MRDetailInner } from '../../features/managed/MRDetailPage';
import { FunctionDetailInner } from '../../features/packages/FunctionListPage';
import { ProviderDetailInner } from '../../features/packages/ProviderListPage';
import {
  CompositeResourceDefinition,
  ManagedResourceDefinition,
} from '../../resources';
import { RevisionHealthyStatus, RuntimeHealthyStatus } from '../ConditionStatus';
import { getGroupVersion } from './apiPaths';

/**
 * Detail panel for XR nodes — shown when the user clicks an XR in the Map.
 * Delegates to XRDetailInner so the map and the sidebar detail page are identical.
 */
export function XRMapDetail({ node }: { node: any }) {
  const xr = node.kubeObject as KubeObject;
  const [xrds] = CompositeResourceDefinition.useList();

  const kind = xr.jsonData?.kind as string | undefined;
  const xrd = xrds?.find(x => x.jsonData?.spec?.names?.kind === kind) ?? null;

  if (!xrd) return null;

  return (
    <XRDetailInner
      xrd={xrd}
      name={xr.metadata.name}
      namespace={xr.metadata.namespace || undefined}
    />
  );
}

/**
 * Detail panel for claim (parent) nodes on LegacyCluster XRs.
 * Shows static metadata and links to the Claims detail page when the claim
 * plural can be resolved from the XRDs list.
 */
export function ClaimMapDetail({ node }: { node: any }) {
  const { kind, name, namespace } = (node.data ?? {}) as {
    kind?: string;
    name: string;
    namespace?: string;
  };

  const [xrds] = CompositeResourceDefinition.useList();

  const claimPlural = xrds?.find(
    xrd => xrd.jsonData?.spec?.claimNames?.kind === kind
  )?.jsonData?.spec?.claimNames?.plural as string | undefined;

  const nameRow = claimPlural && namespace
    ? {
        name: 'Name',
        value: (
          <Link
            routeName="crossplane-claim-detail"
            params={{ plural: claimPlural, namespace, name }}
          >
            {name}
          </Link>
        ),
      }
    : { name: 'Name', value: name };

  return (
    <SectionBox title={kind ?? 'Claim'}>
      <NameValueTable
        rows={[
          nameRow,
          { name: 'Kind', value: kind ?? '-' },
          { name: 'Namespace', value: namespace ?? '-' },
        ]}
      />
    </SectionBox>
  );
}

/**
 * Detail panel for managed resource nodes — shown when the user clicks an MR in the Map.
 * Looks up the MRD by kind+group and delegates to MRDetailInner.
 * Returns null for non-MR nodes (native K8s etc.) so the map uses its default.
 */
export function MRMapDetail({ node }: { node: any }) {
  const mr = node.kubeObject;
  const kind: string = mr.kind ?? '';
  const apiVersion: string = mr.apiVersion ?? '';
  const name: string = mr.metadata?.name ?? '';
  const namespace: string | undefined = mr.metadata?.namespace;

  const [mrds] = ManagedResourceDefinition.useList();
  const [group] = getGroupVersion(apiVersion);

  const mrd =
    mrds?.find(
      m => m.jsonData?.spec?.names?.kind === kind && m.jsonData?.spec?.group === group
    ) ?? null;

  if (!mrd) return null;

  return <MRDetailInner mrdName={mrd.metadata.name} name={name} namespace={namespace} />;
}

export function ProviderMapDetail({ node }: { node: any }) {
  const provider = node.kubeObject as KubeObject;
  return <ProviderDetailInner name={provider.metadata.name} />;
}

export function FunctionMapDetail({ node }: { node: any }) {
  const fn = node.kubeObject as KubeObject;
  return <FunctionDetailInner name={fn.metadata.name} />;
}

export function makeRevisionMapDetail(title: string) {
  return function RevisionMapDetail({ node }: { node: any }) {
    const rev = node.kubeObject as KubeObject;
    const spec = rev.jsonData?.spec ?? {};
    const status = rev.jsonData?.status ?? {};
    const depRow = (label: string, val: number | undefined) =>
      ({ name: label, value: val !== undefined ? String(val) : '-' });
    return (
      <SectionBox title={title}>
        <NameValueTable
          rows={[
            { name: 'Name', value: rev.metadata.name },
            { name: 'Revision #', value: spec.revision !== undefined ? String(spec.revision) : '-' },
            { name: 'Desired State', value: spec.desiredState ?? '-' },
            { name: 'Image', value: spec.image ?? '-' },
            { name: 'Resolved Image', value: status.resolvedImage ?? '-' },
            depRow('Found Dependencies', status.foundDependencies),
            depRow('Installed Dependencies', status.installedDependencies),
            depRow('Invalid Dependencies', status.invalidDependencies),
            { name: 'Runtime Healthy', value: <RuntimeHealthyStatus item={rev} /> },
            { name: 'Revision Healthy', value: <RevisionHealthyStatus item={rev} /> },
          ]}
        />
      </SectionBox>
    );
  };
}

export const ProviderRevisionMapDetail = makeRevisionMapDetail('Provider Revision');
export const FunctionRevisionMapDetail = makeRevisionMapDetail('Function Revision');
