/**
 * Unified SEO & Internationalization Metadata Engine
 * Generates accurate self-referencing canonical URLs, bidirectional hreflang links,
 * localized meta descriptions, Open Graph, Twitter Cards, and Schema.org JSON-LD.
 */

export type ViewRoute = "home" | "read" | "create" | "convert" | "faq";

export type SupportedLanguage =
  | "en"
  | "ja"
  | "zh-hans"
  | "zh-hant"
  | "fr"
  | "es"
  | "pt"
  | "ko"
  | "de"
  | "ar"
  | "ru"
  | "it";

export const BASE_URL = "https://ebookcc.com";

export interface SEOLanguageConfig {
  code: SupportedLanguage;
  urlPrefix: string;
  hreflang: string;
  locale: string;
  name: string;
  nativeName: string;
  dir: "ltr" | "rtl";
}

export const SEO_LANGUAGES: SEOLanguageConfig[] = [
  { code: "en", urlPrefix: "", hreflang: "en", locale: "en_US", name: "English", nativeName: "English", dir: "ltr" },
  { code: "ja", urlPrefix: "/ja", hreflang: "ja", locale: "ja_JP", name: "Japanese", nativeName: "日本語", dir: "ltr" },
  { code: "zh-hans", urlPrefix: "/zh-hans", hreflang: "zh-Hans", locale: "zh_CN", name: "Simplified Chinese", nativeName: "简体中文", dir: "ltr" },
  { code: "zh-hant", urlPrefix: "/zh-hant", hreflang: "zh-Hant", locale: "zh_TW", name: "Traditional Chinese", nativeName: "繁體中文", dir: "ltr" },
  { code: "fr", urlPrefix: "/fr", hreflang: "fr", locale: "fr_FR", name: "French", nativeName: "Français", dir: "ltr" },
  { code: "es", urlPrefix: "/es", hreflang: "es", locale: "es_ES", name: "Spanish", nativeName: "Español", dir: "ltr" },
  { code: "pt", urlPrefix: "/pt", hreflang: "pt", locale: "pt_BR", name: "Portuguese", nativeName: "Português", dir: "ltr" },
  { code: "ko", urlPrefix: "/ko", hreflang: "ko", locale: "ko_KR", name: "Korean", nativeName: "한국어", dir: "ltr" },
  { code: "de", urlPrefix: "/de", hreflang: "de", locale: "de_DE", name: "German", nativeName: "Deutsch", dir: "ltr" },
  { code: "ar", urlPrefix: "/ar", hreflang: "ar", locale: "ar_SA", name: "Arabic", nativeName: "العربية", dir: "rtl" },
  { code: "ru", urlPrefix: "/ru", hreflang: "ru", locale: "ru_RU", name: "Russian", nativeName: "Русский", dir: "ltr" },
  { code: "it", urlPrefix: "/it", hreflang: "it", locale: "it_IT", name: "Italian", nativeName: "Italiano", dir: "ltr" },
];

