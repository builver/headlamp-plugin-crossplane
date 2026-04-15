import { Icon } from '@iconify/react';
import {
  CreateResourceButton,
  Link,
  ResourceTable,
  SectionBox,
  SectionFilterHeader,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/lib/k8s/cluster';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box, Tooltip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';
import { makeCompositeTypeColumn } from '../../components/columns';
import { CompositeResourceDefinition,Composition } from '../../resources';

const MAX_VISIBLE_STEPS = 7;

interface PipelineStep {
  step: string;
  functionRef: { name: string };
}

function PipelineSteps({ item }: { item: KubeObject }) {
  const theme = useTheme();
  const steps: PipelineStep[] = item.jsonData?.spec?.pipeline ?? [];

  if (steps.length === 0) return <span>-</span>;

  const visible = steps.slice(0, MAX_VISIBLE_STEPS);
  const overflow = steps.slice(MAX_VISIBLE_STEPS);

  return (
    <Box display="flex" alignItems="center" flexWrap="nowrap">
      {visible.map((s, i) => (
        <React.Fragment key={s.step}>
          {i > 0 && (
            <Box sx={{ width: 14, height: 2, flexShrink: 0, bgcolor: 'primary.main', opacity: 0.4 }} />
          )}
          <Tooltip
            title={
              <Box>
                <div><strong>{s.step}</strong></div>
                {s.functionRef?.name && (
                  <Link routeName={`crossplane-function-detail-${s.functionRef.name}`}>
                    <Box display="flex" alignItems="center" gap={0.5} component="span">
                      <Icon icon="mdi:function" width="1em" height="1em" />
                      {s.functionRef.name}
                    </Box>
                  </Link>
                )}
              </Box>
            }
          >
            <Box component="span" sx={{ cursor: 'default', lineHeight: 0, flexShrink: 0 }}>
              <Icon
                icon="mdi:circle"
                width="0.875rem"
                height="0.875rem"
                style={{ color: theme.palette.primary.main }}
              />
            </Box>
          </Tooltip>
        </React.Fragment>
      ))}
      {overflow.length > 0 && (
        <>
          <Box sx={{ width: 14, height: 2, flexShrink: 0, bgcolor: 'primary.main', opacity: 0.4 }} />
          <Tooltip title={overflow.map(s => s.step).join(', ')}>
            <Box
              component="span"
              sx={{
                cursor: 'default',
                fontSize: '0.75rem',
                color: 'primary.main',
                flexShrink: 0,
                lineHeight: 1,
              }}
            >
              +{overflow.length}
            </Box>
          </Tooltip>
        </>
      )}
    </Box>
  );
}

export function CompositionListPage() {
  const filterFunction = useFilterFunc();
  const [compositions, error] = Composition.useList();
  const [xrds] = CompositeResourceDefinition.useList();

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
      <ResourceTable.default
        data={compositions}
        filterFunction={filterFunction}
        enableRowActions
        columns={[
          {
            label: 'Name',
            getValue: item => item.metadata.name,
            render: item => (
              <Link routeName={`crossplane-composition-detail-${item.metadata.name}`}>
                {item.metadata.name}
              </Link>
            ),
          },
          makeCompositeTypeColumn(xrds),
          {
            label: 'Pipeline',
            getValue: item =>
              (item.jsonData?.spec?.pipeline ?? []).map((s: PipelineStep) => s.step).join(', '),
            render: item => <PipelineSteps item={item} />,
          },
          'age',
        ]}
      />
    </SectionBox>
  );
}
