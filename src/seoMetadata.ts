/**
 * Unified SEO & Internationalization Metadata Engine
 * Generates accurate self-referencing canonical URLs, bidirectional hreflang links,
 * localized meta descriptions, Open Graph, Twitter Cards, and Schema.org JSON-LD.
 */

export type ViewRoute = "home" | "read" | "create" | "convert" | "faq" | "billing" | "ai";

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
    billing: "Billing & Prepaid Credits Wallet | EBookCC",
    ai: "AI Provider Settings & Model Engines | EBookCC",
  },
  ja: {
    home: "EBookCC | オールインワン電子書籍＆マンガ作成・AI翻訳スイート",
    read: "無料オンラインマンガリーダー＆本棚ビューアー | EBookCC",
    create: "無料オンラインマンガ制作＆小説エディター | EBookCC",
    convert: "高機能電子書籍コンバーター | CBZ・PDFからEPUB変換 | EBookCC",
    faq: "よくある質問とヘルプセンター | EBookCC ガイド",
    billing: "ウォレットとご利用料金 | EBookCC",
    ai: "AI プロバイダー・エンジン設定 | EBookCC",
  },
  "zh-hans": {
    home: "EBookCC | 全方位电子书与漫画创作工具 | AI 漫画即时翻译",
    read: "免费在线漫画阅读器与个人书架 | EBookCC",
    create: "免费在线漫画绘制与小说创作编辑器 | EBookCC",
    convert: "万用电子书转换器 | CBZ、PDF 转 EPUB 在线工具 | EBookCC",
    faq: "常见问题与使用指南 | EBookCC 帮助中心",
    billing: "账单与预付代币钱包 | EBookCC",
    ai: "AI 服务商与引擎设置 | EBookCC",
  },
  "zh-hant": {
    home: "EBookCC | 全方位電子書與漫畫創作工具 | AI 漫畫即時翻譯",
    read: "免費線上漫畫閱讀器與個人書架 | EBookCC",
    create: "免費線上漫畫繪製與小說創作編輯器 | EBookCC",
    convert: "萬用電子書轉換器 | CBZ、PDF 轉 EPUB 線上工具 | EBookCC",
    faq: "常見問題與使用指南 | EBookCC 說明中心",
    billing: "帳單與預付代幣錢包 | EBookCC",
    ai: "AI 服務商與引擎設定 | EBookCC",
  },
  fr: {
    home: "EBookCC | Suite Complète E-book & Manga | Traducteur Manga IA",
    read: "Lecteur de Manga & BD en Ligne Gratuit | Bibliothèque EBookCC",
    create: "Créateur de BD & Manga en Ligne Gratuit | EBookCC",
    convert: "Convertisseur d'E-books Universel | CBZ, PDF vers EPUB | EBookCC",
    faq: "Centre d'Aide & FAQ | Guides EBookCC",
    billing: "Facturation & Portefeuille de Crédits | EBookCC",
    ai: "Paramètres Fournisseurs d'IA | EBookCC",
  },
  es: {
    home: "EBookCC | Suite Todo en Uno para E-books y Cómics | Traductor IA",
    read: "Lector de Cómics y Manga Gratis Online | Biblioteca EBookCC",
    create: "Creador de Cómics y Manga Online Gratis | EBookCC",
    convert: "Conversor Universal de E-books | CBZ, PDF a EPUB | EBookCC",
    faq: "Preguntas Frecuentes y Centro de Ayuda | EBookCC",
    billing: "Facturación y Saldo Prepago | EBookCC",
    ai: "Ajustes de Proveedores de IA | EBookCC",
  },
  pt: {
    home: "EBookCC | Suíte Completa para E-books e Quadrinhos | Tradutor IA",
    read: "Leitor de Mangás e Quadrinhos Online Grátis | EBookCC",
    create: "Criador de Quadrinhos e Mangás Online Grátis | EBookCC",
    convert: "Conversor Universal de E-books | CBZ, PDF para EPUB | EBookCC",
    faq: "Perguntas Frequentes & Suporte | EBookCC",
    billing: "Cobrança & Saldo Pré-pago | EBookCC",
    ai: "Configuração de Provedores de IA | EBookCC",
  },
  ko: {
    home: "EBookCC | 올인원 전자책 & 만화 제작 스위트 | AI 만화 번역",
    read: "무료 온라인 만화 리더 & 서재 뷰어 | EBookCC",
    create: "무료 온라인 만화 제작 & 소설 편집기 | EBookCC",
    convert: "만능 전자책 변환기 | CBZ, PDF를 EPUB으로 변환 | EBookCC",
    faq: "자주 묻는 질문 및 고객 지원 | EBookCC",
    billing: "결제 및 선불 크레딧 지갑 | EBookCC",
    ai: "AI 제공업체 및 모델 설정 | EBookCC",
  },
  de: {
    home: "EBookCC | All-in-One E-Book & Comic Suite | KI Manga Übersetzer",
    read: "Kostenloser Online Comic & Manga Reader | EBookCC Bücherregal",
    create: "Kostenloser Online Comic Maker & Roman-Editor | EBookCC",
    convert: "Universeller E-Book Konverter | CBZ, PDF zu EPUB | EBookCC",
    faq: "Häufig gestellte Fragen & Hilfe | EBookCC",
    billing: "Abrechnung & Guthaben-Wallet | EBookCC",
    ai: "KI-Anbieter und Modell-Einstellungen | EBookCC",
  },
  ar: {
    home: "EBookCC | منصة شاملة لإنشاء وقراءة المانجا والكتب الإلكترونية مع الترجمة بالذكاء الاصطناعي",
    read: "قارئ المانجا والقصص المصورة المجاني عبر الإنترنت | EBookCC",
    create: "صانع القصص المصورة والمانجا المجاني عبر الإنترنت | EBookCC",
    convert: "محول الكتب الإلكترونية الشامل | تحويل CBZ و PDF إلى EPUB | EBookCC",
    faq: "الأسئلة الشائعة ومركز المساعدة | EBookCC",
    billing: "الفواتير ومحفظة الرصيد المدفوع مسبقاً | EBookCC",
    ai: "إعدادات مزودي الذكاء الاصطناعي | EBookCC",
  },
  ru: {
    home: "EBookCC | Универсальный сервис для чтения, создания и перевода манги и комиксов с ИИ",
    read: "Бесплатная читалка манги и комиксов онлайн | Полка EBookCC",
    create: "Бесплатный онлайн-конструктор комиксов и редактор новелл | EBookCC",
    convert: "Универсальный конвертер электронных книг | Конвертация CBZ, PDF в EPUB | EBookCC",
    faq: "Часто задаваемые вопросы и руководство | EBookCC",
    billing: "Биллинг и предоплаченный баланс | EBookCC",
    ai: "Настройки провайдеров и моделей ИИ | EBookCC",
  },
  it: {
    home: "EBookCC | Suite Completa per E-book e Fumetti | Traduttore Manga IA",
    read: "Lettore di Fumetti e Manga Online Gratis | Libreria EBookCC",
    create: "Crea Fumetti e Manga Online Gratis | EBookCC",
    convert: "Convertitore Universale di E-book | Da CBZ, PDF a EPUB | EBookCC",
    faq: "Domande Frequenti e Centro Assistenza | EBookCC",
    billing: "Fatturazione e Saldo Prepagato | EBookCC",
    ai: "Impostazioni Fornitori IA | EBookCC",
  },
};