export const SEO_TITLES: Record<SupportedLanguage, Record<ViewRoute, string>> = {
  en: {
    home: "EBookCC | Ultimate All-in-One E-book & Comic Suite | AI Manga Translator",
    read: "Free Online Comic Reader & Manga Viewer | EBookCC Bookshelf",
    create: "Free Online Comic Maker, Manga Creator & Novel Writer | EBookCC",
    convert: "Universal E-book Converter | CBZ, CBR, PDF to EPUB Online | EBookCC",
    faq: "FAQ & Help Center | EBookCC Comic Suite & Converter Guides",
  },
  ja: {
    home: "EBookCC | オールインワン電子書籍＆マンガ作成・AI翻訳スイート",
    read: "無料オンラインマンガリーダー＆本棚ビューアー | EBookCC",
    create: "無料オンラインマンガ制作＆小説エディター | EBookCC",
    convert: "高機能電子書籍コンバーター | CBZ・PDFからEPUB変換 | EBookCC",
    faq: "よくある質問とヘルプセンター | EBookCC ガイド",
  },
  "zh-hans": {
    home: "EBookCC | 全方位电子书与漫画创作工具 | AI 漫画即时翻译",
    read: "免费在线漫画阅读器与个人书架 | EBookCC",
    create: "免费在线漫画绘制与小说创作编辑器 | EBookCC",
    convert: "万用电子书转换器 | CBZ、PDF 转 EPUB 在线工具 | EBookCC",
    faq: "常见问题与使用指南 | EBookCC 帮助中心",
  },
  "zh-hant": {
    home: "EBookCC | 全方位電子書與漫畫創作工具 | AI 漫畫即時翻譯",
    read: "免費線上漫畫閱讀器與個人書架 | EBookCC",
    create: "免費線上漫畫繪製與小說創作編輯器 | EBookCC",
    convert: "萬用電子書轉換器 | CBZ、PDF 轉 EPUB 線上工具 | EBookCC",
    faq: "常見問題與使用指南 | EBookCC 說明中心",
  },
  fr: {
    home: "EBookCC | Suite Complète E-book & Manga | Traducteur Manga IA",
    read: "Lecteur de Manga & BD en Ligne Gratuit | Bibliothèque EBookCC",
    create: "Créateur de BD & Manga en Ligne Gratuit | EBookCC",
    convert: "Convertisseur d'E-books Universel | CBZ, PDF vers EPUB | EBookCC",
    faq: "Centre d'Aide & FAQ | Guides EBookCC",
  },
  es: {
    home: "EBookCC | Suite Todo en Uno para E-books y Cómics | Traductor IA",
    read: "Lector de Cómics y Manga Gratis Online | Biblioteca EBookCC",
    create: "Creador de Cómics y Manga Online Gratis | EBookCC",
    convert: "Conversor Universal de E-books | CBZ, PDF a EPUB | EBookCC",
    faq: "Preguntas Frecuentes y Centro de Ayuda | EBookCC",
  },
  pt: {
    home: "EBookCC | Suíte Completa para E-books e Quadrinhos | Tradutor IA",
    read: "Leitor de Mangás e Quadrinhos Online Grátis | EBookCC",
    create: "Criador de Quadrinhos e Mangás Online Grátis | EBookCC",
    convert: "Conversor Universal de E-books | CBZ, PDF para EPUB | EBookCC",
    faq: "Perguntas Frequentes & Suporte | EBookCC",
  },
  ko: {
    home: "EBookCC | 올인원 전자책 & 만화 제작 스위트 | AI 만화 번역",
    read: "무료 온라인 만화 리더 & 서재 뷰어 | EBookCC",
    create: "무료 온라인 만화 제작 & 소설 편집기 | EBookCC",
    convert: "만능 전자책 변환기 | CBZ, PDF를 EPUB으로 변환 | EBookCC",
    faq: "자주 묻는 질문 및 고객 지원 | EBookCC",
  },
  de: {
    home: "EBookCC | All-in-One E-Book & Comic Suite | KI Manga Übersetzer",
    read: "Kostenloser Online Comic & Manga Reader | EBookCC Bücherregal",
    create: "Kostenloser Online Comic Maker & Roman-Editor | EBookCC",
    convert: "Universeller E-Book Konverter | CBZ, PDF zu EPUB | EBookCC",
    faq: "Häufig gestellte Fragen & Hilfe | EBookCC",
  },
  ar: {
    home: "EBookCC | منصة شاملة لإنشاء وقراءة المانجا والكتب الإلكترونية مع الترجمة بالذكاء الاصطناعي",
    read: "قارئ المانجا والقصص المصورة المجاني عبر الإنترنت | EBookCC",
    create: "صانع القصص المصورة والمانجا المجاني عبر الإنترنت | EBookCC",
    convert: "محول الكتب الإلكترونية الشامل | تحويل CBZ و PDF إلى EPUB | EBookCC",
    faq: "الأسئلة الشائعة ومركز المساعدة | EBookCC",
  },
  ru: {
    home: "EBookCC | Универсальный сервис для чтения, создания и перевода манги и комиксов с ИИ",
    read: "Бесплатная читалка манги и комиксов онлайн | Полка EBookCC",
    create: "Бесплатный онлайн-конструктор комиксов и редактор новелл | EBookCC",
    convert: "Универсальный конвертер электронных книг | Конвертация CBZ, PDF в EPUB | EBookCC",
    faq: "Часто задаваемые вопросы и руководство | EBookCC",
  },
  it: {
    home: "EBookCC | Suite Completa per E-book e Fumetti | Traduttore Manga IA",
    read: "Lettore di Fumetti e Manga Online Gratis | Libreria EBookCC",
    create: "Crea Fumetti e Manga Online Gratis | EBookCC",
    convert: "Convertitore Universale di E-book | Da CBZ, PDF a EPUB | EBookCC",
    faq: "Domande Frequenti e Centro Assistenza | EBookCC",
  },
};

