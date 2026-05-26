import { Icon } from '@iconify/react';
import { Activity } from '@kinvolk/headlamp-plugin/lib';
import { apply } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import {
  EditorDialog,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@mui/material';
import { ReactNode, useCallback, useState } from 'react';

function EditorPanel({ item, title, onDone }: { item: any; title: string; onDone: () => void }) {
  const [errorMessage, setErrorMessage] = useState('');
  return (
    <EditorDialog
      noDialog
      item={item}
      open
      setOpen={() => {}}
      onClose={onDone}
      saveLabel="Apply"
      errorMessage={errorMessage}
      onEditorChanged={() => setErrorMessage('')}
      title={title}
      aria-label={title}
    />
  );
}

function launchYamlEditor(
  item: any,
  title: string,
  options?: { activityId?: string; cluster?: string; location?: 'split-left' | 'split-right' },
) {
  const existingId = options?.activityId;
  if (existingId) {
    Activity.update(existingId, {
      title,
      cluster: options?.cluster,
      content: <EditorPanel item={item} title={title} onDone={() => Activity.close(existingId)} />,
    });
  } else {
    const id = `yaml-editor-${Date.now()}`;
    Activity.launch({
      id,
      title,
      hideTitleInHeader: true,
      location: options?.location ?? 'split-right',
      icon: <Icon icon="mdi:code-braces" width="100%" height="100%" />,
      content: <EditorPanel item={item} title={title} onDone={() => Activity.close(id)} />,
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
  /** Called after a successful apply. */
  onSuccess?: () => void;
  children: ReactNode;
  /** Override the submit button label. Defaults to "Create" / "Save" based on mode. */
  submitLabel?: string;
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
  submitLabel: submitLabelOverride,
  maxWidth = 'md',
}: ResourceHelperDialogProps) {
  const isEdit = !!existing;
  const title = titleOverride ?? (isEdit ? `Edit ${resourceName}` : `Create ${resourceName}`);
  const submitLabel = submitLabelOverride ?? (isEdit ? 'Save' : 'Create');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetAll = useCallback(() => {
    setError(null);
    onReset?.();
  }, [onReset]);

  const handleClose = useCallback(() => {
    resetAll();
    onClose();
  }, [resetAll, onClose]);

  const handleOpenNativeEditor = useCallback(() => {
    launchYamlEditor(buildItem(), title);
  }, [buildItem, title]);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apply(buildItem() as any);
      onSuccess?.();
      handleClose();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to apply resource');
    } finally {
      setSubmitting(false);
    }
  }, [buildItem, handleClose, onSuccess]);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth={maxWidth} fullWidth>
        <DialogTitle>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <span>{title}</span>
            <Button size="small" onClick={handleOpenNativeEditor}>
              YAML ↗
            </Button>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={3} mt={1}>
            {children}
            {error && <Alert severity="error">{error}</Alert>}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={!canSubmit || submitting}
          >
            {submitting ? 'Applying…' : submitLabel}
          </Button>
        </DialogActions>
      </Dialog>
  );
}

interface ResourceHelperPanelProps extends ResourceHelperBaseProps {
  /** Called after successful submit or cancel. Used to close the Activity tab. */
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
  children,
  submitLabel: submitLabelOverride,
  onDone,
  activityId,
  cluster,
}: ResourceHelperPanelProps) {
  const isEdit = !!existing;
  const title = titleOverride ?? (isEdit ? `Edit ${resourceName}` : `Create ${resourceName}`);
  const submitLabel = submitLabelOverride ?? (isEdit ? 'Save' : 'Create');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenNativeEditor = useCallback(() => {
    launchYamlEditor(buildItem(), title, {
      activityId,
      cluster,
      location: activityId ? undefined : 'split-left',
    });
  }, [buildItem, title, activityId, cluster]);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apply(buildItem() as any);
      onReset?.();
      onDone?.();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to apply resource');
    } finally {
      setSubmitting(false);
    }
  }, [buildItem, onReset, onDone]);

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
          <Button size="small" onClick={handleOpenNativeEditor}>
            YAML ↗
          </Button>
        </Box>
        <Box display="flex" flexDirection="column" gap={3}>
          {children}
          {error && <Alert severity="error">{error}</Alert>}
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
        <Button onClick={handleCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!canSubmit || submitting}
        >
          {submitting ? 'Applying…' : submitLabel}
        </Button>
      </Box>
    </Box>
  );
}
