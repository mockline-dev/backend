import { z } from 'zod'

// ─── Field type enum ───────────────────────────────────────────────────────────

export const FieldTypeEnum = z.enum([
  'string', 'text', 'number', 'float', 'boolean', 'date', 'email', 'password',
])

export type FieldType = z.infer<typeof FieldTypeEnum>

// ─── HTTP method enum ──────────────────────────────────────────────────────────

export const HttpMethodEnum = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

// ─── RequirementsSchema ────────────────────────────────────────────────────────

export const RequirementsSchema = z.object({
  projectName: z.string().min(1),
  description: z.string().min(1),
  features: z.array(z.string()),
  entityNames: z.array(z.string().min(1)),
  authRequired: z.boolean(),
  externalPackages: z.array(z.string()),
})

export type Requirements = z.infer<typeof RequirementsSchema>

// ─── EntitySchema ──────────────────────────────────────────────────────────────

export const EntitySchema = z.object({
  name: z.string().min(1),
  tableName: z.string().min(1),
  fields: z.array(
    z.object({
      name: z.string().min(1),
      type: FieldTypeEnum,
      required: z.boolean(),
      unique: z.boolean(),
      default: z.string().optional(),
      reference: z
        .object({
          entity: z.string().min(1),
          field: z.string().min(1),
        })
        .optional(),
    })
  ),
  timestamps: z.boolean(),
  softDelete: z.boolean(),
})

export type EntityOutput = z.infer<typeof EntitySchema>

// ─── RelationshipsSchema ───────────────────────────────────────────────────────

export const RelationshipsSchema = z.object({
  relationships: z.array(
    z.object({
      from: z.string().min(1),
      to: z.string().min(1),
      type: z.enum(['one-to-one', 'one-to-many', 'many-to-many']),
      foreignKey: z.string().min(1),
      junctionTable: z.string().optional(),
    })
  ),
})

export type RelationshipsOutput = z.infer<typeof RelationshipsSchema>

// ─── EndpointsSchema ──────────────────────────────────────────────────────────

export const EndpointsSchema = z.object({
  endpoints: z.array(
    z.object({
      path: z.string().min(1),
      methods: z.array(HttpMethodEnum),
      auth: z.record(z.string(), z.boolean()),
      description: z.string(),
    })
  ),
})

export type EndpointsOutput = z.infer<typeof EndpointsSchema>
