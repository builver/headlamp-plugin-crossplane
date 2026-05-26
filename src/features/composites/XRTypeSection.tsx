import { Icon } from '@iconify/react';
import { Link, ResourceTable } from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Accordion, AccordionDetails, AccordionSummary, Box, Typography } from '@mui/material';
import { useMemo } from 'react';
import { makeXRNameColumn, readyColumn, syncedColumn } from '../../components/columns';
import { getCompositionRef, makeXRClass, XRScope } from '../../resources';

interface XRTypeSectionProps {
  xrd: KubeObject;
  scope: XRScope;
  noAccordion?: boolean;
}

/**
 * Renders an accordion with a table of Composite Resources for a single XRD type.
 * Each instance of this component makes exactly one useList() call,
 * which satisfies React's rules of hooks (no hooks in loops).
 * Empty types are collapsed by default.
 */
export function XRTypeSection({ xrd, scope, noAccordion }: XRTypeSectionProps) {
  const filterFunction = useFilterFunc();
  const spec = xrd.jsonData?.spec;
  const kind = spec?.names?.kind ?? xrd.metadata.name;
  const plural = spec?.names?.plural ?? '';
  const group = spec?.group ?? '';

  const DynClass = useMemo(() => makeXRClass(xrd), [xrd.metadata.uid]);
  const [items] = DynClass.useList();

  const isNamespaced = scope === 'Namespaced';
  const hasItems = !!(items && items.length > 0);

  const columns = [
    makeXRNameColumn(plural, scope),
    ...(isNamespaced ? ['namespace' as const] : []),
    {
      label: 'Composition',
      getValue: (item: KubeObject) => getCompositionRef(item, scope),
      render: (item: KubeObject) => {
        const name = getCompositionRef(item, scope);
        return name !== '-'
          ? <Link routeName={`crossplane-composition-detail-${name}`}>{name}</Link>
          : <span>-</span>;
      },
    },
    readyColumn,
    syncedColumn,
    'age' as const,
  ];

  const table = (
    <ResourceTable.default
      data={items}
      filterFunction={filterFunction}
      enableRowActions
      columns={columns}
    />
  );

  if (noAccordion) return table;

  return (
    <Accordion defaultExpanded={hasItems}>
      <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
        <Box display="flex" alignItems="center" gap={1}>
          <Typography fontWeight={500}>{kind}</Typography>
          <Typography variant="body2" color="textSecondary">
            <Link routeName="crossplane-xrd-detail" params={{ name: xrd.metadata.name }}>
              {plural}.{group}
            </Link>
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        {table}
      </AccordionDetails>
    </Accordion>
  );
}
