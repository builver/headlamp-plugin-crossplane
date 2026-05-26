import { Icon } from '@iconify/react';
import { Activity } from '@kinvolk/headlamp-plugin/lib';
import { Autocomplete, TextField } from '@mui/material';
import { useCallback, useMemo } from 'react';
import { RuntimeConfigCreatePanel } from '../features/packages/RuntimeConfigCreateDialog';
import { DeploymentRuntimeConfig } from '../resources';

interface Props {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  helperText?: string;
}

interface CreateOption {
  inputValue: string;
  label: string;
}

type OptionType = string | CreateOption;

function isCreateOption(opt: OptionType): opt is CreateOption {
  return typeof opt === 'object' && 'inputValue' in opt;
}

export function RuntimeConfigRefField({
  value,
  onChange,
  label = 'Runtime Config Ref',
  helperText = 'Name of a DeploymentRuntimeConfig (optional)',
}: Props) {
  const [drcs] = DeploymentRuntimeConfig.useList();
  const existingNames = useMemo(
    () => new Set((drcs ?? []).map(d => d.metadata.name as string)),
    [drcs]
  );
  const sortedOptions = useMemo(() => [...existingNames].sort(), [existingNames]);

  const launchCreate = useCallback(
    (name: string) => {
      const id = `crossplane-runtimeconfig-create-${name}`;
      Activity.launch({
        id,
        title: `Create ${name}`,
        hideTitleInHeader: true,
        location: 'split-left',
        icon: <Icon icon="mdi:cog-play" width="100%" height="100%" />,
        content: (
          <RuntimeConfigCreatePanel
            prefillName={name}
            onDone={() => {
              onChange(name);
              Activity.close(id);
            }}
          />
        ),
      });
    },
    [onChange]
  );

  return (
    <Autocomplete<OptionType, false, false, true>
      freeSolo
      options={sortedOptions}
      value={value || null}
      onChange={(_, v) => {
        if (isCreateOption(v)) {
          launchCreate(v.inputValue);
        } else {
          onChange(typeof v === 'string' ? v : '');
        }
      }}
      onInputChange={(_, v, reason) => {
        if (reason !== 'reset') onChange(v);
      }}
      filterOptions={(options, params) => {
        const filtered = options.filter(
          o => typeof o === 'string' && o.toLowerCase().includes(params.inputValue.toLowerCase())
        );
        const input = params.inputValue.trim();
        if (input && !existingNames.has(input)) {
          filtered.push({ inputValue: input, label: `Create "${input}"` });
        }
        return filtered;
      }}
      getOptionLabel={opt => {
        if (isCreateOption(opt)) return opt.inputValue;
        return opt;
      }}
      renderOption={(props, opt) => (
        <li {...props} key={isCreateOption(opt) ? '__create__' : opt}>
          {isCreateOption(opt) ? opt.label : opt}
        </li>
      )}
      renderInput={params => (
        <TextField
          {...params}
          label={label}
          size="small"
          placeholder="my-deployment-runtime-config"
          helperText={helperText}
        />
      )}
    />
  );
}
