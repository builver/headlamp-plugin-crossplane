import { Link, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import { Box, Typography } from '@mui/material';
import { useParams } from 'react-router-dom';
import { XRTypeSection } from '../components/XRTypeSection';
import { CompositeResourceDefinition, getXRScope } from '../resources';

export function XRKindPage() {
  const { plural } = useParams<{ plural: string }>();
  const [xrds, error] = CompositeResourceDefinition.useList();

  if (error?.status === 404) {
    return (
      <SectionBox title="Composite Resources">
        <p>CompositeResourceDefinitions not found. Is Crossplane installed?</p>
      </SectionBox>
    );
  }

  if (!xrds) {
    return <SectionBox title="Composite Resources"><p>Loading…</p></SectionBox>;
  }

  const xrd = xrds.find(x => x.jsonData?.spec?.names?.plural === plural) ?? null;

  if (!xrd) {
    return (
      <SectionBox title="Composite Resources">
        <p>No XRD found for resource type "{plural}".</p>
      </SectionBox>
    );
  }

  const kind = xrd.jsonData?.spec?.names?.kind ?? plural;
  const scope = getXRScope(xrd);

  return (
    <SectionBox title={kind}>
      <Box px={2} pb={1}>
        <Typography variant="subtitle2" color="textSecondary">
          XRD:{' '}
          <Link routeName="crossplane-xrd-detail" params={{ name: xrd.metadata.name }}>
            {xrd.metadata.name}
          </Link>
        </Typography>
      </Box>
      <XRTypeSection xrd={xrd} scope={scope} />
    </SectionBox>
  );
}
