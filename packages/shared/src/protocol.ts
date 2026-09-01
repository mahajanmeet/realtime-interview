import { z } from 'zod';

export const AppRoleSchema = z.enum(['interviewer', 'candidate']);

export type AppRole = z.infer<typeof AppRoleSchema>;

export const DocumentUpdateSchema = z.object({
  type: z.literal('document-update'),

  documentId: z.string().uuid(),

  revision: z.number().int().nonnegative(),

  text: z.string().max(250_000),

  updatedBy: AppRoleSchema,

  updatedAt: z.number().int().nonnegative(),
});

export type DocumentUpdate = z.infer<typeof DocumentUpdateSchema>;

export const IceCandidateSchema = z.object({
  candidate: z.string().max(8192),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().nullable().optional(),
  usernameFragment: z.string().nullable().optional(),
});

export const ClientSignalMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('offer'),
    sdp: z.string().min(1).max(1_000_000),
  }),

  z.object({
    type: z.literal('answer'),
    sdp: z.string().min(1),
  }),

  z.object({
    type: z.literal('ice-candidate'),
    candidate: IceCandidateSchema,
  }),
]);

export type ClientSignalMessage = z.infer<typeof ClientSignalMessageSchema>;

export const ServerSignalMessageSchema = z.union([
  ClientSignalMessageSchema,

  z.object({
    type: z.literal('peer-connected'),
    role: AppRoleSchema,
  }),

  z.object({
    type: z.literal('peer-disconnected'),
    role: AppRoleSchema,
  }),

  z.object({
    type: z.literal('error'),
    message: z.string(),
  }),
]);

export type ServerSignalMessage = z.infer<typeof ServerSignalMessageSchema>;