export const SEO_DESCRIPTIONS: Record<SupportedLanguage, Record<ViewRoute, string>> = {
  en: {
    home: "Free Online Comic Book & Manga Creator, AI Translator, and eBook Converter. Plan custom comic layouts, localize dialogue with high-precision AI OCR, and export Kindle-ready EPUB files.",
    read: "Read manga, comics, EPUBs, and PDFs online with guided panel view, dark mode, high-res zoom, and instant bookshelf synchronization.",
    create: "Design custom multi-panel comic strips, speech bubbles, drawings, and write e-book novels online with AI assistance and EPUB export.",
    convert: "Batch convert CBZ, CBR, PDF, and EPUB files online with automatic OCR scanning, panel splitting, AI manga translation, and Kindle formatting.",
    faq: "Learn how to use EBookCC for manga translation, comic panel layout splitting, offline local processing, and converting archives into EPUB e-books.",
    billing: "Manage your prepaid AI credits wallet, view transparent usage history, set monthly spending limits, and add funds easily.",
    ai: "Configure multi-pipeline AI settings for OCR, Vision, TTS, Text-to-Image, Director, Music, SFX, and custom encrypted API keys.",
  },
  ja: {
    home: "完全無料のオンラインマンガ作成、AI翻訳、電子書籍変換ツール。コマ割りレイアウト、高精度AI OCRによる吹き出し翻訳、Kindle対応EPUB書き出しに対応。",
    read: "コマ順ガイド、ダークモード、高解像度ズーム、本棚同期を備えた高機能オンラインマンガ・電子書籍リーダー。",
    create: "複数コマのマンガ作成、吹き出し配置、手描きイラスト、AI文章生成による小説執筆が可能なオンラインエディター。",
    convert: "CBZ、CBR、PDF、EPUBの一括変換、自動OCRスキャン、コマ分割、AIマンガ翻訳をワンクリックで実行。",
    faq: "EBookCCの使い方、マンガ翻訳、コマ分割、オフライン処理、EPUB変換に関するよくある質問と解説。",
    billing: "プリペイドウォレット残高、利用履歴、月間上限設定、チャージ機能の管理ダッシュボード。",
    ai: "OCR、視覚解析、TTS音声、画像生成、監督、BGM、効果音、ストレージのAIエンジンとAPIキー設定。",
  },
  "zh-hans": {
    home: "免费在线漫画创作、AI 漫画翻译与电子书转换工具。自定义分镜排版、精准 AI OCR 气泡识别翻译，快速导出 Kindle 适用 EPUB 文件。",
    read: "支持引导式分镜阅读、深色模式、高画质缩放与个人书架同步的在线漫画与电子书阅读器。",
    create: "在线自定义多格分镜、对话气泡、手绘插图，并结合 AI 辅助撰写小说与脚本。",
    convert: "批量转换 CBZ、CBR、PDF 与 EPUB，自动 OCR 识别、漫画分格裁切与 AI 翻译。",
    faq: "探索 EBookCC 漫画翻译、分格裁切、离线安全处理与 EPUB 转换之常见问题与操作指南。",
    billing: "管理预付代币余额、透明账单流水、月度消费上限以及一键充值。",
    ai: "多通道 AI 引擎配置：OCR识别、视觉分析、TTS语音合成、生图、导演、音乐音效与加密密钥管理。",
  },
  "zh-hant": {
    home: "免費線上漫畫創作、AI 漫畫翻譯與電子書轉換工具。自訂分鏡版面、精準 AI OCR 氣泡辨識翻譯，快速匯出 Kindle 適用 EPUB 檔案。",
    read: "支援引導式分鏡閱讀、深色模式、高畫質縮放與個人書架同步的線上漫畫與電子書閱讀器。",
    create: "線上自訂多格分鏡、對話對話框、手繪插圖，並結合 AI 輔助撰寫小說與腳本。",
    convert: "批次轉換 CBZ、CBR、PDF 與 EPUB，自動 OCR 辨識、漫畫分格裁切與 AI 翻譯。",
    faq: "探索 EBookCC 漫畫翻譯、分格裁切、離線安全處理與 EPUB 轉換之常見問題與操作指南。",
    billing: "管理預付代幣餘額、透明帳單明細、月度支出上限及快速加值。",
    ai: "多通道 AI 引擎設定：OCR辨識、視覺分析、TTS語音合成、生圖、導演、音樂音效與加密金鑰管理。",
  },
  fr: {
    home: "Outil gratuit en ligne de création de mangas et BD, traduction IA et conversion d'e-books. Export EPUB haute fidélité pour Kindle et liseuses.",
    read: "Lisez vos mangas, BD, EPUB et PDF en ligne avec lecture guidée case par case et synchronisation de bibliothèque.",
    create: "Concevez vos planches de BD, ajoutez des bulles de dialogue et écrivez vos romans en ligne avec assistance IA.",
    convert: "Convertissez facilement vos archives CBZ, CBR, PDF en EPUB optimisés pour toutes les liseuses.",
    faq: "Toutes les réponses pour maîtriser la traduction de manga, la découpe de cases et la conversion d'e-books sur EBookCC.",
    billing: "Gérez votre portefeuille de crédits prépayés, l'historique d'utilisation et les limites mensuelles de dépenses.",
    ai: "Configurez les pipelines d'IA pour OCR, synthèse vocale, génération d'images, réalisation, musique et vos clés API.",
  },
  es: {
    home: "Herramienta gratuita online para crear cómics y manga, traducir con IA y convertir e-books. Exporta archivos EPUB compatibles con Kindle.",
    read: "Lee manga, cómics, EPUBs y PDFs online con vista guiada viñeta a viñeta y modo oscuro.",
    create: "Diseña tiras cómicas de varios paneles, bocadillos de diálogo y escribe novelas con asistencia de IA.",
    convert: "Convierte archivos CBZ, CBR, PDF a EPUB con OCR automático y traducción inteligente.",
    faq: "Aprende a usar EBookCC para traducir manga, dividir viñetas y convertir cómics a EPUB.",
    billing: "Administra tu billetera prepago de créditos, historial detallado de consumo y límites mensuales.",
    ai: "Configuración integral de IA: OCR, visión, TTS, imagen, director, música, efectos y claves cifradas.",
  },
  pt: {
    home: "Ferramenta online gratuita para criar quadrinhos e mangás, tradução com IA e conversor de e-books com exportação em EPUB para Kindle.",
    read: "Leia mangás, quadrinhos, EPUBs e PDFs online com leitura guiada painel a painel e modo escuro.",
    create: "Crie tiras de quadrinhos, balões de fala, ilustrações e escreva livros com inteligência artificial.",
    convert: "Converta CBZ, CBR, PDF em EPUB com OCR automático, divisão de painéis e tradução IA.",
    faq: "Tudo o que você precisa saber sobre tradução de mangá, divisão de painéis e conversão no EBookCC.",
    billing: "Gerencie sua carteira pré-paga de créditos, histórico de consumo e limite mensal de gastos.",
    ai: "Configurações de IA para OCR, voz, imagens, diretor, música, efeitos sonoros e chaves seguras.",
  },
  ko: {
    home: "무료 온라인 만화 제작, AI 번역 및 전자책 변환 툴. 맞춤형 컷 레이아웃, 정밀 AI 말풍선 OCR 번역 및 킨들용 EPUB 내보내기 지원.",
    read: "컷별 가이드 뷰, 다크 모드, 고해상도 확대 및 서재 동기화를 지원하는 온라인 만화 리더.",
    create: "다양한 만화 컷 레이아웃 구성, 말풍선 삽입, 드로잉 및 AI 소설 작성 스튜디오.",
    convert: "CBZ, CBR, PDF, EPUB 일괄 변환, 자동 OCR 스캔 및 스마트 패널 분할.",
    faq: "EBookCC의 만화 번역, 패널 분할, 오프라인 보안 처리 및 전자책 변환에 대한 자주 묻는 질문.",
    billing: "선불 크레딧 지갑 잔액 관리, 투명한 사용 내역 조회 및 월간 지출 한도 설정.",
    ai: "OCR, 음성합성, 이미지 생성, 디렉터, 음악/효과음 등 파이프라인별 AI 설정 및 암호화 키 관리.",
  },
  de: {
    home: "Kostenloses Online-Tool für Comic- & Manga-Erstellung, KI-Übersetzung und E-Book-Konvertierung mit EPUB-Export.",
    read: "Manga, Comics, EPUBs und PDFs online lesen mit Panel-Führung, Dunkelmodus und Bibliotheks-Synchronisation.",
    create: "Gestalten Sie individuelle Comic-Panels, Sprechblasen und schreiben Sie Romane mit KI-Unterstützung.",
    convert: "Konvertieren Sie CBZ-, CBR- und PDF-Dateien in Kindle-optimierte EPUB-eBooks.",
    faq: "Erfahren Sie alles über Manga-Übersetzung, Panel-Aufteilung und EPUB-Konvertierung mit EBookCC.",
    billing: "Prepaid-Guthaben verwalten, transparente Nutzungshistorie und monatliches Ausgabenlimit anpassen.",
    ai: "Multi-Pipeline KI-Einstellungen für OCR, Sprachausgabe, Bildgenerierung, Musik, SFX und eigene API-Keys.",
  },
  ar: {
    home: "أداة مجانية عبر الإنترنت لإنشاء وقراءة وترجمة قصص المانجا والكوميكس بالذكاء الاصطناعي مع تحويل الكتب الإلكترونية إلى صيغة EPUB.",
    read: "اقرأ المانجا والقصص المصورة وكتب EPUB و PDF عبر الإنترنت مع عرض توجيهي مريح للعينين.",
    create: "صمم لوحات قصص مصورة متعددة، وأضف فقاعات حوارية، واكتب الروايات بالذكاء الاصطناعي.",
    convert: "تحويل دفعات ملفات CBZ و CBR و PDF إلى EPUB مع فحص OCR وتقسيم الإطارات تلقائياً.",
    faq: "تعرف على كيفية استخدام EBookCC لترجمة المانجا وتقسيم الإطارات وتحويل الملفات إلى كتب إلكترونية.",
    billing: "إدارة رصيد المحفظة المدفوعة مسبقاً وسجل الاستخدام الشفاف وتحديد الحد الشهري للإنفاق.",
    ai: "إعدادات مزودي الذكاء الاصطناعي لمختلف المسارات من OCR ونطق صوتي وتوليد صور وموسيقى وإدارة المفاتيح المشفرة.",
  },
  ru: {
    home: "Бесплатный онлайн-инструмент для создания комиксов и манги, перевода с помощью ИИ и конвертации в EPUB для Kindle.",
    read: "Читайте мангу, комиксы, EPUB и PDF онлайн с покадровым просмотром, темной темой и удобной книжной полкой.",
    create: "Создавайте многопанельные комиксы, добавляйте облака диалогов и пишите рассказы с поддержкой ИИ.",
    convert: "Конвертируйте CBZ, CBR, PDF в EPUB с автоматическим распознаванием OCR и ИИ-переводом.",
    faq: "Ответы на частые вопросы по переводу манги, нарезке кадров и конвертации в EPUB на EBookCC.",
    billing: "Управление предоплаченным кошельком кредитов, прозрачная история списаний и лимиты расходов.",
    ai: "Настройка ИИ пайплайнов для OCR, синтеза речи, генерации изображений, музыки и зашифрованных ключей.",
  },
  it: {
    home: "Suite online gratuita per creare e tradurre manga con IA e convertire e-book in formato EPUB compatibile con Kindle.",
    read: "Leggi manga, fumetti, EPUB e PDF online con visualizzazione guidata vignetta per vignetta e modalità scura.",
    create: "Progetta fumetti a più vignette, balloon di dialogo e scrivi romanzi con l'aiuto dell'intelligenza artificiale.",
    convert: "Converti file CBZ, CBR e PDF in EPUB con scansione OCR automatica e traduzione IA.",
    faq: "Tutte le informazioni sulla traduzione di manga, suddivisione delle vignette e conversione in e-book su EBookCC.",
    billing: "Gestione del portafoglio crediti prepagato, storico transazioni e limiti mensili di spesa.",
    ai: "Impostazioni avanzate IA per OCR, sintesi vocale, generazione immagini, audio e chiavi API crittografate.",
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

  const parseViewSeg = (seg: string | undefined): ViewRoute => {
    const s = seg?.toLowerCase() || "";
    if (s === "read" || s === "create" || s === "convert" || s === "faq" || s === "billing" || s === "ai") {
      return s as ViewRoute;
    }
    return "home";
  };

  // 1. Check for legacy/uppercase/duplicate prefixes that need 301 redirect
  // - /en or /en/something -> 301 to / or /something
  if (firstLower === "en") {
    const targetView = parseViewSeg(segments[1]);
    const targetPath = targetView === "home" ? "/" : targetView === "ai" ? "/AI" : `/${targetView}`;
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
    const targetView = parseViewSeg(segments[1]);
    const targetPath = targetView === "home" ? "/ja" : targetView === "ai" ? "/ja/AI" : `/ja/${targetView}`;
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
    const targetView = parseViewSeg(segments[1]);
    const targetPath = targetView === "home" ? "/zh-hans" : targetView === "ai" ? "/zh-hans/AI" : `/zh-hans/${targetView}`;
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
    const targetView = parseViewSeg(segments[1]);
    const targetPath = targetView === "home" ? "/zh-hant" : targetView === "ai" ? "/zh-hant/AI" : `/zh-hant/${targetView}`;
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
    const view = parseViewSeg(segments[1]);
    const canonicalPath = view === "home" ? `/${matchedLang.code}` : view === "ai" ? `/${matchedLang.code}/AI` : `/${matchedLang.code}/${view}`;
    const shouldRedirect = cleanPath !== canonicalPath && cleanPath.toLowerCase() !== canonicalPath.toLowerCase();

    return {
      lang: matchedLang.code,
      view,
      canonicalPath,
      canonicalUrl: `${BASE_URL}${canonicalPath}`,
      redirectTo: shouldRedirect ? canonicalPath : undefined,
    };
  }

  // 3. Default English root route without prefix (e.g. /convert, /read, /create, /faq, /billing, /AI)
  const view = parseViewSeg(rawFirst);
  const canonicalPath = view === "home" ? "/" : view === "ai" ? "/AI" : `/${view}`;
  // Accept both /AI and /ai without redirect loop
  const shouldRedirect = cleanPath !== canonicalPath && !(view === "ai" && (cleanPath === "/AI" || cleanPath === "/ai"));

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

  // 4. Inject rich, accessible, semantic SSR snapshot inside <div id="root"> to prevent Soft 404
  const prerenderedBody = generatePrerenderedHTML(lang, view);
  modifiedHtml = modifiedHtml.replace(
    /<div\s+id=["']root["'][^>]*>[\s\S]*?<\/div>/i,
    `<div id="root">${prerenderedBody}</div>`
  );

  return { html: modifiedHtml, resolution };
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Generates rich semantic HTML snapshot for search engine crawlers and instant first contentful paint.
 * Solves "Soft 404" errors by ensuring Googlebot always sees relevant, indexable text matching the URL.
 */
export function generatePrerenderedHTML(lang: SupportedLanguage, view: ViewRoute): string {
  const homeUrl = lang === "en" ? "/" : `/${lang}`;
  const readUrl = lang === "en" ? "/read" : `/${lang}/read`;
  const createUrl = lang === "en" ? "/create" : `/${lang}/create`;
  const convertUrl = lang === "en" ? "/convert" : `/${lang}/convert`;
  const faqUrl = lang === "en" ? "/faq" : `/${lang}/faq`;

  const navLabels: Record<SupportedLanguage, { home: string; read: string; create: string; convert: string; faq: string; tag: string }> = {
    en: { home: "Home", read: "Manga & Book Reader", create: "Comic & Novel Creator", convert: "E-book Converter", faq: "FAQ & Help", tag: "All-in-One Comic & E-book Suite" },
    ko: { home: "홈", read: "만화 리더", create: "만화 & 소설 제작", convert: "전자책 변환기", faq: "자주 묻는 질문", tag: "만화 제작 & 전자책 변환 스튜디오" },
    ja: { home: "ホーム", read: "マンガリーダー", create: "マンガ・小説制作", convert: "電子書籍変換", faq: "よくある質問", tag: "電子書籍＆マンガスイート" },
    "zh-hans": { home: "首页", read: "漫画阅读器", create: "漫画与小说创作", convert: "电子书转换器", faq: "常见问题", tag: "电子书与漫画创作平台" },
    "zh-hant": { home: "首頁", read: "漫畫閱讀器", create: "漫畫與小說創作", convert: "電子書轉換器", faq: "常見問題", tag: "電子書與漫畫創作平台" },
    fr: { home: "Accueil", read: "Lecteur BD", create: "Créateur BD & Roman", convert: "Convertisseur", faq: "FAQ & Aide", tag: "Suite BD & E-books en Ligne" },
    es: { home: "Inicio", read: "Lector Cómic", create: "Creador Cómic", convert: "Conversor", faq: "Preguntas Frecuentes", tag: "Suite de Cómics y E-books" },
    pt: { home: "Início", read: "Leitor", create: "Criador de Quadrinhos", convert: "Conversor", faq: "Perguntas Frecuentes", tag: "Suíte de E-books e Mangás" },
    de: { home: "Startseite", read: "Comic Reader", create: "Comic Studio", convert: "E-Book Konverter", faq: "FAQ & Hilfe", tag: "E-Book & Comic Suite" },
    ar: { home: "الرئيسية", read: "قارئ المانجا", create: "استوديو القصص المصورة", convert: "محول الكتب", faq: "الأسئلة الشائعة", tag: "منصة الكتب والمانجا" },
    ru: { home: "Главная", read: "Читалка манги", create: "Студия комиксов", convert: "Конвертер", faq: "FAQ", tag: "Студия комиксов и электронных книг" },
    it: { home: "Home", read: "Lettore Manga", create: "Crea Fumetti", convert: "Convertitore", faq: "Domande Frequenti", tag: "Suite Fumetti ed E-book" },
  };

  const nav = navLabels[lang] || navLabels.en;
  const pageTitle = SEO_TITLES[lang]?.[view] || SEO_TITLES.en[view];
  const pageDesc = SEO_DESCRIPTIONS[lang]?.[view] || SEO_DESCRIPTIONS.en[view];

  let mainBody = "";

  if (view === "create") {
    if (lang === "ko") {
      mainBody = `
        <article class="seo-article">
          <nav aria-label="Breadcrumb" class="seo-breadcrumb">
            <a href="${homeUrl}">${nav.home}</a> &gt; <span>${nav.create}</span>
          </nav>
          <h1>무료 온라인 만화 제작 &amp; 소설 편집기 | EBookCC</h1>
          <p class="seo-lead">${escapeHtml(pageDesc)}</p>

          <section class="seo-section">
            <h2>핵심 제작 기능 및 창작 도구</h2>
            <div class="seo-grid">
              <div class="seo-card">
                <h3>🎨 맞춤형 만화 컷 레이아웃 빌더 (Comic Panel Builder)</h3>
                <p>2x2, 1x3, 4컷 만화(4koma), 웹툰 세로 스크롤 레이아웃 및 컷 크기/간격을 자유롭게 조절할 수 있습니다. 템플릿을 선택하거나 빈 캔버스에서 나만의 만화를 그려보세요.</p>
              </div>
              <div class="seo-card">
                <h3>💬 스마트 말풍선 &amp; 대사 엔진 (Speech Bubble Engine)</h3>
                <p>대화, 생각, 외침 등 다양한 스타일의 말풍선 배치와 꼬리 회전, 폰트 및 배경색 커스터마이징을 지원합니다. 가로쓰기와 세로쓰기 대사 입력이 모두 가능합니다.</p>
              </div>
              <div class="seo-card">
                <h3>🌐 AI 만화 번역 &amp; 스마트 OCR (AI Comic Translation)</h3>
                <p>외국어 원본 만화 이미지 속 대사를 자동 스캔하여 깨끗하게 제거(인페인팅)하고 자연스러운 한국어 대사로 즉시 번역하여 채워 넣습니다.</p>
              </div>
              <div class="seo-card">
                <h3>✍️ 소설 &amp; 웹소설 작성 스튜디오 (Novel &amp; Story Editor)</h3>
                <p>챕터별 구성, 서식 지정, 자동 들여쓰기, 실시간 단어수 측정 및 집중 집필 모드를 제공합니다. 삽화 일러스트와 텍스트를 함께 배치할 수 있습니다.</p>
              </div>
              <div class="seo-card">
                <h3>📱 킨들 및 표준 전자책 내보내기 (Kindle &amp; EPUB Export)</h3>
                <p>Amazon Send to Kindle 규격을 완벽 준수하는 표준 EPUB3 파일과 고해상도 PDF, CBZ 이미지 압축 파일을 원클릭으로 무료 생성합니다.</p>
              </div>
            </div>
          </section>

          <section class="seo-section">
            <h2>만화 및 전자책 제작 가이드 (4단계)</h2>
            <ol class="seo-steps">
              <li><strong>1단계: 템플릿 선택:</strong> 단일 컷, 4컷 만화, 웹툰 스크롤 또는 빈 캔버스 중 원하는 형식을 선택합니다.</li>
              <li><strong>2단계: 아트워크 삽입 및 드로잉:</strong> 로컬 이미지 파일을 드래그앤드롭하거나 브러시 도구로 스케치합니다.</li>
              <li><strong>3단계: 말풍선 배치 및 대사 입력:</strong> 캐릭터 위치에 맞추어 말풍선을 추가하고 글꼴과 효과를 지정합니다.</li>
              <li><strong>4단계: 전자책 다운로드:</strong> 킨들용 EPUB, 고화질 PDF 또는 CBZ 포맷으로 즉시 저장합니다.</li>
            </ol>
          </section>

          <section class="seo-section">
            <h2>지원 파일 형식 (Formats)</h2>
            <p><strong>가져오기 (Import):</strong> PNG, JPG, JPEG, WEBP, GIF, SVG, TXT, DOCX, CBZ, CBR, PDF</p>
            <p><strong>내보내기 (Export):</strong> 표준 EPUB3 (Kindle 최적화), 인쇄용 고해상도 PDF, CBZ (만화 압축), ZIP</p>
          </section>

          <section class="seo-section">
            <h2>자주 묻는 질문 (FAQ)</h2>
            <div class="seo-faq-item">
              <h3>Q: EBookCC 만화 제작기는 무료인가요?</h3>
              <p>A: 네, EBookCC의 모든 만화 컷 제작, 말풍선 편집, 소설 작성 및 EPUB 내보내기 기능은 100% 무료이며 별도의 설치 없이 브라우저에서 바로 사용할 수 있습니다.</p>
            </div>
            <div class="seo-faq-item">
              <h3>Q: 킨들(Kindle)에서 바로 읽을 수 있는 파일로 저장되나요?</h3>
              <p>A: 네, 생성된 EPUB 파일은 Amazon Send to Kindle 및 전자책 단말기 표준 사양을 완벽히 충족합니다.</p>
            </div>
            <div class="seo-faq-item">
              <h3>Q: 작업 중인 데이터는 안전하게 보관되나요?</h3>
              <p>A: 모든 데이터는 브라우저 로컬 저장소 및 사용자의 Google Drive 클라우드 백업을 통해 안전하게 보관됩니다.</p>
            </div>
          </section>
        </article>
      `;
    } else {
      mainBody = `
        <article class="seo-article">
          <nav aria-label="Breadcrumb" class="seo-breadcrumb">
            <a href="${homeUrl}">${nav.home}</a> &gt; <span>${nav.create}</span>
          </nav>
          <h1>${escapeHtml(pageTitle)}</h1>
          <p class="seo-lead">${escapeHtml(pageDesc)}</p>

          <section class="seo-section">
            <h2>Core Comic &amp; Novel Creation Features</h2>
            <div class="seo-grid">
              <div class="seo-card">
                <h3>🎨 Comic &amp; Manga Panel Layout Builder</h3>
                <p>Create custom grids, 4koma strips, and vertical webtoon formats. Adjust panel borders, spacing, and canvas sizes with intuitive drag-and-drop tools.</p>
              </div>
              <div class="seo-card">
                <h3>💬 Smart Speech Bubble Engine</h3>
                <p>Insert speech, thought, shout, and whisper bubbles. Fully customize tail directions, font families, typography, and background fills.</p>
              </div>
              <div class="seo-card">
                <h3>🌐 AI Comic Translation &amp; OCR Inpainting</h3>
                <p>Automatically detect dialogue text in foreign manga panels, erase original text with seamless inpainting, and replace it with accurate translations.</p>
              </div>
              <div class="seo-card">
                <h3>✍️ Rich Text Novel &amp; Story Studio</h3>
                <p>Organize chapters, format prose, track word counts, and combine narrative text with comic illustrations in a distraction-free writing environment.</p>
              </div>
              <div class="seo-card">
                <h3>📱 Kindle &amp; Standard EPUB Export</h3>
                <p>Export your finished comics, manga, and novels into Amazon Send-to-Kindle compliant EPUB3, high-definition PDF, and CBZ archives.</p>
              </div>
            </div>
          </section>

          <section class="seo-section">
            <h2>How to Create Comics &amp; E-books Online</h2>
            <ol class="seo-steps">
              <li><strong>Step 1: Choose Layout:</strong> Pick a panel template, webtoon strip, or start with a custom blank canvas.</li>
              <li><strong>Step 2: Add Artwork &amp; Draw:</strong> Upload illustrations or sketch directly using responsive drawing tools.</li>
              <li><strong>Step 3: Add Speech Bubbles:</strong> Position bubbles and type your dialogue with custom fonts and tail pointers.</li>
              <li><strong>Step 4: Export to EPUB:</strong> Download your finished book in EPUB3, PDF, or CBZ format for Kindle and e-readers.</li>
            </ol>
          </section>

          <section class="seo-section">
            <h2>Supported Specifications &amp; Formats</h2>
            <p><strong>Input:</strong> PNG, JPG, WEBP, GIF, SVG, TXT, DOCX, CBZ, CBR, PDF</p>
            <p><strong>Export:</strong> Standard EPUB3 (Kindle optimized), Print-Ready PDF, CBZ, ZIP</p>
          </section>
        </article>
      `;
    }
  } else if (view === "read") {
    mainBody = `
      <article class="seo-article">
        <nav aria-label="Breadcrumb" class="seo-breadcrumb">
          <a href="${homeUrl}">${nav.home}</a> &gt; <span>${nav.read}</span>
        </nav>
        <h1>${escapeHtml(pageTitle)}</h1>
        <p class="seo-lead">${escapeHtml(pageDesc)}</p>

        <section class="seo-section">
          <h2>${lang === "ko" ? "온라인 독서 및 리더 기능" : "Reading & Viewing Features"}</h2>
          <div class="seo-grid">
            <div class="seo-card">
              <h3>📖 ${lang === "ko" ? "컷별 스마트 가이드 뷰 (Guided View)" : "Panel-by-Panel Guided View"}</h3>
              <p>${lang === "ko" ? "만화 컷을 자동으로 감지하여 패널 단위로 확대 감상할 수 있어 모바일 화면에서도 편리합니다." : "Automatically detect panels and zoom frame-by-frame for an immersive comic reading experience."}</p>
            </div>
            <div class="seo-card">
              <h3>🔄 ${lang === "ko" ? "만화 읽기 방향 전환 (RTL/LTR)" : "Reading Direction (RTL / LTR)"}</h3>
              <p>${lang === "ko" ? "일본 만화(우측에서 좌측) 및 서양 그래픽 노블(좌측에서 우측) 읽기 방식을 자유롭게 전환할 수 있습니다." : "Switch seamlessly between Manga Right-to-Left (RTL) and Western Left-to-Right (LTR) reading modes."}</p>
            </div>
            <div class="seo-card">
              <h3>🌙 ${lang === "ko" ? "다크 모드 &amp; 고화질 렌더링" : "Dark Mode &amp; High-Res Zoom"}</h3>
              <p>${lang === "ko" ? "야간 독서를 위한 다크 테마 및 벡터 수준의 선명한 텍스트 렌더링을 제공합니다." : "Comfortable night reading with dark mode, full-screen view, and crisp text rendering."}</p>
            </div>
            <div class="seo-card">
              <h3>📚 ${lang === "ko" ? "개인 서재 &amp; 클라우드 연동" : "Personal Bookshelf &amp; Cloud"}</h3>
              <p>${lang === "ko" ? "최근 읽은 책의 진행률을 자동 저장하며 Google Drive 클라우드에서 바로 도서를 불러올 수 있습니다." : "Automatically tracks your reading progress and syncs with your personal Google Drive library."}</p>
            </div>
          </div>
        </section>
      </article>
    `;
  } else if (view === "convert") {
    mainBody = `
      <article class="seo-article">
        <nav aria-label="Breadcrumb" class="seo-breadcrumb">
          <a href="${homeUrl}">${nav.home}</a> &gt; <span>${nav.convert}</span>
        </nav>
        <h1>${escapeHtml(pageTitle)}</h1>
        <p class="seo-lead">${escapeHtml(pageDesc)}</p>

        <section class="seo-section">
          <h2>${lang === "ko" ? "전자책 변환 핵심 기능" : "Universal Conversion Features"}</h2>
          <div class="seo-grid">
            <div class="seo-card">
              <h3>🔄 ${lang === "ko" ? "무손실 전자책 변환 (CBZ, CBR, PDF to EPUB)" : "Lossless Conversion (CBZ, CBR, PDF to EPUB)"}</h3>
              <p>${lang === "ko" ? "만화 압축 파일과 문서를 킨들 및 전자책 단말기에 최적화된 표준 EPUB3 포맷으로 고속 변환합니다." : "Convert comic archives and documents into Kindle-optimized EPUB3 files with lossless image quality."}</p>
            </div>
            <div class="seo-card">
              <h3>✂️ ${lang === "ko" ? "스마트 컷 분할 및 여백 자동 크롭" : "Smart Panel Splitting &amp; Crop"}</h3>
              <p>${lang === "ko" ? "이중 펼침면 자동 분할과 공백 여백 제거로 전자책 단말기 화면을 100% 채워 감상할 수 있습니다." : "Automatically split double-page spreads and crop white borders to maximize screen readability."}</p>
            </div>
            <div class="seo-card">
              <h3>⚡ ${lang === "ko" ? "킨들 화면 비율 최적화" : "Kindle Screen Optimization"}</h3>
              <p>${lang === "ko" ? "Kindle Paperwhite, Oasis, Scribe 등 기기별 해상도에 맞추어 파일 용량과 가독성을 최적화합니다." : "Tailored resolution and compression for Kindle Paperwhite, Oasis, Scribe, and standard e-readers."}</p>
            </div>
            <div class="seo-card">
              <h3>🔤 ${lang === "ko" ? "AI OCR 텍스트 레이어 생성" : "AI OCR Text Layer Generation"}</h3>
              <p>${lang === "ko" ? "스캔 이미지 속 문자를 디지털 텍스트 레이어로 추출하여 검색과 번역이 가능한 전자책으로 업그레이드합니다." : "Extract text layers from scanned pages to make your e-books searchable and translatable."}</p>
            </div>
          </div>
        </section>
      </article>
    `;
  } else if (view === "faq") {
    mainBody = `
      <article class="seo-article">
        <nav aria-label="Breadcrumb" class="seo-breadcrumb">
          <a href="${homeUrl}">${nav.home}</a> &gt; <span>${nav.faq}</span>
        </nav>
        <h1>${escapeHtml(pageTitle)}</h1>
        <p class="seo-lead">${escapeHtml(pageDesc)}</p>

        <section class="seo-section">
          <h2>${lang === "ko" ? "자주 묻는 질문" : "Frequently Asked Questions"}</h2>
          <div class="seo-faq-item">
            <h3>${lang === "ko" ? "EBookCC는 완전 무료인가요?" : "Is EBookCC completely free?"}</h3>
            <p>${lang === "ko" ? "네! 만화 제작, 리더, 전자책 변환, AI 만화 번역 등 모든 도구를 무료로 제한 없이 이용하실 수 있습니다." : "Yes! All tools including comic creation, book reader, converter, and AI translation are 100% free."}</p>
          </div>
          <div class="seo-faq-item">
            <h3>${lang === "ko" ? "만든 만화를 킨들(Kindle)에서 볼 수 있나요?" : "Can I read my created comics on Kindle?"}</h3>
            <p>${lang === "ko" ? "네, 내보내기 시 'EPUB' 형식을 선택하면 Amazon Send to Kindle 및 킨들 기기에서 바로 완벽하게 작동합니다." : "Yes, selecting EPUB export produces files fully compatible with Amazon Send to Kindle and Kindle e-readers."}</p>
          </div>
          <div class="seo-faq-item">
            <h3>${lang === "ko" ? "개인정보와 업로드한 파일은 안전한가요?" : "Are my files and personal privacy secure?"}</h3>
            <p>${lang === "ko" ? "EBookCC는 오프라인 로컬 처리를 지향하며, 사용자의 동의 없이 파일을 외부에 보관하지 않습니다." : "EBookCC prioritizes local-first browser processing and never stores your personal files on external servers without consent."}</p>
          </div>
        </section>
      </article>
    `;
  } else {
    // view === "home"
    mainBody = `
      <article class="seo-article">
        <h1>${escapeHtml(pageTitle)}</h1>
        <p class="seo-lead">${escapeHtml(pageDesc)}</p>

        <section class="seo-section">
          <h2>${lang === "ko" ? "EBookCC 주요 기능 바로가기" : "Explore EBookCC Suite"}</h2>
          <div class="seo-grid">
            <div class="seo-card">
              <h3><a href="${readUrl}">📖 ${nav.read}</a></h3>
              <p>${lang === "ko" ? "컷별 안내 뷰, 다크 모드, 고해상도 확대를 지원하는 온라인 만화 리더." : "Read comics, manga, EPUBs, and PDFs online with panel-by-panel guided view and dark mode."}</p>
            </div>
            <div class="seo-card">
              <h3><a href="${createUrl}">🎨 ${nav.create}</a></h3>
              <p>${lang === "ko" ? "다양한 만화 컷 레이아웃 구성, 말풍선 삽입, 드로잉 및 AI 소설 작성 스튜디오." : "Design custom comic panels, speech bubbles, draw illustrations, and write novels with AI assistance."}</p>
            </div>
            <div class="seo-card">
              <h3><a href="${convertUrl}">🔄 ${nav.convert}</a></h3>
              <p>${lang === "ko" ? "CBZ, CBR, PDF, EPUB 일괄 변환, 자동 OCR 스캔 및 스마트 패널 분할." : "Convert CBZ, CBR, PDF files into Kindle-optimized EPUB e-books with smart panel splitting."}</p>
            </div>
            <div class="seo-card">
              <h3><a href="${faqUrl}">❓ ${nav.faq}</a></h3>
              <p>${lang === "ko" ? "만화 번역, 패널 분할, 킨들 변환 등에 대한 자주 묻는 질문과 답변." : "Frequently asked questions and guides about comic creation, AI translation, and e-book conversion."}</p>
            </div>
          </div>
        </section>
      </article>
    `;
  }

  // Language switcher links for Google crawler discovery
  const langLinks = SEO_LANGUAGES.map(
    (l) => `<a href="${l.code === "en" ? (view === "home" ? "/" : `/${view}`) : `/${l.code}${view === "home" ? "" : `/${view}`}`}">${escapeHtml(l.nativeName)}</a>`
  ).join(" | ");

  return `
    <style id="ebookcc-ssr-styles">
      .seo-wrapper { max-width: 1100px; margin: 0 auto; padding: 24px 20px 60px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #1e293b; line-height: 1.6; }
      .seo-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 32px; flex-wrap: wrap; gap: 12px; }
      .seo-brand { font-size: 22px; font-weight: 800; color: #0f172a; text-decoration: none; display: flex; align-items: center; gap: 8px; }
      .seo-brand-tag { font-size: 11px; font-weight: 600; background: #e0e7ff; color: #4338ca; padding: 2px 8px; border-radius: 9999px; }
      .seo-nav { display: flex; gap: 16px; flex-wrap: wrap; }
      .seo-nav a { text-decoration: none; color: #475569; font-weight: 600; font-size: 14px; }
      .seo-nav a:hover { color: #0284c7; }
      .seo-breadcrumb { font-size: 13px; color: #64748b; margin-bottom: 16px; }
      .seo-breadcrumb a { color: #0284c7; text-decoration: none; }
      .seo-article h1 { font-size: 28px; font-weight: 800; color: #0f172a; line-height: 1.3; margin-bottom: 12px; }
      .seo-lead { font-size: 16px; color: #475569; margin-bottom: 32px; line-height: 1.7; }
      .seo-section { margin-bottom: 40px; }
      .seo-section h2 { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 16px; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px; }
      .seo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
      .seo-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; }
      .seo-card h3 { font-size: 16px; font-weight: 700; color: #1e293b; margin-top: 0; margin-bottom: 8px; }
      .seo-card p { font-size: 14px; color: #64748b; margin: 0; line-height: 1.6; }
      .seo-steps { padding-left: 20px; font-size: 15px; color: #334155; line-height: 1.8; }
      .seo-faq-item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin-bottom: 12px; }
      .seo-faq-item h3 { font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 6px 0; }
      .seo-faq-item p { font-size: 14px; color: #475569; margin: 0; }
      .seo-footer { border-top: 1px solid #e2e8f0; padding-top: 24px; margin-top: 48px; font-size: 12px; color: #94a3b8; text-align: center; }
      .seo-lang-links { margin-top: 10px; line-height: 2; }
      .seo-lang-links a { color: #64748b; text-decoration: none; margin: 0 4px; }
      .seo-lang-links a:hover { text-decoration: underline; }
      @media (prefers-color-scheme: dark) {
        .seo-wrapper { color: #cbd5e1; }
        .seo-brand { color: #f8fafc; }
        .seo-article h1, .seo-section h2, .seo-card h3, .seo-faq-item h3 { color: #f1f5f9; }
        .seo-lead, .seo-card p, .seo-faq-item p { color: #94a3b8; }
        .seo-card, .seo-faq-item { background: #1e293b; border-color: #334155; }
        .seo-header, .seo-footer { border-color: #334155; }
        .seo-section h2 { border-color: #334155; }
      }
    </style>
    <div class="seo-wrapper">
      <header class="seo-header">
        <a href="${homeUrl}" class="seo-brand">
          <span>EBookCC</span>
          <span class="seo-brand-tag">${escapeHtml(nav.tag)}</span>
        </a>
        <nav class="seo-nav">
          <a href="${homeUrl}">${escapeHtml(nav.home)}</a>
          <a href="${readUrl}">${escapeHtml(nav.read)}</a>
          <a href="${createUrl}">${escapeHtml(nav.create)}</a>
          <a href="${convertUrl}">${escapeHtml(nav.convert)}</a>
          <a href="${faqUrl}">${escapeHtml(nav.faq)}</a>
        </nav>
      </header>

      <main>
        ${mainBody}
      </main>

      <footer class="seo-footer">
        <p>&copy; 2026 EBookCC. Free Online Comic &amp; Manga Creation, AI Translation, and E-book Converter.</p>
        <div class="seo-lang-links">
          ${langLinks}
        </div>
      </footer>
    </div>
  `;
}

