import { useEffect } from "react";
import {
  ViewRoute,
  SupportedLanguage,
  BASE_URL,
  SEO_LANGUAGES,
  SEO_TITLES,
  SEO_DESCRIPTIONS,
  getCanonicalUrl,
  generateHreflangLinks,
  generateStructuredData,
} from "@/seoMetadata";
import { LanguageCode } from "@/context/LanguageContext";

export type { ViewRoute };

interface SEOConfig {
  view: ViewRoute;
  language: LanguageCode;
  customTitle?: string;
  customDescription?: string;
  coverImage?: string;
}

/**
 * Normalizes any LanguageCode to SupportedLanguage
 */
export function normalizeLanguageCode(lang: LanguageCode): SupportedLanguage {
  const code = (lang || "en").toLowerCase();
  if (code === "ja" || code === "jp") return "ja";
  if (code === "zh-hant" || code === "zh-tw" || code === "zh-hk") return "zh-hant";
  if (code === "zh-hans" || code === "zh-cn" || code === "zh") return "zh-hans";
  if (
    code === "fr" ||
    code === "es" ||
    code === "pt" ||
    code === "ko" ||
    code === "de" ||
    code === "ar" ||
    code === "ru" ||
    code === "it"
  ) {
    return code;
  }
  return "en";
}

/**
 * Builds canonical URL for a given view and language.
 */
export function buildCanonicalUrl(language: LanguageCode, view: ViewRoute): string {
  const normalized = normalizeLanguageCode(language);
  return getCanonicalUrl(normalized, view);
}

/**
 * Builds root/default URL for a given view.
 */
export function buildRootUrl(view: ViewRoute): string {
  return getCanonicalUrl("en", view);
}

/**
 * React hook to synchronize all SEO elements in <head> during client-side navigation:
 * - <title>
 * - <meta name="description" content="...">
 * - <link rel="canonical" href="...">
 * - <link rel="alternate" hreflang="..." href="..."> (all 13 language variations)
 * - Open Graph tags
 * - Twitter Card tags
 * - Schema.org JSON-LD Structured Data
 */
export function usePageSEO({
  view,
  language,
  customTitle,
  customDescription,
  coverImage,
}: SEOConfig) {
  useEffect(() => {
    if (typeof document === "undefined") return;

    const normalizedLang = normalizeLanguageCode(language);
    const langConfig = SEO_LANGUAGES.find((l) => l.code === normalizedLang) || SEO_LANGUAGES[0];

    const title = customTitle || SEO_TITLES[normalizedLang]?.[view] || SEO_TITLES.en[view];
    const description = customDescription || SEO_DESCRIPTIONS[normalizedLang]?.[view] || SEO_DESCRIPTIONS.en[view];
    const canonicalUrl = getCanonicalUrl(normalizedLang, view);
    const ogImage = coverImage || `${BASE_URL}/logo.svg`;

    // 1. Update Document Title
    document.title = title;

    // 2. Update html lang and dir
    document.documentElement.lang = langConfig.hreflang;
    document.documentElement.dir = langConfig.dir;

    // 3. Helper for meta tags
    const setMetaTag = (attrName: "name" | "property", attrValue: string, content: string) => {
      let element = document.head.querySelector(`meta[${attrName}="${attrValue}"]`) as HTMLMetaElement | null;
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attrName, attrValue);
        document.head.appendChild(element);
      }
      element.setAttribute("content", content);
    };

    // 4. Meta Description, Robots & Keywords
    setMetaTag("name", "description", description);
    setMetaTag("name", "robots", "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1");
    setMetaTag("name", "keywords", "comic creator, manga translator, ai ocr manga, cbz to epub, convert comic to kindle, online ebook converter, read manga online, speech bubble editor");

    // 5. Open Graph Meta Tags
    setMetaTag("property", "og:title", title);
    setMetaTag("property", "og:description", description);
    setMetaTag("property", "og:url", canonicalUrl);
    setMetaTag("property", "og:type", "website");
    setMetaTag("property", "og:site_name", "EBookCC");
    setMetaTag("property", "og:image", ogImage);
    setMetaTag("property", "og:locale", langConfig.locale);

    // 6. Twitter Card Meta Tags
    setMetaTag("name", "twitter:card", "summary_large_image");
    setMetaTag("name", "twitter:title", title);
    setMetaTag("name", "twitter:description", description);
    setMetaTag("name", "twitter:image", ogImage);

    // 7. Canonical Tag Management (Always self-referencing and exact)
    let canonicalLink = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonicalLink) {
      canonicalLink = document.createElement("link");
      canonicalLink.setAttribute("rel", "canonical");
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute("href", canonicalUrl);

    // 8. Hreflang Alternate Tags Management
    const existingAlternates = document.head.querySelectorAll('link[rel="alternate"][hreflang]');
    existingAlternates.forEach((el) => el.remove());

    const hreflangLinks = generateHreflangLinks(view);
    hreflangLinks.forEach((l) => {
      const altLink = document.createElement("link");
      altLink.setAttribute("rel", "alternate");
      altLink.setAttribute("hreflang", l.hreflang);
      altLink.setAttribute("href", l.href);
      document.head.appendChild(altLink);
    });

    // 9. Structured Data JSON-LD
    let scriptJsonLd = document.getElementById("ebookcc-structured-data-jsonld") as HTMLScriptElement | null;
    if (!scriptJsonLd) {
      scriptJsonLd = document.createElement("script");
      scriptJsonLd.id = "ebookcc-structured-data-jsonld";
      scriptJsonLd.type = "application/ld+json";
      document.head.appendChild(scriptJsonLd);
    }

    const structuredData = generateStructuredData(normalizedLang, view, canonicalUrl, description);
    scriptJsonLd.textContent = JSON.stringify(structuredData, null, 2);
  }, [view, language, customTitle, customDescription, coverImage]);
}
