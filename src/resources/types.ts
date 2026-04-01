export type ConditionStatus = 'True' | 'False' | 'Unknown';

export interface Condition {
  type: string;
  status: ConditionStatus;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  observedGeneration?: number;
}

export interface CrossplaneStatus {
  conditions?: Condition[];
  // Package resources
  currentRevision?: string;
  installedPackage?: string;
  // XRD resources
  established?: string;
  offered?: string;
}

export interface PackageSource {
  package: string;
  pullPolicy?: string;
  revisionActivationPolicy?: string;
  ignoreCrossplaneConstraints?: boolean;
  skipDependencyResolution?: boolean;
  packagePullSecrets?: { name: string }[];
}
