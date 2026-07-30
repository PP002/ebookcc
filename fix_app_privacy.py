import os

with open("src/App.tsx", "r", encoding="utf-8") as f:
    content = f.read()

import_str = 'import Privacy from "./components/Privacy";\nimport Bookshelf from "./components/Bookshelf";'
content = content.replace('import Bookshelf from "./components/Bookshelf";', import_str)

path_type_old = '''  const [currentPath, setCurrentPath] = useState<
    "home" | "read" | "create" | "convert"
  >(() => {'''

path_type_new = '''  const [currentPath, setCurrentPath] = useState<
    "home" | "read" | "create" | "convert" | "privacy"
  >(() => {'''
content = content.replace(path_type_old, path_type_new)

path_logic_old = '''    if (path === "/read") return "read";
    if (path === "/create") return "create";
    if (path === "/convert") return "convert";
    return "home";'''

path_logic_new = '''    if (path === "/read") return "read";
    if (path === "/create") return "create";
    if (path === "/convert") return "convert";
    if (path === "/privacy") return "privacy";
    return "home";'''
content = content.replace(path_logic_old, path_logic_new)

popstate_logic_old = '''      if (path === "/read") setCurrentPath("read");
      else if (path === "/create") setCurrentPath("create");
      else if (path === "/convert") setCurrentPath("convert");
      else setCurrentPath("home");'''

popstate_logic_new = '''      if (path === "/read") setCurrentPath("read");
      else if (path === "/create") setCurrentPath("create");
      else if (path === "/convert") setCurrentPath("convert");
      else if (path === "/privacy") setCurrentPath("privacy");
      else setCurrentPath("home");'''
content = content.replace(popstate_logic_old, popstate_logic_new)

render_logic_old = '''          {currentPath === "home" && <LandingPage onNavigate={handleNavigate} />}
          {currentPath === "read" && <Bookshelf />}
          {currentPath === "create" && <ComicEditor />}
          {currentPath === "convert" && <Convert />}'''

render_logic_new = '''          {currentPath === "home" && <LandingPage onNavigate={handleNavigate} />}
          {currentPath === "read" && <Bookshelf />}
          {currentPath === "create" && <ComicEditor />}
          {currentPath === "convert" && <Convert />}
          {currentPath === "privacy" && <Privacy />}'''
content = content.replace(render_logic_old, render_logic_new)

with open("src/App.tsx", "w", encoding="utf-8") as f:
    f.write(content)
print("Updated App.tsx to support privacy path")