export const SEO_DESCRIPTIONS: Record<SupportedLanguage, Record<ViewRoute, string>> = {
  en: {
    home: "Free Online Comic Book & Manga Creator, AI Translator, and eBook Converter. Plan custom comic layouts, localize dialogue with high-precision AI OCR, and export Kindle-ready EPUB files.",
    read: "Read manga, comics, EPUBs, and PDFs online with guided panel view, dark mode, high-res zoom, and instant bookshelf synchronization.",
    create: "Design custom multi-panel comic strips, speech bubbles, drawings, and write e-book novels online with AI assistance and EPUB export.",
    convert: "Batch convert CBZ, CBR, PDF, and EPUB files online with automatic OCR scanning, panel splitting, AI manga translation, and Kindle formatting.",
    faq: "Learn how to use EBookCC for manga translation, comic panel layout splitting, offline local processing, and converting archives into EPUB e-books.",
  },
  ja: {
    home: "完全無料のオンラインマンガ作成、AI翻訳、電子書籍変換ツール。コマ割りレイアウト、高精度AI OCRによる吹き出し翻訳、Kindle対応EPUB書き出しに対応。",
    read: "コマ順ガイド、ダークモード、高解像度ズーム、本棚同期を備えた高機能オンラインマンガ・電子書籍リーダー。",
    create: "複数コマのマンガ作成、吹き出し配置、手描きイラスト、AI文章生成による小説執筆が可能なオンラインエディター。",
    convert: "CBZ、CBR、PDF、EPUBの一括変換、自動OCRスキャン、コマ分割、AIマンガ翻訳をワンクリックで実行。",
    faq: "EBookCCの使い方、マンガ翻訳、コマ分割、オフライン処理、EPUB変換に関するよくある質問と解説。",
  },
  "zh-hans": {
    home: "免费在线漫画创作、AI 漫画翻译与电子书转换工具。自定义分镜排版、精准 AI OCR 气泡识别翻译，快速导出 Kindle 适用 EPUB 文件。",
    read: "支持引导式分镜阅读、深色模式、高画质缩放与个人书架同步的在线漫画与电子书阅读器。",
    create: "在线自定义多格分镜、对话气泡、手绘插图，并结合 AI 辅助撰写小说与脚本。",
    convert: "批量转换 CBZ、CBR、PDF 与 EPUB，自动 OCR 识别、漫画分格裁切与 AI 翻译。",
    faq: "探索 EBookCC 漫画翻译、分格裁切、离线安全处理与 EPUB 转换之常见问题与操作指南。",
  },
  "zh-hant": {
    home: "免費線上漫畫創作、AI 漫畫翻譯與電子書轉換工具。自訂分鏡版面、精準 AI OCR 氣泡辨識翻譯，快速匯出 Kindle 適用 EPUB 檔案。",
    read: "支援引導式分鏡閱讀、深色模式、高畫質縮放與個人書架同步的線上漫畫與電子書閱讀器。",
    create: "線上自訂多格分鏡、對話對話框、手繪插圖，並結合 AI 輔助撰寫小說與腳本。",
    convert: "批次轉換 CBZ、CBR、PDF 與 EPUB，自動 OCR 辨識、漫畫分格裁切與 AI 翻譯。",
    faq: "探索 EBookCC 漫畫翻譯、分格裁切、離線安全處理與 EPUB 轉換之常見問題與操作指南。",
  },
  fr: {
    home: "Outil gratuit en ligne de création de mangas et BD, traduction IA et conversion d'e-books. Export EPUB haute fidélité pour Kindle et liseuses.",
    read: "Lisez vos mangas, BD, EPUB et PDF en ligne avec lecture guidée case par case et synchronisation de bibliothèque.",
    create: "Concevez vos planches de BD, ajoutez des bulles de dialogue et écrivez vos romans en ligne avec assistance IA.",
    convert: "Convertissez facilement vos archives CBZ, CBR, PDF en EPUB optimisés pour toutes les liseuses.",
    faq: "Toutes les réponses pour maîtriser la traduction de manga, la découpe de cases et la conversion d'e-books sur EBookCC.",
  },
  es: {
    home: "Herramienta gratuita online para crear cómics y manga, traducir con IA y convertir e-books. Exporta archivos EPUB compatibles con Kindle.",
    read: "Lee manga, cómics, EPUBs y PDFs online con vista guiada viñeta a viñeta y modo oscuro.",
    create: "Diseña tiras cómicas de varios paneles, bocadillos de diálogo y escribe novelas con asistencia de IA.",
    convert: "Convierte archivos CBZ, CBR, PDF a EPUB con OCR automático y traducción inteligente.",
    faq: "Aprende a usar EBookCC para traducir manga, dividir viñetas y convertir cómics a EPUB.",
  },
  pt: {
    home: "Ferramenta online gratuita para criar quadrinhos e mangás, tradução com IA e conversor de e-books com exportação em EPUB para Kindle.",
    read: "Leia mangás, quadrinhos, EPUBs e PDFs online com leitura guiada painel a painel e modo escuro.",
    create: "Crie tiras de quadrinhos, balões de fala, ilustrações e escreva livros com inteligência artificial.",
    convert: "Converta CBZ, CBR, PDF em EPUB com OCR automático, divisão de painéis e tradução IA.",
    faq: "Tudo o que você precisa saber sobre tradução de mangá, divisão de painéis e conversão no EBookCC.",
  },
  ko: {
    home: "무료 온라인 만화 제작, AI 번역 및 전자책 변환 툴. 맞춤형 컷 레이아웃, 정밀 AI 말풍선 OCR 번역 및 킨들용 EPUB 내보내기 지원.",
    read: "컷별 가이드 뷰, 다크 모드, 고해상도 확대 및 서재 동기화를 지원하는 온라인 만화 리더.",
    create: "다양한 만화 컷 레이아웃 구성, 말풍선 삽입, 드로잉 및 AI 소설 작성 스튜디오.",
    convert: "CBZ, CBR, PDF, EPUB 일괄 변환, 자동 OCR 스캔 및 스마트 패널 분할.",
    faq: "EBookCC의 만화 번역, 패널 분할, 오프라인 보안 처리 및 전자책 변환에 대한 자주 묻는 질문.",
  },
  de: {
    home: "Kostenloses Online-Tool für Comic- & Manga-Erstellung, KI-Übersetzung und E-Book-Konvertierung mit EPUB-Export.",
    read: "Manga, Comics, EPUBs und PDFs online lesen mit Panel-Führung, Dunkelmodus und Bibliotheks-Synchronisation.",
    create: "Gestalten Sie individuelle Comic-Panels, Sprechblasen und schreiben Sie Romane mit KI-Unterstützung.",
    convert: "Konvertieren Sie CBZ-, CBR- und PDF-Dateien in Kindle-optimierte EPUB-eBooks.",
    faq: "Erfahren Sie alles über Manga-Übersetzung, Panel-Aufteilung und EPUB-Konvertierung mit EBookCC.",
  },
  ar: {
    home: "أداة مجانية عبر الإنترنت لإنشاء وقراءة وترجمة قصص المانجا والكوميكس بالذكاء الاصطناعي مع تحويل الكتب الإلكترونية إلى صيغة EPUB.",
    read: "اقرأ المانجا والقصص المصورة وكتب EPUB و PDF عبر الإنترنت مع عرض توجيهي مريح للعينين.",
    create: "صمم لوحات قصص مصورة متعددة، وأضف فقاعات حوارية، واكتب الروايات بالذكاء الاصطناعي.",
    convert: "تحويل دفعات ملفات CBZ و CBR و PDF إلى EPUB مع فحص OCR وتقسيم الإطارات تلقائياً.",
    faq: "تعرف على كيفية استخدام EBookCC لترجمة المانجا وتقسيم الإطارات وتحويل الملفات إلى كتب إلكترونية.",
  },
  ru: {
    home: "Бесплатный онлайн-инструмент для создания комиксов и манги, перевода с помощью ИИ и конвертации в EPUB для Kindle.",
    read: "Читайте мангу, комиксы, EPUB и PDF онлайн с покадровым просмотром, темной темой и удобной книжной полкой.",
    create: "Создавайте многопанельные комиксы, добавляйте облака диалогов и пишите рассказы с поддержкой ИИ.",
    convert: "Конвертируйте CBZ, CBR, PDF в EPUB с автоматическим распознаванием OCR и ИИ-переводом.",
    faq: "Ответы на частые вопросы по переводу манги, нарезке кадров и конвертации в EPUB на EBookCC.",
  },
  it: {
    home: "Suite online gratuita per creare e tradurre manga con IA e convertire e-book in formato EPUB compatibile con Kindle.",
    read: "Leggi manga, fumetti, EPUB e PDF online con visualizzazione guidata vignetta per vignetta e modalità scura.",
    create: "Progetta fumetti a più vignette, balloon di dialogo e scrivi romanzi con l'aiuto dell'intelligenza artificiale.",
    convert: "Converti file CBZ, CBR e PDF in EPUB con scansione OCR automatica e traduzione IA.",
    faq: "Tutte le informazioni sulla traduzione di manga, suddivisione delle vignette e conversione in e-book su EBookCC.",
  },
};

