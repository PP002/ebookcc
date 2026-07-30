import os

with open("src/App.tsx", "r", encoding="utf-8") as f:
    content = f.read()

old_footer = """                  <span>
                    Contact:{" "}
                    <a
                      href="mailto:support@ebookcc.com"
                      className="underline hover:text-primary transition-colors"
                    >
                      support@ebookcc.com
                    </a>
                  </span>
                </p>"""

new_footer = """                  <span>
                    Contact:{" "}
                    <a
                      href="mailto:support@ebookcc.com"
                      className="underline hover:text-primary transition-colors"
                    >
                      support@ebookcc.com
                    </a>
                  </span>
                  <span className="hidden sm:inline text-border">|</span>
                  <span>
                    <a
                      href="/privacy"
                      onClick={(e) => {
                        e.preventDefault();
                        navigate("privacy");
                      }}
                      className="underline hover:text-primary transition-colors"
                    >
                      Privacy Policy
                    </a>
                  </span>
                </p>"""

content = content.replace(old_footer, new_footer)

with open("src/App.tsx", "w", encoding="utf-8") as f:
    f.write(content)
print("Added privacy link to footer")
