import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MockedFunction } from 'vitest'

// ─── Mock structuredLLMCall before importing dependents ───────────────────────

vi.mock('../../../llm/structured-output', () => ({
  structuredLLMCall: vi.fn(),
  StructuredOutputError: class StructuredOutputError extends Error {
    zodErrors: string
    constructor(message: string, zodErrors: string) {
      super(message)
      this.name = 'StructuredOutputError'
      this.zodErrors = zodErrors
    }
  },
}))

import { structuredLLMCall } from '../../../llm/structured-output'
import { StructuredOutputError } from '../../../llm/structured-output'
import { decomposeRequirements } from '../requirements-decomposer'
import { extractEntities } from '../entity-extractor'
import { mapRelationships } from '../relationship-mapper'
import { planAPIContracts } from '../api-contract-planner'
import { validatePlan } from '../plan-validator'
import { executePlanningPipeline, PlanningError } from '../planning-pipeline'
import type { Requirements } from '../schemas'
import type { PlanEndpoint, PlanEntity, PlanRelationship } from '../../../types'

// ─── Typed mock helper ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCall = structuredLLMCall as MockedFunction<any>

/** Minimal fake OllamaClient — never called directly in these tests. */
const fakeClient = {} as Parameters<typeof decomposeRequirements>[0]

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockRequirements: Requirements = {
  projectName: 'BlogApp',
  description: 'A simple blog',
  features: ['auth', 'posts'],
  entityNames: ['User', 'Post'],
  authRequired: true,
  externalPackages: [],
}

const mockUserEntity: PlanEntity = {
  name: 'User',
  tableName: 'users',
  timestamps: true,
  softDelete: false,
  fields: [
    { name: 'email', type: 'email', required: true, unique: true },
    { name: 'username', type: 'string', required: true, unique: true },
  ],
}

const mockPostEntity: PlanEntity = {
  name: 'Post',
  tableName: 'posts',
  timestamps: true,
  softDelete: false,
  fields: [
    { name: 'title', type: 'string', required: true, unique: false },
    { name: 'body', type: 'text', required: true, unique: false },
    {
      name: 'author_id',
      type: 'number',
      required: true,
      unique: false,
      reference: { entity: 'User', field: 'id' },
    },
  ],
}

const mockRelationships: PlanRelationship[] = [
  { from: 'User', to: 'Post', type: 'one-to-many', foreignKey: 'author_id' },
]

const mockEndpoints: PlanEndpoint[] = [
  { path: '/users', methods: ['GET', 'POST'], auth: { GET: false, POST: true } as Record<string, boolean>, description: 'Users' },
  { path: '/users/{id}', methods: ['GET', 'PUT', 'DELETE'], auth: { GET: false, PUT: true, DELETE: true } as Record<string, boolean>, description: 'User detail' },
  { path: '/posts', methods: ['GET', 'POST'], auth: { GET: false, POST: true } as Record<string, boolean>, description: 'Posts' },
  { path: '/posts/{id}', methods: ['GET', 'PUT', 'DELETE'], auth: { GET: false, PUT: true, DELETE: true } as Record<string, boolean>, description: 'Post detail' },
  { path: '/auth/login', methods: ['POST'], auth: { POST: false } as Record<string, boolean>, description: 'Login' },
  { path: '/auth/register', methods: ['POST'], auth: { POST: false } as Record<string, boolean>, description: 'Register' },
]

// ─── requirementsDecomposer ───────────────────────────────────────────────────

describe('decomposeRequirements', () => {
  beforeEach(() => { mockCall.mockReset() })

  it('returns validated Requirements object', async () => {
    mockCall.mockResolvedValueOnce(mockRequirements)
    const result = await decomposeRequirements(fakeClient, 'Build a blog')
    expect(result).toEqual(mockRequirements)
  })

  it('calls structuredLLMCall with think:true and temperature:0.1', async () => {
    mockCall.mockResolvedValueOnce(mockRequirements)
    await decomposeRequirements(fakeClient, 'Build a blog')
    expect(mockCall).toHaveBeenCalledWith(
      fakeClient,
      expect.anything(),
      expect.any(Array),
      expect.objectContaining({ temperature: 0.1, think: true })
    )
  })

  it('propagates StructuredOutputError on LLM failure', async () => {
    mockCall.mockRejectedValueOnce(new StructuredOutputError('failed', '{}'))
    await expect(decomposeRequirements(fakeClient, 'Build a blog')).rejects.toThrow(
      'failed'
    )
  })
})

// ─── entityExtractor ─────────────────────────────────────────────────────────

