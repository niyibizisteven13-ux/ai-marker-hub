function ownerOrSharedWhere(userId: string, organizationIds: string[]) {
  return {
    OR: [
      { userId },
      ...(organizationIds.length ? [{ organizationId: { in: organizationIds } }] : []),
    ],
  };
}

/** `publishedKnowledgeBaseIds`: datasets an admin published to Bwenge AI (readable by every signed-in user). */
export function buildKnowledgeAccessWhere(userId: string, organizationIds: string[], publishedKnowledgeBaseIds: string[] = []) {
  return {
    OR: [
      { document: { userId } },
      ...(organizationIds.length ? [{ document: { organizationId: { in: organizationIds } } }] : []),
      { document: { knowledgeBase: { userId } } },
      ...(organizationIds.length
        ? [{ document: { knowledgeBase: { organizationId: { in: organizationIds } } } }]
        : []),
      { document: { globalApproved: true, knowledgeBase: { globalApproved: true } } },
      ...(publishedKnowledgeBaseIds.length ? [{ knowledgeBaseId: { in: publishedKnowledgeBaseIds } }] : []),
    ],
  };
}

export function buildOwnedFormWhere(userId: string, formId?: string) {
  return { userId, ...(formId ? { id: formId } : {}) };
}

export function buildUserContextScope(userId: string, organizationIds: string[]) {
  const datasets = {
    OR: [
      { userId },
      ...(organizationIds.length ? [{ organizationId: { in: organizationIds } }] : []),
      { globalApproved: true },
    ],
  };

  return {
    forms: buildOwnedFormWhere(userId),
    submissions: { form: { userId } },
    insights: { submission: { form: { userId } } },
    datasets,
    examples: { status: 'approved', consentGiven: true, piiReviewed: true, dataset: datasets },
    chunks: {
      document: {
        OR: [
          { userId },
          ...(organizationIds.length ? [{ organizationId: { in: organizationIds } }] : []),
          { knowledgeBase: { userId } },
          ...(organizationIds.length
            ? [{ knowledgeBase: { organizationId: { in: organizationIds } } }]
            : []),
          { globalApproved: true, knowledgeBase: { globalApproved: true } },
        ],
      },
    },
  };
}

export function buildOwnerOrSharedWhere(userId: string, organizationIds: string[]) {
  return ownerOrSharedWhere(userId, organizationIds);
}
