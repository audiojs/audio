// The editor's tools for pi (https://pi.dev), which takes no MCP server: each a tool of pi's, reaching the page through
// the bridge as `audio --mcp --editor` does (bin/mcp.js). The bridge's chat loads it, `pi -e bin/pi.js`; pi on its own
// may too, the bridge then found as it left its address and key.
import { EDITOR, reach } from './mcp.js'

export default function (pi) {
  for (let { name, title, description, inputSchema } of EDITOR) pi.registerTool({
    name, label: title, description, parameters: inputSchema,
    async execute(id, args, signal) {
      let { content, isError } = await reach(name, args, { signal })
      if (isError) throw new Error(content[0].text)
      return { content, details: undefined }
    }
  })
}
