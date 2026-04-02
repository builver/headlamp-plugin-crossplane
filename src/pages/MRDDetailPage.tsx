import {
  ConditionsTable,
  MainInfoSection,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useLocation } from 'react-router-dom';
import { ManagedResourceDefinition } from '../resources';

export function MRDDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const [mrds] = ManagedResourceDefinition.useList();

  const mrd = mrds?.find(m => m.metadata.name === name) ?? null;

  const extraInfo = mrd
    ? [
        { name: 'Group', value: mrd.jsonData?.spec?.group ?? '-' },
        { name: 'Kind', value: mrd.jsonData?.spec?.names?.kind ?? '-' },
        { name: 'Plural', value: mrd.jsonData?.spec?.names?.plural ?? '-' },
        { name: 'Scope', value: mrd.jsonData?.spec?.scope ?? '-' },
        { name: 'State', value: mrd.jsonData?.spec?.state ?? '-' },
      ]
    : [];

  return (
    <>
      <MainInfoSection resource={mrd} extraInfo={extraInfo} />
      {mrd && <ConditionsTable resource={mrd.jsonData} />}
    </>
  );
}