describe('extractEntities', () => {
  beforeEach(() => { mockCall.mockReset() })

  it('calls structuredLLMCall once per entity', async () => {
    mockCall.mockResolvedValueOnce(mockUserEntity).mockResolvedValueOnce(mockPostEntity)
    const result = await extractEntities(fakeClient, mockRequirements)
    expect(mockCall).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('User')
    expect(result[1].name).toBe('Post')
  })

  it('includes previously extracted entities in context for later calls', async () => {
    mockCall.mockResolvedValueOnce(mockUserEntity).mockResolvedValueOnce(mockPostEntity)
    await extractEntities(fakeClient, mockRequirements)

    // Second call messages should mention 'User' (the first extracted entity)
    const secondCallMessages = mockCall.mock.calls[1][2] as { content: string }[]
    const combinedContent = secondCallMessages.map(m => m.content).join(' ')
    expect(combinedContent).toContain('User')
  })

  it('retries when post-validation detects invalid field name', async () => {
    const badEntity: PlanEntity = {
      ...mockUserEntity,
      fields: [{ name: 'Email Address', type: 'email', required: true, unique: true }], // invalid identifier
    }
    mockCall
      .mockResolvedValueOnce(badEntity)    // first attempt → bad field name
      .mockResolvedValueOnce(mockUserEntity) // retry → fixed
      .mockResolvedValueOnce(mockPostEntity) // second entity

    const result = await extractEntities(fakeClient, mockRequirements)
    // User called twice (original + retry), Post called once = 3 total
    expect(mockCall).toHaveBeenCalledTimes(3)
    expect(result[0].fields[0].name).toBe('email')
  })

  it('retries when post-validation detects unknown entity reference', async () => {
    const badEntity: PlanEntity = {
      ...mockUserEntity,
      fields: [
        { name: 'org_id', type: 'number', required: false, unique: false,
          reference: { entity: 'Organisation', field: 'id' } }, // unknown entity
      ],
    }
    mockCall
      .mockResolvedValueOnce(badEntity)
      .mockResolvedValueOnce(mockUserEntity)
      .mockResolvedValueOnce(mockPostEntity)

    await extractEntities(fakeClient, mockRequirements)
    expect(mockCall).toHaveBeenCalledTimes(3)
  })
})

// ─── relationshipMapper ───────────────────────────────────────────────────────

describe('mapRelationships', () => {
  beforeEach(() => { mockCall.mockReset() })

  const entities = [mockUserEntity, mockPostEntity]

  it('returns valid relationships', async () => {
    mockCall.mockResolvedValueOnce({ relationships: mockRelationships })
    const result = await mapRelationships(fakeClient, entities)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ from: 'User', to: 'Post', type: 'one-to-many' })
  })

  it('drops relationships that reference unknown entities', async () => {
    mockCall.mockResolvedValueOnce({
      relationships: [
        { from: 'User', to: 'Ghost', type: 'one-to-many', foreignKey: 'user_id' },
      ],
    })
    const result = await mapRelationships(fakeClient, entities)
    expect(result).toHaveLength(0)
  })

  it('removes duplicate relationships', async () => {
    mockCall.mockResolvedValueOnce({
      relationships: [
        { from: 'User', to: 'Post', type: 'one-to-many', foreignKey: 'author_id' },
        { from: 'User', to: 'Post', type: 'one-to-many', foreignKey: 'author_id' },
      ],
    })
    const result = await mapRelationships(fakeClient, entities)
    expect(result).toHaveLength(1)
  })

  it('generates junctionTable for many-to-many when not provided', async () => {
    mockCall.mockResolvedValueOnce({
      relationships: [
        { from: 'User', to: 'Post', type: 'many-to-many', foreignKey: 'user_id' },
      ],
    })
    const result = await mapRelationships(fakeClient, entities)
    expect(result[0].junctionTable).toBe('user_post')
  })

  it('injects missing FK field into the many-side entity', async () => {
    const entityWithoutFK: PlanEntity = { ...mockPostEntity, fields: [
      { name: 'title', type: 'string', required: true, unique: false },
    ]}
    mockCall.mockResolvedValueOnce({
      relationships: [
        { from: 'User', to: 'Post', type: 'one-to-many', foreignKey: 'author_id' },
      ],
    })
    await mapRelationships(fakeClient, [mockUserEntity, entityWithoutFK])
    // FK should have been injected into entityWithoutFK
    const injected = entityWithoutFK.fields.find(f => f.name === 'author_id')
    expect(injected).toBeDefined()
    expect(injected?.reference?.entity).toBe('User')
  })
})

// ─── planValidator ────────────────────────────────────────────────────────────

