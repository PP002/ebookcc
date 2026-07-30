import os

with open("src/components/AuthDialog.tsx", "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace(
    "import { Shield, Lock, Mail, UserPlus, LogIn, User } from 'lucide-react';",
    "import { Shield, Lock, Mail, UserPlus, LogIn, User, Loader2 } from 'lucide-react';"
)

use_effect_str = """  const [showResetPassword, setShowResetPassword] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    if (!open) {
      setLoading(false);
      setIsSignUp(false);
      setEmail("");
      setPassword("");
      setShowResetPassword(false);
    }
  }, [open]);"""

content = content.replace(
    """  const [showResetPassword, setShowResetPassword] = useState(false);
  const [isResetting, setIsResetting] = useState(false);""",
    use_effect_str
)

content = content.replace(
    """<span className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" />""",
    """<Loader2 className="w-4 h-4 animate-spin" />"""
)

with open("src/components/AuthDialog.tsx", "w", encoding="utf-8") as f:
    f.write(content)
print("AuthDialog fixed")
