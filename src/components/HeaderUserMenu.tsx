/**
 * HeaderUserMenu.tsx
 *
 * Header user entry point:
 * - Signed out: "Sign in" text button that opens existing login flow.
 * - Signed in: User avatar button opening an accessible dropdown with
 *   EXACTLY three items: "Billing", "AI", "Log out".
 * Accessible with keyboard navigation (Arrow keys, Esc, Enter), ARIA attributes,
 * and click-outside dismissal.
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useAppSettings, getSupabase } from "@/context/AppSettingsContext";
import { useLanguage } from "@/context/LanguageContext";
import { AI_BILLING_TRANSLATIONS } from "@/data/aiBillingTranslations";
import { CreditCard, Sparkles, LogOut, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { signOutGoogleDrive } from "@/lib/googleDrive";

interface HeaderUserMenuProps {
  className?: string;
  onNavigate?: (view: "billing" | "ai") => void;
}

export function HeaderUserMenu({ className = "", onNavigate }: HeaderUserMenuProps) {
  const { language } = useLanguage();
  const menuCopy = (AI_BILLING_TRANSLATIONS[language] || AI_BILLING_TRANSLATIONS.en).menu;
  const {
    user,
    setUser,
    setShowAuthDialog,
    setShowAiSettingsDialog,
    setShowBillingDialog,
    supabaseUrl,
    supabaseAnonKey,
    walletBalance,
  } = useAppSettings();

  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Menu items list: strictly "Billing", "AI", "Log out"
  const menuItems = [
    {
      id: "billing",
      label: menuCopy.billing,
      icon: CreditCard,
      badge: walletBalance > 0 ? `$${walletBalance.toFixed(2)}` : undefined,
      action: () => {
        if (onNavigate) {
          onNavigate("billing");
        } else {
          window.dispatchEvent(new CustomEvent("app-navigation", { detail: { action: "open-billing" } }));
        }
      },
    },
    {
      id: "ai",
      label: menuCopy.ai,
      icon: Sparkles,
      action: () => {
        if (onNavigate) {
          onNavigate("ai");
        } else {
          window.dispatchEvent(new CustomEvent("app-navigation", { detail: { action: "open-ai" } }));
        }
      },
    },
    {
      id: "logout",
      label: menuCopy.logOut,
      icon: LogOut,
      destructive: true,
      action: () => handleLogout(),
    },
  ];

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Handle keyboard navigation inside dropdown
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setIsOpen(true);
          setActiveIndex(0);
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((prev) => (prev + 1) % menuItems.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) => (prev - 1 + menuItems.length) % menuItems.length);
          break;
        case "Home":
          e.preventDefault();
          setActiveIndex(0);
          break;
        case "End":
          e.preventDefault();
          setActiveIndex(menuItems.length - 1);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          menuItems[activeIndex].action();
          setIsOpen(false);
          triggerRef.current?.focus();
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          triggerRef.current?.focus();
          break;
        case "Tab":
          setIsOpen(false);
          break;
      }
    },
    [isOpen, activeIndex, menuItems]
  );

  // Focus active item when activeIndex changes and menu is open
  useEffect(() => {
    if (isOpen && itemRefs.current[activeIndex]) {
      itemRefs.current[activeIndex]?.focus();
    }
  }, [isOpen, activeIndex]);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await signOutGoogleDrive().catch(() => {});
      if (supabaseUrl && supabaseAnonKey) {
        const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
        if (supabase) {
          await supabase.auth.signOut().catch(() => {});
        }
      }
      setUser(null);
      localStorage.removeItem("auth_user");
      toast.success(menuCopy.loggedOutSuccess);
    } finally {
      setIsLoggingOut(false);
      setIsOpen(false);
    }
  };

  // ─────────────────────────────────────────────
  // Signed-Out View: "Sign in" text button
  // ─────────────────────────────────────────────
  if (!user) {
    return (
      <button
        type="button"
        onClick={() => setShowAuthDialog(true)}
        className={`px-3 py-1.5 text-xs font-semibold text-primary hover:text-primary-foreground hover:bg-primary/90 border border-primary/40 hover:border-primary rounded-md transition-all duration-150 shadow-xs cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 select-none ${className}`}
        aria-label={menuCopy.signInAria}
      >
        {menuCopy.signIn}
      </button>
    );
  }

  // ─────────────────────────────────────────────
  // Signed-In View: User Avatar + Dropdown Menu
  // ─────────────────────────────────────────────
  const avatarUrl = user.avatarUrl || user.photoURL;
  const initial = (user.name || user.email || "U").trim().charAt(0).toUpperCase();

  return (
    <div ref={containerRef} className={`relative inline-block text-left ${className}`} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        id="user-menu-button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`User menu for ${user.name || user.email}`}
        onClick={() => {
          setIsOpen((prev) => !prev);
          setActiveIndex(0);
        }}
        className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center p-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 shrink-0 cursor-pointer shadow-xs select-none"
        title={user.name ? `${user.name} (${user.email})` : user.email}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={user.name || user.email}
            className="w-full h-full object-cover rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-tr from-primary to-primary/80 text-primary-foreground font-black text-xs flex items-center justify-center uppercase font-mono">
            {initial}
          </div>
        )}
      </button>

      {/* Accessible Dropdown Menu: Exactly "Billing", "AI", "Log out" */}
      {isOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          aria-labelledby="user-menu-button"
          tabIndex={-1}
          className="absolute right-0 mt-2 w-48 origin-top-right rounded-lg bg-popover/95 backdrop-blur-md border border-border/20 shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100 outline-none divide-y divide-border/20"
        >
          {/* User identity preview */}
          <div className="px-3 py-2 text-start">
            <p className="text-xs font-semibold text-foreground truncate">{user.name || menuCopy.myAccount}</p>
            <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
          </div>

          {/* Menu items */}
          <div className="py-1">
            {menuItems.map((item, index) => {
              const Icon = item.icon;
              const isSelected = activeIndex === index;
              return (
                <button
                  key={item.id}
                  ref={(el) => (itemRefs.current[index] = el)}
                  role="menuitem"
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => {
                    item.action();
                    setIsOpen(false);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left cursor-pointer transition-colors outline-none ${
                    isSelected
                      ? item.destructive
                        ? "bg-destructive/15 text-destructive font-medium"
                        : "bg-primary/10 text-primary font-medium"
                      : item.destructive
                      ? "text-destructive hover:bg-destructive/10"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {isLoggingOut && item.id === "logout" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>{item.label}</span>
                  </div>

                  {item.badge && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