export interface RouteResolution {
  lang: SupportedLanguage;
  view: ViewRoute;
  canonicalPath: string;
  canonicalUrl: string;
  redirectTo?: string;
}

/**
 * Resolves any incoming path to its normalized language, view, canonical URL, and optional 301 redirect.
 */
export function resolveSEORoute(pathname: string): RouteResolution {
  const cleanPath = (pathname || "/").trim();
  const segments = cleanPath.split("/").filter(Boolean);

  // Root Homepage
  if (segments.length === 0) {
    return {
      lang: "en",
      view: "home",
      canonicalPath: "/",
      canonicalUrl: BASE_URL,
    };
  }

  const rawFirst = segments[0];
  const firstLower = rawFirst.toLowerCase();

  // 1. Check for legacy/uppercase/duplicate prefixes that need 301 redirect
  // - /en or /en/something -> 301 to / or /something
  if (firstLower === "en") {
    const sub = segments[1]?.toLowerCase() || "";
    let targetView: ViewRoute = "home";
    if (sub === "read" || sub === "create" || sub === "convert" || sub === "faq") {
      targetView = sub;
    }
    const targetPath = targetView === "home" ? "/" : `/${targetView}`;
    return {
      lang: "en",
      view: targetView,
      canonicalPath: targetPath,
      canonicalUrl: targetView === "home" ? BASE_URL : `${BASE_URL}${targetPath}`,
      redirectTo: targetPath,
    };
  }

  // - /jp -> /ja
  if (firstLower === "jp") {
    const sub = segments[1]?.toLowerCase() || "";
    let targetView: ViewRoute = "home";
    if (sub === "read" || sub === "create" || sub === "convert" || sub === "faq") {
      targetView = sub;
    }
    const targetPath = targetView === "home" ? "/ja" : `/ja/${targetView}`;
    return {
      lang: "ja",
      view: targetView,
      canonicalPath: targetPath,
      canonicalUrl: `${BASE_URL}${targetPath}`,
      redirectTo: targetPath,
    };
  }

  // - /zh-Hans, /zh-cn, /zh, /zh_cn, /zh_hans -> 301 to /zh-hans
  if (
    rawFirst === "zh-Hans" ||
    firstLower === "zh-cn" ||
    firstLower === "zh_cn" ||
    firstLower === "zh_hans" ||
    firstLower === "zh" ||
    firstLower === "zh-sg" ||
    firstLower === "zh_sg"
  ) {
    const sub = segments[1]?.toLowerCase() || "";
    let targetView: ViewRoute = "home";
    if (sub === "read" || sub === "create" || sub === "convert" || sub === "faq") {
      targetView = sub;
    }
    const targetPath = targetView === "home" ? "/zh-hans" : `/zh-hans/${targetView}`;
    return {
      lang: "zh-hans",
      view: targetView,
      canonicalPath: targetPath,
      canonicalUrl: `${BASE_URL}${targetPath}`,
      redirectTo: targetPath,
    };
  }

  // - /zh-Hant, /zh-tw, /zh-hk, /zh_tw, /zh_hk, /zh_hant -> 301 to /zh-hant
  if (
    rawFirst === "zh-Hant" ||
    firstLower === "zh-tw" ||
    firstLower === "zh_tw" ||
    firstLower === "zh-hk" ||
    firstLower === "zh_hk" ||
    firstLower === "zh_hant" ||
    firstLower === "zh-mo" ||
    firstLower === "zh_mo"
  ) {
    const sub = segments[1]?.toLowerCase() || "";
    let targetView: ViewRoute = "home";
    if (sub === "read" || sub === "create" || sub === "convert" || sub === "faq") {
      targetView = sub;
    }
    const targetPath = targetView === "home" ? "/zh-hant" : `/zh-hant/${targetView}`;
    return {
      lang: "zh-hant",
      view: targetView,
      canonicalPath: targetPath,
      canonicalUrl: `${BASE_URL}${targetPath}`,
      redirectTo: targetPath,
    };
  }

  // 2. Check if first segment is a standard non-English language prefix
  const matchedLang = SEO_LANGUAGES.find((l) => l.code !== "en" && l.code === firstLower);
  if (matchedLang) {
    const sub = segments[1]?.toLowerCase() || "";
    let view: ViewRoute = "home";
    if (sub === "read" || sub === "create" || sub === "convert" || sub === "faq") {
      view = sub;
    }
    const canonicalPath = view === "home" ? `/${matchedLang.code}` : `/${matchedLang.code}/${view}`;
    
    // Check if casing was wrong (e.g. /KO/faq or trailing slash)
    const normalizedInput = cleanPath.endsWith("/") && cleanPath.length > 1 ? cleanPath.slice(0, -1) : cleanPath;
    const shouldRedirect = cleanPath !== canonicalPath && cleanPath !== `/${matchedLang.code}/${view}` && normalizedInput !== canonicalPath;

    return {
      lang: matchedLang.code,
      view,
      canonicalPath,
      canonicalUrl: `${BASE_URL}${canonicalPath}`,
      redirectTo: shouldRedirect ? canonicalPath : undefined,
    };
  }

  // 3. Default English root route without prefix (e.g. /convert, /read, /create, /faq)
  let view: ViewRoute = "home";
  if (firstLower === "read" || firstLower === "create" || firstLower === "convert" || firstLower === "faq") {
    view = firstLower;
  }
  const canonicalPath = view === "home" ? "/" : `/${view}`;
  const shouldRedirect = cleanPath.endsWith("/") && cleanPath.length > 1;

  return {
    lang: "en",
    view,
    canonicalPath,
    canonicalUrl: view === "home" ? BASE_URL : `${BASE_URL}${canonicalPath}`,
    redirectTo: shouldRedirect ? canonicalPath : undefined,
  };
}

