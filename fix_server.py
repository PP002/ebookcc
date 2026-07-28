import re
with open("server.ts", "r", encoding="utf-8") as f:
    content = f.read()

replacement = """  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    if (process.env.API_ONLY === "true") {
      app.get('*', (req, res) => res.json({ status: "API Server Only" }));
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
    }
  }"""

content = re.sub(
    r'  if \(process\.env\.NODE_ENV !== "production"\) \{\s*const \{ createServer: createViteServer \} = await import\("vite"\);\s*const vite = await createViteServer\(\{ server: \{ middlewareMode: true \}, appType: "spa" \}\);\s*app\.use\(vite\.middlewares\);\s*\} else \{\s*const distPath = path\.join\(process\.cwd\(\), \'dist\'\);\s*app\.use\(express\.static\(distPath\)\);\s*app\.get\(\'\*\', \(req, res\) => res\.sendFile\(path\.join\(distPath, \'index\.html\'\)\)\);\s*\}',
    replacement,
    content
)

with open("server.ts", "w", encoding="utf-8") as f:
    f.write(content)

