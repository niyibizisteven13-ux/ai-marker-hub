export interface AccessResult {
  allowed: boolean;
  reason?: 'org_balance_exhausted' | 'worker_cap_exceeded' | 'free_trial_used' | 'payment_required';
  needsAdminApproval?: boolean;
  paidFrom?: 'individual_charge' | 'org_balance' | 'free_trial';
  message?: string;
  wasFreeTrial?: boolean;
}

export interface PlanPolicy {
  checkAccess(userId: string, service: string, jobId: string): Promise<AccessResult>;
}
