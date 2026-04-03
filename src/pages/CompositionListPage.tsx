import {
  ConditionsTable,
  CreateResourceButton,
  DateLabel,
  Link,
  MainInfoSection,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { useParams } from 'react-router-dom';
import { ReadyStatus } from '../components/ConditionStatus';
import { Composition } from '../resources';

export function CompositionListPage() {
  const filterFunction = useFilterFunc();
  const [compositions, error] = Composition.useList();

  if (error?.status === 404) {
    return (
      <SectionBox title="Compositions">
        <p>Compositions not found. Is Crossplane installed?</p>
      </SectionBox>
    );
  }

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title="Compositions"
          titleSideActions={[<CreateResourceButton resourceClass={Composition} resourceName="Composition" />]}
        />
      }
    >
      <Table
        data={compositions}
        loading={compositions === null}
        filterFunction={filterFunction}
        columns={[
          {
            header: 'Name',
            accessorKey: 'metadata.name',
            Cell: ({ row: { original: item } }) => (
              <Link
                routeName="crossplane-composition-detail"
                params={{ name: item.metadata.name }}
              >
                {item.metadata.name}
              </Link>
            ),
          },
          {
            header: 'Composite Type',
            accessorFn: item => {
              const ref = item.jsonData?.spec?.compositeTypeRef;
              return ref ? `${ref.apiVersion}/${ref.kind}` : '-';
            },
          },
          {
            header: 'Status',
            accessorFn: item => item,
            Cell: ({ row: { original: item } }) => <ReadyStatus item={item} />,
          },
          {
            header: 'Age',
            accessorFn: item => -new Date(item.metadata.creationTimestamp).getTime(),
            Cell: ({ row: { original: item } }) => (
              <DateLabel date={item.metadata.creationTimestamp} format="mini" />
            ),
          },
        ]}
      />
    </SectionBox>
  );
}

export function CompositionDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [comp] = Composition.useGet(name);

  const compTypeRef = comp?.jsonData?.spec?.compositeTypeRef;

  const extraInfo = comp
    ? [
        { name: 'Status', value: <ReadyStatus item={comp} /> },
        {
          name: 'Composite Type',
          value: compTypeRef ? `${compTypeRef.apiVersion} / ${compTypeRef.kind}` : '-',
        },
        {
          name: 'Mode',
          value: comp.jsonData?.spec?.mode ?? 'Resources',
        },
        {
          name: 'Composition Revision Policy',
          value: comp.jsonData?.spec?.publishConnectionDetailsWithStoreConfigRef?.name ?? '-',
        },
      ]
    : [];

  return (
    <>
      <MainInfoSection resource={comp} extraInfo={extraInfo} />
      {comp && <ConditionsTable resource={comp.jsonData} />}
    </>
  );
}
