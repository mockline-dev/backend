import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEventType } from '../engine'
import { AgentEngine } from '../engine'

describe('AgentEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('run', () => {
    it('should emit tokens as they are generated', async () => {
      const mockApp = {
        channel: vi.fn(),
        service: vi.fn()
      } as any

      const engine = new AgentEngine(mockApp)
      const events: any[] = []

      mockApp.channel.mockImplementation((event: any) => events.push(event))
      mockApp.service.mockImplementation((name: string) => ({
        find: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue({ _id: 'test-id' })
      }))

      await engine.run({
        projectId: 'test-project',
        systemPrompt: 'You are a test assistant',
        userMessage: 'Test message',
        onEvent: (event: any) => {
          if (event.type === 'token') {
            events.push(event)
          }
        }
      })

      expect(events).toContainEqual({ type: 'token', payload: 'Hello' })
      expect(events).toContainEqual({ type: 'token', payload: 'World' })
      expect(mockApp.service).toHaveBeenCalledWith(
        'files',
        expect.objectContaining({ query: { projectId: 'test-project' } })
      )
    })

    it('should stop after finish tool call', async () => {
      const mockApp = {
        channel: vi.fn()
      } as any

      const engine = new AgentEngine(mockApp)
      const finishCalled = vi.fn()

      mockApp.channel.mockImplementation(() => ({
        send: vi.fn()
      }))

      mockApp.service.mockImplementation((name: string) => ({
        find: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue({ _id: 'test-id' })
      }))

      const onEvent = vi.fn()
      onEvent.mockImplementation((event: any) => {
        if (event.type === 'done') {
          finishCalled()
        }
      })

      await engine.run({
        projectId: 'test-project',
        systemPrompt: 'You are a test assistant',
        userMessage: 'Test message',
        onEvent
      })

      expect(finishCalled).toHaveBeenCalled()
      expect(onEvent).toHaveBeenCalledWith({ type: 'done', payload: { summary: 'Test message' } })
    })

    it('should stop after max iterations', async () => {
      const mockApp = {
        channel: vi.fn()
      } as any
      it('should handle tool calls and emit events', async () => {
        const engine = new AgentEngine(mockApp)
        const events: AgentEventType[] = []
        const onEvent = vi.fn()

        mockApp.channel.mockImplementation(() => ({
          send: vi.fn(event => events.push(event))
        }))

        mockApp.service.mockImplementation((name: string) => ({
          find: vi.fn().mockResolvedValue({ data: [] })
        }))

        await engine.run({
          projectId: 'test-project',
          systemPrompt: 'You are a test assistant',
          userMessage: 'Test message',
          onEvent
        })

        expect(onEvent).not.toHaveBeenCalledWith({ type: 'done' })
        expect(onEvent).toHaveBeenCalledWith({
          type: 'error',
          payload: { message: 'Max agent iterations reached without completion' }
        })
      })
    })
  })
})
