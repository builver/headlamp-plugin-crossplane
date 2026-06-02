import { Icon } from '@iconify/react';
import { Activity } from '@kinvolk/headlamp-plugin/lib';
import { apply } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import {
  EditorDialog,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@mui/material';
import { ReactNode, useCallback, useEffect, useState } from 'react';

function EditorPanel({
  initialItem,
  title,
  activityId,
  onApplySuccess,
}: {
  initialItem: any;
  title: string;
  activityId: string;
  onApplySuccess?: () => void;
}) {
  // Mount EditorDialog with `null` first so its internal originalCodeRef
  // settles on the placeholder baseline; then push the real item via
  // treatItemChangesAsEdits so Save & Apply enables immediately. Without
  // this, original === code on first mount and the button stays disabled
  // until the user makes a no-op edit.
  const [item, setItem] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    setItem(initialItem);
  }, [initialItem]);

  const handleSave = useCallback(
    async (objects: any) => {
      const arr = Array.isArray(objects) ? objects : [objects];
      try {
        await Promise.all(arr.map(o => apply(o)));
        onApplySuccess?.();
        Activity.close(activityId);
      } catch (e: any) {
        setErrorMessage(e?.message ?? 'Failed to apply resource');
      }
    },
    [activityId, onApplySuccess]
  );

  return (
    <EditorDialog
      noDialog
      open
      setOpen={() => {}}
      item={item}
      onClose={() => Activity.close(activityId)}
      onSave={handleSave}
      saveLabel="Apply"
      treatItemChangesAsEdits
      allowToHideManagedFields
      errorMessage={errorMessage}
      onEditorChanged={() => setErrorMessage('')}
      title={title}
      aria-label={title}
    />
  );
}

function launchYamlEditor(
  initialItem: any,
  title: string,
  options?: {
    activityId?: string;
    cluster?: string;
    location?: 'split-left' | 'split-right';
    onSuccess?: () => void;
  }
) {
  const id = options?.activityId ?? `yaml-editor-${Date.now()}`;
  const content = (
    <EditorPanel
      initialItem={initialItem}
      title={title}
      activityId={id}
      onApplySuccess={options?.onSuccess}
    />
  );
  if (options?.activityId) {
    Activity.update(options.activityId, {
      title,
      cluster: options?.cluster,
      content,
    });
  } else {
    Activity.launch({
      id,
      title,
      hideTitleInHeader: true,
      location: options?.location ?? 'split-right',
      icon: <Icon icon="mdi:code-braces" width="100%" height="100%" />,
      content,
    });
  }
}

interface ResourceHelperBaseProps {
  /** Resource kind label used to derive default title (e.g. "Activation Policy"). */
  resourceName: string;
  /** Existing resource — when set, dialog operates in edit mode. */
  existing?: any;
  /** Override the dialog title. Defaults to "Create <resourceName>" / "Edit <resourceName>". */
  title?: string;
  /** Build the Kubernetes resource object from current form state. */
  buildItem: () => Record<string, unknown>;
  /** Whether the helper form is valid and ready to submit. */
  canSubmit: boolean;
  /** Called after the dialog closes (both submit and cancel). Use to reset form state. */
  onReset?: () => void;
  /** Called after a successful apply from inside the YAML editor. */
  onSuccess?: () => void;
  children: ReactNode;
}

interface ResourceHelperDialogProps extends ResourceHelperBaseProps {
  open: boolean;
  onClose: () => void;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

export function ResourceHelperDialog({
  open,
  onClose,
  resourceName,
  existing,
  title: titleOverride,
  buildItem,
  canSubmit,
  onReset,
  onSuccess,
  children,
  maxWidth = 'md',
}: ResourceHelperDialogProps) {
  const isEdit = !!existing;
  const title = titleOverride ?? (isEdit ? `Edit ${resourceName}` : `Create ${resourceName}`);

  const handleClose = useCallback(() => {
    onReset?.();
    onClose();
  }, [onReset, onClose]);

  const handleVerify = useCallback(() => {
    launchYamlEditor(buildItem(), title, { onSuccess });
    handleClose();
  }, [buildItem, title, onSuccess, handleClose]);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth={maxWidth} fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Box display="flex" flexDirection="column" gap={3} mt={1}>
          {children}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button onClick={handleVerify} variant="contained" disabled={!canSubmit}>
          Verify
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface ResourceHelperPanelProps extends ResourceHelperBaseProps {
  /** Called after the wizard's Cancel button is clicked. Used to close the Activity tab. */
  onDone?: () => void;
  /** Activity ID — when provided, the YAML editor replaces the wizard panel in the same tab. */
  activityId?: string;
  /** Cluster name — shown in the YAML editor tab header. */
  cluster?: string;
}

/**
 * Inline panel variant of `ResourceHelperDialog` for use inside Activity tabs.
 * Renders form content with a sticky bottom action bar instead of a modal dialog.
 */
export function ResourceHelperPanel({
  resourceName,
  existing,
  title: titleOverride,
  buildItem,
  canSubmit,
  onReset,
  onSuccess,
  children,
  onDone,
  activityId,
  cluster,
}: ResourceHelperPanelProps) {
  const isEdit = !!existing;
  const title = titleOverride ?? (isEdit ? `Edit ${resourceName}` : `Create ${resourceName}`);

  const handleVerify = useCallback(() => {
    launchYamlEditor(buildItem(), title, {
      activityId,
      cluster,
      location: activityId ? undefined : 'split-left',
      onSuccess,
    });
    onReset?.();
  }, [buildItem, title, activityId, cluster, onSuccess, onReset]);

  const handleCancel = useCallback(() => {
    onReset?.();
    onDone?.();
  }, [onReset, onDone]);

  return (
    <Box display="flex" flexDirection="column" height="100%">
      <Box flex={1} overflow="auto" p={3}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Box component="h2" m={0} fontSize="1.25rem" fontWeight="medium">
            {title}
          </Box>
        </Box>
        <Box display="flex" flexDirection="column" gap={3}>
          {children}
        </Box>
      </Box>
      <Box
        display="flex"
        justifyContent="flex-end"
        gap={1}
        p={2}
        borderTop={1}
        borderColor="divider"
      >
        <Button onClick={handleCancel}>Cancel</Button>
        <Button onClick={handleVerify} variant="contained" disabled={!canSubmit}>
          Verify
        </Button>
      </Box>
    </Box>
  );
}
