import React from "react";
import { Globe } from "lucide-react";
import {
  useLanguage,
  LANGUAGES,
  LanguageCode,
} from "@/context/LanguageContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function LanguageSelector({ className }: { className?: string }) {
  const { language, setLanguage, currentOption } = useLanguage();

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <Select
        value={language}
        onValueChange={(val) => setLanguage(val as LanguageCode)}
      >
        <SelectTrigger
          size="sm"
          className="h-8 gap-1.5 bg-background/80 hover:bg-accent/80 text-xs font-medium border-border/60 shadow-xs rounded-full px-3 cursor-pointer transition-colors"
        >
          <Globe className="w-3.5 h-3.5 text-primary shrink-0" />
          <SelectValue>
            <span className="font-medium text-foreground">
              {currentOption.nativeName}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="center" className="max-h-80 z-[100] min-w-[140px]">
          {LANGUAGES.map((lang) => (
            <SelectItem
              key={lang.code}
              value={lang.code}
              className="text-xs py-2 cursor-pointer font-medium"
            >
              {lang.nativeName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