describe('validatePlan', () => {
  const basePlan = {
    projectName: 'Blog',
    description: 'A blog',
    features: [],
    authRequired: false,
    externalPackages: [],
    entities: [mockUserEntity, mockPostEntity],
    relationships: mockRelationships,
    endpoints: mockEndpoints,
  }

  it('passes a valid plan', () => {
    const result = validatePlan(basePlan)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('catches empty entity list', () => {
    const result = validatePlan({ ...basePlan, entities: [] })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('at least one entity'))).toBe(true)
  })

  it('catches duplicate entity names', () => {
    const result = validatePlan({ ...basePlan, entities: [mockUserEntity, mockUserEntity] })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Duplicate entity name'))).toBe(true)
  })

  it('catches unknown reference in field', () => {
    const badEntity: PlanEntity = {
      ...mockUserEntity,
      fields: [
        { name: 'ghost_id', type: 'number', required: false, unique: false,
          reference: { entity: 'Ghost', field: 'id' } },
      ],
    }
    const result = validatePlan({ ...basePlan, entities: [badEntity] })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Ghost'))).toBe(true)
  })

  it('catches missing auth endpoints when authRequired=true', () => {
    const result = validatePlan({
      ...basePlan,
      authRequired: true,
      endpoints: [{ path: '/users', methods: ['GET'], auth: {}, description: 'users' }],
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('/auth/login'))).toBe(true)
    expect(result.errors.some(e => e.includes('/auth/register'))).toBe(true)
  })

  it('catches duplicate field names within an entity', () => {
    const badEntity: PlanEntity = {
      ...mockUserEntity,
      fields: [
        { name: 'email', type: 'email', required: true, unique: true },
        { name: 'email', type: 'string', required: false, unique: false }, // duplicate
      ],
    }
    const result = validatePlan({ ...basePlan, entities: [badEntity] })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('duplicate field name'))).toBe(true)
  })

  it('catches unknown entity in relationship', () => {
    const badRel: PlanRelationship = { from: 'User', to: 'Ghost', type: 'one-to-many', foreignKey: 'x' }
    const result = validatePlan({ ...basePlan, relationships: [badRel] })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Ghost'))).toBe(true)
  })
})

// ─── executePlanningPipeline ──────────────────────────────────────────────────

describe('executePlanningPipeline', () => {
  beforeEach(() => { mockCall.mockReset() })

  const onProgress = vi.fn()

  function setupHappyPath(): void {
    mockCall
      .mockResolvedValueOnce(mockRequirements)             // decomposeRequirements
      .mockResolvedValueOnce(mockUserEntity)               // extractEntities: User
      .mockResolvedValueOnce(mockPostEntity)               // extractEntities: Post
      .mockResolvedValueOnce({ relationships: mockRelationships }) // mapRelationships
      .mockResolvedValueOnce({ endpoints: mockEndpoints }) // planAPIContracts
  }

  it('produces a valid ProjectPlan from happy-path mocks', async () => {
    setupHappyPath()
    const plan = await executePlanningPipeline(fakeClient, 'Build a blog', onProgress)
    expect(plan.projectName).toBe('BlogApp')
    expect(plan.entities).toHaveLength(2)
    expect(plan.authRequired).toBe(true)
  })

  it('calls onProgress for each pipeline step', async () => {
    setupHappyPath()
    const progress = vi.fn()
    await executePlanningPipeline(fakeClient, 'Build a blog', progress)
    const steps = progress.mock.calls.map((args) => args[0] as string)
    expect(steps).toContain('requirements')
    expect(steps).toContain('entities')
    expect(steps).toContain('relationships')
    expect(steps).toContain('api')
    expect(steps).toContain('validation')
  })

  it('throws PlanningError when validation fails', async () => {
    // Produce a plan with duplicate entity names to force validation failure
    mockCall
      .mockResolvedValueOnce({ ...mockRequirements, entityNames: ['User', 'User'] })
      .mockResolvedValueOnce(mockUserEntity)
      .mockResolvedValueOnce(mockUserEntity) // second "User"
      .mockResolvedValueOnce({ relationships: [] })
      .mockResolvedValueOnce({ endpoints: mockEndpoints })

    await expect(
      executePlanningPipeline(fakeClient, 'test', vi.fn())
    ).rejects.toBeInstanceOf(PlanningError)
  })

  it('propagates StructuredOutputError when LLM call fails', async () => {
    mockCall.mockRejectedValueOnce(new StructuredOutputError('LLM failed', '{}'))
    await expect(
      executePlanningPipeline(fakeClient, 'test', vi.fn())
    ).rejects.toThrow('LLM failed')
  })
})
