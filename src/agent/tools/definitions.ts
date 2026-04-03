export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List all files in the project or a subdirectory',
      parameters: {
        type: 'object',
        properties: {
          directory: {
            type: 'string',
            description: 'Directory path, or empty for project root',
            default: ''
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the current content of a file in the project',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to project root, e.g. src/main.py'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_codebase',
      description: 'Semantically search the codebase for files relevant to a query',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language search query, e.g. "user authentication logic"'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_symbols',
      description: 'Get all function and class definitions in a file (names, signatures, line numbers)',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to project root'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Make a surgical edit to a file using exact SEARCH/REPLACE. The search text must match the file exactly.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
          search: {
            type: 'string',
            description: 'Exact text to find in the file (include enough context lines to be unique)'
          },
          replace: {
            type: 'string',
            description: 'Text to replace the matched search block with'
          }
        },
        required: ['path', 'search', 'replace']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create a new file or fully overwrite an existing file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
          content: {
            type: 'string',
            description: 'Complete file content'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file from the project only when the user explicitly requested deletion',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_dependency',
      description: 'Add a Python package to requirements.txt (e.g. "httpx>=0.27.0")',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Package specifier, e.g. "httpx" or "httpx>=0.27.0"'
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_validation',
      description:
        'Trigger syntax + import validation for all Python files in the project. Returns a job ID.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'done',
      description: 'Signal that all changes are complete. Call this when the task is finished.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Brief summary of what was changed and why'
          }
        },
        required: ['summary']
      }
    }
  }
]
