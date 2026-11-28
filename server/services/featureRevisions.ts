import { z } from 'zod';
import { publicReleaseId, publicReleasePath } from './featurePublicRelease.js';

export const projectFilesSchema = z.object({
  'App.jsx': z.string().max(24_000),
  'styles.css': z.string().max(24_000),
}).strict();

const snapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  files: projectFilesSchema,
  summary: z.string().max(4_000),
});

export const revisionStateSchema = snapshotSchema.extend({
  history: z.array(snapshotSchema).max(12).default([]),
  notes: z.string().max(2_000).default(''),
  published: snapshotSchema.optional(),
  publicRelease: z.object({
    id: publicReleaseId,
    source: snapshotSchema,
    previous: snapshotSchema.optional(),
  }).optional(),
});

export type RevisionState = z.infer<typeof revisionStateSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;

export function snapshot(state: Snapshot): Snapshot {
  return { revision: state.revision, files: state.files, summary: state.summary };
}

export function nextRevision(state: RevisionState, files: Snapshot['files'], summary: string): RevisionState {
  return {
    ...state, files, summary, revision: state.revision + 1,
    history: [snapshot(state), ...state.history].slice(0, 12),
  };
}

export function revisionMetadata(state: RevisionState) {
  return {
    notes: state.notes,
    publishedRevision: state.published?.revision ?? null,
    publicRelease: state.publicRelease ? {
      path: publicReleasePath(state.publicRelease.id),
      revision: state.publicRelease.source.revision,
      previousRevision: state.publicRelease.previous?.revision ?? null,
    } : null,
    history: state.history.map(({ revision, summary }) => ({ revision, summary })),
  };
}
