const content = `from typing import List, Optional, Any
import os
import sys

class Shopping_cart(Base):
    pass
`

const extractImports = (content) => {
    const imports = []
    const fromPattern = /from\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s+import/g
    const barePattern = /^import\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gm

    let match
    while ((match = fromPattern.exec(content)) !== null) {
      imports.push(match[1])
    }
    while ((match = barePattern.exec(content)) !== null) {
      imports.push(match[1])
    }
    return imports
}
console.log(extractImports(content))
