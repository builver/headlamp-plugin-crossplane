import {
  ConditionsTable,
  MainInfoSection,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useParams } from 'react-router-dom';
import { ReadyStatus } from '../../components/ConditionStatus';
import { CompositeResourceDefinition, getXRScope } from '../../resources';

export function XRDDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [xrds] = CompositeResourceDefinition.useList();

  const xrd = xrds?.find(x => x.metadata.name === name) ?? null;
  const scope = xrd ? getXRScope(xrd) : null;
  const hasClaimNames = !!xrd?.jsonData?.spec?.claimNames?.kind;

  const extraInfo = xrd
    ? [
        { name: 'Status', value: <ReadyStatus item={xrd} /> },
        { name: 'Scope', value: scope },
        { name: 'Group', value: xrd.jsonData?.spec?.group ?? '-' },
        { name: 'Kind', value: xrd.jsonData?.spec?.names?.kind ?? '-' },
        ...(hasClaimNames
          ? [{ name: 'Claim Kind', value: xrd.jsonData?.spec?.claimNames?.kind }]
          : []),
        {
          name: 'Default Composition',
          value: xrd.jsonData?.spec?.defaultCompositionRef?.name ?? '-',
        },
        {
          name: 'Composition Update Policy',
          value: xrd.jsonData?.spec?.compositionUpdatePolicy ?? '-',
        },
      ]
    : [];

  return (
    <>
      <MainInfoSection resource={xrd} extraInfo={extraInfo} />
      {xrd && <ConditionsTable resource={xrd.jsonData} />}
    </>
  );
}