/**
 * Builds the canonical URL for any language and view.
 */
export function getCanonicalUrl(lang: SupportedLanguage, view: ViewRoute): string {
  if (lang === "en") {
    return view === "home" ? BASE_URL : `${BASE_URL}/${view}`;
  }
  return view === "home" ? `${BASE_URL}/${lang}` : `${BASE_URL}/${lang}/${view}`;
}

/**
 * Generates all 13 bidirectional hreflang links for a given view.
 */
export function generateHreflangLinks(view: ViewRoute): { hreflang: string; href: string }[] {
  const links: { hreflang: string; href: string }[] = [];

  // x-default always points to the clean root view URL (English default)
  links.push({
    hreflang: "x-default",
    href: getCanonicalUrl("en", view),
  });

  // All 12 supported languages
  for (const langConfig of SEO_LANGUAGES) {
    links.push({
      hreflang: langConfig.hreflang,
      href: getCanonicalUrl(langConfig.code, view),
    });
  }

  return links;
}

/**
 * Generates Schema.org JSON-LD graph.
 */
export function generateStructuredData(lang: SupportedLanguage, view: ViewRoute, canonicalUrl: string, description: string) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        "@id": `${BASE_URL}/#webapp`,
        name: "EbookCC",
        url: canonicalUrl,
        applicationCategory: "DesignApplication",
        operatingSystem: "All",
        browserRequirements: "Requires modern web browser",
        description,
        offers: {
          "@type": "Offer",
          price: "0.00",
          priceCurrency: "USD",
        },
        featureList: [
          "AI Manga OCR & Dialogue Translation Tool",
          "Interactive Speech Balloon Customizer",
          "CBZ, ZIP, PNG to EPUB Conversion",
          "Mobile-Optimized Guided Frame Splitter",
          "Secure Offline Processing Container Solutions",
        ],
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${canonicalUrl}#breadcrumbs`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: getCanonicalUrl(lang, "home"),
          },
          ...(view !== "home"
            ? [
                {
                  "@type": "ListItem",
                  position: 2,
                  name: view.charAt(0).toUpperCase() + view.slice(1),
                  item: canonicalUrl,
                },
              ]
            : []),
        ],
      },
      ...(view === "faq"
        ? [
            {
              "@type": "FAQPage",
              "@id": `${canonicalUrl}#faq`,
              mainEntity: [
                {
                  "@type": "Question",
                  name: "What is EbookCC?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "EbookCC is a free, open-source AI-powered workspace built to translate raw manga, design comic strip panels, and format them into digital eBooks like EPUB.",
                  },
                },
                {
                  "@type": "Question",
                  name: "Is EbookCC completely free to use?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Yes, EbookCC is 100% free with cloud translations and local offline deployment capabilities.",
                  },
                },
                {
                  "@type": "Question",
                  name: "What formats can I convert?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "You can convert CBZ, CBR, PDF, EPUB, DOCX, TXT, WEBP, and image archives into standard Kindle-compatible EPUB eBooks.",
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };
}

/**
 * Injects dynamic, high-precision SEO tags into an HTML template string.
 */
export function injectSEOMetadata(htmlTemplate: string, pathname: string): { html: string; resolution: RouteResolution } {
  const resolution = resolveSEORoute(pathname);
  const { lang, view, canonicalUrl } = resolution;

  const langConfig = SEO_LANGUAGES.find((l) => l.code === lang) || SEO_LANGUAGES[0];
  const title = SEO_TITLES[lang]?.[view] || SEO_TITLES.en[view];
  const description = SEO_DESCRIPTIONS[lang]?.[view] || SEO_DESCRIPTIONS.en[view];
  const hreflangLinks = generateHreflangLinks(view);
  const ogImage = `${BASE_URL}/logo.svg`;
  const structuredData = generateStructuredData(lang, view, canonicalUrl, description);

  // Build the complete head SEO block
  const seoHeadLines: string[] = [
    `    <title>${escapeHtml(title)}</title>`,
    `    <meta name="description" content="${escapeHtml(description)}" />`,
    `    <meta name="keywords" content="comic creator, manga translator, ai ocr manga, cbz to epub, convert comic to kindle, online ebook converter, read manga online, speech bubble editor" />`,
    `    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />`,
    `    <link rel="canonical" href="${canonicalUrl}" />`,
    ...hreflangLinks.map((l) => `    <link rel="alternate" hreflang="${l.hreflang}" href="${l.href}" />`),
    `    <meta property="og:title" content="${escapeHtml(title)}" />`,
    `    <meta property="og:description" content="${escapeHtml(description)}" />`,
    `    <meta property="og:url" content="${canonicalUrl}" />`,
    `    <meta property="og:type" content="website" />`,
    `    <meta property="og:site_name" content="EBookCC" />`,
    `    <meta property="og:image" content="${ogImage}" />`,
    `    <meta property="og:locale" content="${langConfig.locale}" />`,
    `    <meta name="twitter:card" content="summary_large_image" />`,
    `    <meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `    <meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `    <meta name="twitter:image" content="${ogImage}" />`,
    `    <script id="ebookcc-structured-data-jsonld" type="application/ld+json">\n${JSON.stringify(structuredData, null, 2)}\n    </script>`,
  ];

  const seoHeadBlock = seoHeadLines.join("\n");

  let modifiedHtml = htmlTemplate;

  // 1. Update <html lang="..." dir="...">
  modifiedHtml = modifiedHtml.replace(/<html[^>]*>/i, `<html lang="${langConfig.hreflang}" dir="${langConfig.dir}">`);

  // 2. Remove any existing static title, meta description, robots, canonical, hreflang, and json-ld
  modifiedHtml = modifiedHtml
    .replace(/<title>[\s\S]*?<\/title>/gi, "")
    .replace(/<meta\s+name=["']description["'][^>]*>/gi, "")
    .replace(/<meta\s+name=["']robots["'][^>]*>/gi, "")
    .replace(/<meta\s+name=["']keywords["'][^>]*>/gi, "")
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, "")
    .replace(/<link\s+rel=["']alternate["'][^>]*>/gi, "")
    .replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, "")
    .replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, "")
    .replace(/<script\s+id=["']ebookcc-structured-data-jsonld["'][^>]*>[\s\S]*?<\/script>/gi, "");

  // 3. Inject new SEO head block right after <head>
  modifiedHtml = modifiedHtml.replace(/<head>/i, `<head>\n${seoHeadBlock}`);

  return { html: modifiedHtml, resolution };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
