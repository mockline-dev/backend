export const buildGenerationPrompts = {
  extractSchema: (prompt: string): string => `
You are a backend architecture expert.
Extract a structured project schema from the description below.
Return ONLY valid JSON. No markdown. No explanation. No preamble.

Description: "${prompt}"

Return this exact structure:
{
  "projectName": "snake_case_name",
  "description": "one sentence description",
  "entities": [
    {
      "name": "PascalCaseName",
      "fields": [
        { "name": "fieldName", "type": "str|int|float|bool|datetime|List[str]", "required": true, "indexed": false }
      ],
      "endpoints": ["list", "get", "create", "update", "delete"]
    }
  ],
  "features": ["authentication", "pagination", "search", "file-upload"],
  "authType": "jwt|none|oauth2"
}`,

  filePlan: (prompt: string, schema: any): string => `
You are a FastAPI expert. Generate a production-ready file plan.
Return ONLY a JSON array. No markdown. No explanation.

Project: "${prompt}"
Schema: ${JSON.stringify(schema)}

Rules:
- Use FastAPI with SQLAlchemy or MongoDB Motor depending on the schema
- Include: main.py, requirements.txt, .env.example, README.md
- Include: models/, routers/, schemas/, services/, core/ directories
- Order files by dependency (dependencies first)

Return:
[
  { "path": "requirements.txt", "description": "Python dependencies" },
  { "path": "main.py", "description": "FastAPI app entrypoint" }
]`,

  generateFile: (
    prompt: string,
    schema: any,
    file: { path: string; description: string },
    context: { path: string; content: string }[]
  ): string => `
Generate the complete content of: ${file.path}
Purpose: ${file.description}

Project context: "${prompt}"
Schema: ${JSON.stringify(schema, null, 2)}

${
  context.length > 0
    ? `Previously generated files:\n${context.map(c => `=== ${c.path} ===\n${c.content}`).join('\n\n')}`
    : ''
}

RULES:
- Output ONLY the raw file content
- NO markdown code fences
- NO explanation text before or after the code
- Write complete, production-ready code
- Include all imports
- Add docstrings to all functions and classes
- Handle errors properly with HTTP exceptions where applicable

Output the complete content of ${file.path} now:`
}
