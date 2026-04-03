import { OllamaClient } from '../../src/llm/client'
import { executePlanningPipeline } from '../../src/agent/planning/planning-pipeline'
import { validatePlan } from '../../src/agent/planning/plan-validator'

async function main() {
  console.log('=== Test 5C: Planning Pipeline (REAL LLM) ===\n')
  console.log('This may take 60-120 seconds...\n')

  const client = new OllamaClient()

  const prompt = `Build a simple task management API. Users can create projects and add tasks to projects.
Tasks have a title, description, status (todo, in_progress, done), and priority (low, medium, high).
Users can be assigned to tasks.`

  const startTime = Date.now()

  try {
    const plan = await executePlanningPipeline(client, prompt, (step, detail) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`[${elapsed}s] ${step}: ${detail}`)
    })

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\n✓ Planning completed in ${elapsed}s`)

    // Validate
    const validation = validatePlan(plan)
    console.log(`\nPlan validation: ${validation.valid ? '✓ PASS' : '✗ FAIL'}`)
    if (!validation.valid) {
      console.log('Errors:', validation.errors)
    }

    // Check entities
    console.log(`\nEntities (${plan.entities.length}):`)
    for (const e of plan.entities) {
      console.log(`  - ${e.name} (${e.tableName}): ${e.fields.map(f => f.name).join(', ')}`)
    }

    // Check relationships
    console.log(`\nRelationships (${plan.relationships.length}):`)
    for (const r of plan.relationships) {
      console.log(`  - ${r.from} → ${r.to} (${r.type})`)
    }

    // Check endpoints
    console.log(`\nEndpoints (${plan.endpoints.length}):`)
    for (const ep of plan.endpoints) {
      console.log(`  - ${ep.methods.join(',')} ${ep.path}`)
    }

    // Assertions
    const entityNames = plan.entities.map(e => e.name.toLowerCase())
    const hasUser = entityNames.some(n => n.includes('user'))
    const hasProject = entityNames.some(n => n.includes('project'))
    const hasTask = entityNames.some(n => n.includes('task'))

    console.log(`\nChecks:`)
    console.log(`  Has User entity: ${hasUser ? '✓' : '✗'}`)
    console.log(`  Has Project entity: ${hasProject ? '✓' : '✗'}`)
    console.log(`  Has Task entity: ${hasTask ? '✓' : '✗'}`)
    console.log(`  At least 3 entities: ${plan.entities.length >= 3 ? '✓' : '✗'} (${plan.entities.length})`)
    console.log(`  Has endpoints: ${plan.endpoints.length > 0 ? '✓' : '✗'} (${plan.endpoints.length})`)

    console.log('\n=== FULL PLAN ===')
    console.log(JSON.stringify(plan, null, 2))

  } catch (err) {
    console.error('\n✗ Planning FAILED:', err)
    process.exit(1)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
