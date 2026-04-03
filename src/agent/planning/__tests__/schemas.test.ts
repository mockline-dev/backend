import { describe, it, expect } from 'vitest'

import {
  RequirementsSchema,
  EntitySchema,
  RelationshipsSchema,
  EndpointsSchema,
} from '../schemas'

// ─── RequirementsSchema ────────────────────────────────────────────────────────

describe('RequirementsSchema', () => {
  const valid = {
    projectName: 'Blog',
    description: 'A simple blog',
    features: ['auth', 'posts'],
    entityNames: ['User', 'Post'],
    authRequired: true,
    externalPackages: [],
  }

  it('accepts valid data', () => {
    expect(RequirementsSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts empty arrays', () => {
    const data = { ...valid, features: [], entityNames: [], externalPackages: [] }
    expect(RequirementsSchema.safeParse(data).success).toBe(true)
  })

  it('rejects missing projectName', () => {
    const { projectName: _, ...rest } = valid
    expect(RequirementsSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects empty projectName', () => {
    expect(RequirementsSchema.safeParse({ ...valid, projectName: '' }).success).toBe(false)
  })

  it('rejects non-boolean authRequired', () => {
    expect(RequirementsSchema.safeParse({ ...valid, authRequired: 'yes' }).success).toBe(false)
  })
})

// ─── EntitySchema ──────────────────────────────────────────────────────────────

describe('EntitySchema', () => {
  const valid = {
    name: 'User',
    tableName: 'users',
    fields: [
      { name: 'email', type: 'email', required: true, unique: true },
      { name: 'bio', type: 'text', required: false, unique: false, default: '' },
      {
        name: 'org_id',
        type: 'number',
        required: false,
        unique: false,
        reference: { entity: 'Organisation', field: 'id' },
      },
    ],
    timestamps: true,
    softDelete: false,
  }

  it('accepts valid entity', () => {
    expect(EntitySchema.safeParse(valid).success).toBe(true)
  })

  it('accepts empty fields array', () => {
    expect(EntitySchema.safeParse({ ...valid, fields: [] }).success).toBe(true)
  })

  it('rejects invalid field type', () => {
    const bad = { ...valid, fields: [{ name: 'x', type: 'uuid', required: true, unique: false }] }
    expect(EntitySchema.safeParse(bad).success).toBe(false)
  })

  it('accepts optional reference', () => {
    const f = { name: 'user_id', type: 'number', required: true, unique: false }
    expect(EntitySchema.safeParse({ ...valid, fields: [f] }).success).toBe(true)
  })

  it('rejects missing tableName', () => {
    const { tableName: _, ...rest } = valid
    expect(EntitySchema.safeParse(rest).success).toBe(false)
  })
})

// ─── RelationshipsSchema ───────────────────────────────────────────────────────

describe('RelationshipsSchema', () => {
  const valid = {
    relationships: [
      { from: 'User', to: 'Post', type: 'one-to-many', foreignKey: 'author_id' },
      {
        from: 'Post',
        to: 'Tag',
        type: 'many-to-many',
        foreignKey: 'post_id',
        junctionTable: 'post_tags',
      },
    ],
  }

  it('accepts valid relationships', () => {
    expect(RelationshipsSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts empty relationships array', () => {
    expect(RelationshipsSchema.safeParse({ relationships: [] }).success).toBe(true)
  })

  it('accepts optional junctionTable', () => {
    const data = {
      relationships: [
        { from: 'A', to: 'B', type: 'one-to-one', foreignKey: 'b_id' },
      ],
    }
    expect(RelationshipsSchema.safeParse(data).success).toBe(true)
  })

  it('rejects invalid relationship type', () => {
    const data = {
      relationships: [{ from: 'A', to: 'B', type: 'many-to-one', foreignKey: 'b_id' }],
    }
    expect(RelationshipsSchema.safeParse(data).success).toBe(false)
  })

  it('rejects missing foreignKey', () => {
    const data = {
      relationships: [{ from: 'A', to: 'B', type: 'one-to-many' }],
    }
    expect(RelationshipsSchema.safeParse(data).success).toBe(false)
  })
})

// ─── EndpointsSchema ──────────────────────────────────────────────────────────

describe('EndpointsSchema', () => {
  const valid = {
    endpoints: [
      { path: '/users', methods: ['GET', 'POST'], auth: { GET: false, POST: true }, description: 'Users' },
      { path: '/auth/login', methods: ['POST'], auth: { POST: false }, description: 'Login' },
    ],
  }

  it('accepts valid endpoints', () => {
    expect(EndpointsSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts empty endpoints array', () => {
    expect(EndpointsSchema.safeParse({ endpoints: [] }).success).toBe(true)
  })

  it('accepts empty auth record', () => {
    const data = {
      endpoints: [{ path: '/x', methods: ['GET'], auth: {}, description: 'test' }],
    }
    expect(EndpointsSchema.safeParse(data).success).toBe(true)
  })

  it('rejects invalid HTTP method', () => {
    const data = {
      endpoints: [{ path: '/x', methods: ['CONNECT'], auth: {}, description: 'test' }],
    }
    expect(EndpointsSchema.safeParse(data).success).toBe(false)
  })

  it('rejects missing path', () => {
    const data = {
      endpoints: [{ methods: ['GET'], auth: {}, description: 'test' }],
    }
    expect(EndpointsSchema.safeParse(data).success).toBe(false)
  })
})
