import { LanguageCode } from "../context/LanguageContext";

export interface FAQItem {
  id: string;
  category: "ebooks" | "comics" | "ai" | "general";
  question: string;
  answer: string;
  keywords: string[];
  links?: { text: string; view: "read" | "create" | "convert" | "home"; description: string }[];
}

export interface FAQUIStrings {
  badge: string;
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  clear: string;
  expandAll: string;
  collapseAll: string;
  noMatchTitle: string;
  noMatchDesc: string;
  resetFilter: string;
  allTopics: string;
  catEbooks: string;
  catComics: string;
  catAi: string;
  catGeneral: string;
  cardReaderTitle: string;
  cardReaderDesc: string;
  cardReaderAction: string;
  cardConverterTitle: string;
  cardConverterDesc: string;
  cardConverterAction: string;
  cardStudioTitle: string;
  cardStudioDesc: string;
  cardStudioAction: string;
  bottomTitle: string;
  bottomReaderTitle: string;
  bottomReaderList: string[];
  bottomAuthorTitle: string;
  bottomAuthorList: string[];
  btnConvert: string;
  btnRead: string;
  btnCreate: string;
}

const UI_STRINGS: Record<LanguageCode, FAQUIStrings> = {
  en: {
    badge: "Help Center & Knowledge Base",
    title: "Frequently Asked Questions",
    subtitle: "Everything you need to know about reading, converting, and creating e-books, comics, raw manga translations, and Kindle-ready EPUB files on EBookCC.",
    searchPlaceholder: "Search topics (e.g., Kindle, CBZ, OCR, Manga, EPUB, Privacy)...",
    clear: "Clear",
    expandAll: "Expand All",
    collapseAll: "Collapse All",
    noMatchTitle: "No matching questions found",
    noMatchDesc: "Try searching with different keywords like 'Kindle', 'CBZ', 'EPUB', 'OCR', or 'Manga'.",
    resetFilter: "Reset Search Filters",
    allTopics: "All Topics",
    catEbooks: "E-Books & Kindle",
    catComics: "Manga & Comics",
    catAi: "AI & Translation",
    catGeneral: "Privacy & General",
    cardReaderTitle: "Web Reader",
    cardReaderDesc: "Read EPUB, PDF, CBZ & CBR comics with guided panel zoom, E-ink mode, and custom typography.",
    cardReaderAction: "Launch Reader",
    cardConverterTitle: "Batch Converter",
    cardConverterDesc: "Batch convert CBZ to EPUB, split dual-page manga spreads, scan PDF OCR, and translate raw manga.",
    cardConverterAction: "Open Converter",
    cardStudioTitle: "Comic & Story Studio",
    cardStudioDesc: "Draw comic panels, add speech bubbles, write e-book stories with AI prompts, and export EPUBs.",
    cardStudioAction: "Start Creating",
    bottomTitle: "Need More Specialized E-Book & Comic Solutions?",
    bottomReaderTitle: "For Comic & Manga Readers",
    bottomReaderList: [
      "Convert CBZ and CBR archives to clean, validated EPUB files.",
      "Split double-page spreads vertically for portrait smartphones.",
      "AI OCR speech bubble extraction and foreign raw manga translation.",
      "Guided panel-by-panel reading mode for low-eyestrain reading."
    ],
    bottomAuthorTitle: "For Writers, Authors & Kindle Users",
    bottomAuthorList: [
      "Format documents into Amazon Send-to-Kindle compliant EPUBs.",
      "Write text stories and compile custom comic panels in one canvas.",
      "Edit book cover art, title, author, and table of contents metadata.",
      "Zero tracking — 100% private, client-side browser execution."
    ],
    btnConvert: "Convert Books & Comics Now",
    btnRead: "Open E-Book Web Reader",
    btnCreate: "Create Comic or Story"
  },
  fr: {
    badge: "Centre d'Aide & Base de Connaissances",
    title: "Foire Aux Questions (FAQ)",
    subtitle: "Tout ce que vous devez savoir sur la lecture, la conversion et la création d'e-books, de bandes dessinées, la traduction de mangas et de fichiers EPUB pour Kindle.",
    searchPlaceholder: "Rechercher un sujet (ex. Kindle, CBZ, OCR, Manga, EPUB, Confidentialité)...",
    clear: "Effacer",
    expandAll: "Tout Développer",
    collapseAll: "Tout Réduire",
    noMatchTitle: "Aucune question correspondante trouvée",
    noMatchDesc: "Essayez de chercher d'autres mots-clés comme 'Kindle', 'CBZ', 'EPUB', 'OCR' ou 'Manga'.",
    resetFilter: "Réinitialiser la recherche",
    allTopics: "Tous les sujets",
    catEbooks: "E-Books & Kindle",
    catComics: "Mangas & BD",
    catAi: "IA & Traduction",
    catGeneral: "Confidentialité & Général",
    cardReaderTitle: "Lecteur Web",
    cardReaderDesc: "Lisez vos EPUB, PDF, CBZ et CBR avec zoom guidé sur les cases, mode E-Ink et typographie personnalisée.",
    cardReaderAction: "Ouvrir le Lecteur",
    cardConverterTitle: "Convertisseur par Lot",
    cardConverterDesc: "Convertissez CBZ en EPUB, découpez les doubles pages de manga, numérisez vos PDF par OCR et traduisez vos mangas.",
    cardConverterAction: "Ouvrir le Convertisseur",
    cardStudioTitle: "Studio BD & Histoire",
    cardStudioDesc: "Dessinez des cases, ajoutez des bulles, rédigez des histoires avec l'IA et exportez en EPUB.",
    cardStudioAction: "Commencer à Créer",
    bottomTitle: "Besoin de solutions spécialisées pour vos livres et bandes dessinées ?",
    bottomReaderTitle: "Pour les Lecteurs de BD et Mangas",
    bottomReaderList: [
      "Convertissez vos archives CBZ et CBR en fichiers EPUB valides.",
      "Découpez les doubles pages verticalement pour ordiphones.",
      "Extraction OCR des bulles et traduction IA automatique.",
      "Mode de lecture guidée case par case pour le confort visuel."
    ],
    bottomAuthorTitle: "Pour les Auteurs et Utilisateurs Kindle",
    bottomAuthorList: [
      "Formatez vos documents en EPUB compatibles avec Amazon Send-to-Kindle.",
      "Rédigez des histoires et assemblez vos cases dans un canevas unique.",
      "Éditez la couverture, le titre, l'auteur et la table des matières.",
      "Zéro suivi — exécution 100% privée en local dans le navigateur."
    ],
    btnConvert: "Convertir des Livres & BD",
    btnRead: "Ouvrir le Lecteur Web",
    btnCreate: "Créer une BD ou une Histoire"
  },
  ja: {
    badge: "ヘルプセンター & ナレッジベース",
    title: "よくある質問 (FAQ)",
    subtitle: "EBookCCでの電子書籍、コミック、生マンガの翻訳、Kindle向けEPUBファイルの閲覧・変換・作成に関するすべての情報。",
    searchPlaceholder: "トピックを検索 (例: Kindle, CBZ, OCR, マンガ, EPUB)...",
    clear: "クリア",
    expandAll: "すべて展開",
    collapseAll: "すべて折りたたむ",
    noMatchTitle: "該当する質問が見つかりませんでした",
    noMatchDesc: "'Kindle'、'CBZ'、'EPUB'、'OCR'、'マンガ' などのキーワードで再検索してみてください。",
    resetFilter: "検索フィルターをリセット",
    allTopics: "すべてのトピック",
    catEbooks: "電子書籍 & Kindle",
    catComics: "マンガ & コミック",
    catAi: "AI & 翻訳",
    catGeneral: "プライバシー & 全般",
    cardReaderTitle: "Webリーダー",
    cardReaderDesc: "コマ表示ガイド、電子ペーパー(E-ink)モード、フォント変更でEPUB、PDF、CBZ、CBRを快適閲覧。",
    cardReaderAction: "リーダーを起動",
    cardConverterTitle: "一括コンバーター",
    cardConverterDesc: "CBZからEPUBへの変換、マンガ見開き分割、PDF OCR抽出、生マンガ翻訳を一括処理。",
    cardConverterAction: "コンバーターを開く",
    cardStudioTitle: "コミック & ストーリースタジオ",
    cardStudioDesc: "コマ枠の描画、吹き出しの追加、AIプロンプトでのストーリー執筆、EPUB書き出しに対応。",
    cardStudioAction: "制作を開始",
    bottomTitle: "より専門的な電子書籍 & マンガのソリューションが必要ですか？",
    bottomReaderTitle: "マンガ & コミック読者向け",
    bottomReaderList: [
      "CBZおよびCBRアーカイブをクリーンなEPUBに変換。",
      "スマホ画面に合わせて見開きページを縦分割。",
      "AI OCRによる吹き出しテキストの抽出と外国マンガの自動翻訳。",
      "目に優しいガイド付きコマ送り閲覧モード。"
    ],
    bottomAuthorTitle: "作家・著者 & Kindleユーザー向け",
    bottomAuthorList: [
      "Amazon Send-to-Kindle互換のEPUBフォーマットを作成。",
      "ひとつのキャンバスで文章作成とコマ配置を統合。",
      "表紙画像、タイトル、著者名、目次メタデータを編集可能。",
      "追跡なし — ブラウザ内で100%完全ローカル処理。"
    ],
    btnConvert: "書籍・マンガを変換",
    btnRead: "Webリーダーを開く",
    btnCreate: "マンガ・ストーリーを作成"
  },
  "zh-Hant": {
    badge: "說明中心與知識庫",
    title: "常見問題解答 (FAQ)",
    subtitle: "關於在 EBookCC 上閱讀、轉換與創作電子書、漫畫、日漫生肉翻譯以及 Kindle 適用 EPUB 檔案的一切解答。",
    searchPlaceholder: "搜尋主題（例如：Kindle、CBZ、OCR、漫畫、EPUB、隱私）...",
    clear: "清除",
    expandAll: "展開全部",
    collapseAll: "折疊全部",
    noMatchTitle: "未找到符合條件的問題",
    noMatchDesc: "請嘗試搜尋其他關鍵字，例如 Kindle、CBZ、EPUB、OCR 或 漫畫。",
    resetFilter: "重置搜尋條件",
    allTopics: "所有主題",
    catEbooks: "電子書與 Kindle",
    catComics: "漫畫與連環畫",
    catAi: "AI 與翻譯",
    catGeneral: "隱私與常見",
    cardReaderTitle: "線上閱讀器",
    cardReaderDesc: "支援引導式分鏡放大、墨水屏模式及自訂字體的 EPUB、PDF、CBZ 與 CBR 閱讀器。",
    cardReaderAction: "啟動閱讀器",
    cardConverterTitle: "批次轉換器",
    cardConverterDesc: "批次將 CBZ 轉換為 EPUB、切割漫畫雙頁跨頁、掃描 PDF OCR 並自動翻譯生肉漫畫。",
    cardConverterAction: "打開轉換器",
    cardStudioTitle: "漫畫與故事創作室",
    cardStudioDesc: "繪製漫畫分鏡、添加對話框、利用 AI 撰寫故事並導出 EPUB 檔案。",
    cardStudioAction: "開始創作",
    bottomTitle: "需要更專業的電子書與漫畫解決方案？",
    bottomReaderTitle: "適用於漫畫與連環畫讀者",
    bottomReaderList: [
      "將 CBZ 和 CBR 壓縮包轉換為規範的 EPUB 檔案。",
      "針對智慧型手機將雙頁跨頁垂直裁切為單頁。",
      "AI OCR 自動識別對話框文字並翻譯外國漫畫生肉。",
      "引導式逐格閱讀模式，減少眼睛疲勞。"
    ],
    bottomAuthorTitle: "適用於創作者與 Kindle 用戶",
    bottomAuthorList: [
      "將文檔格式化為相容 Amazon Send-to-Kindle 的 EPUB。",
      "在單一畫布中編寫故事並排版漫畫分鏡。",
      "自訂編輯書籍封面、書名、作者及目錄元資料。",
      "零追蹤 — 100% 瀏覽器本機私密運行。"
    ],
    btnConvert: "立即轉換書籍與漫畫",
    btnRead: "打開線上閱讀器",
    btnCreate: "創作漫畫或故事"
  },
  "zh-Hans": {
    badge: "帮助中心与知识库",
    title: "常见问题解答 (FAQ)",
    subtitle: "关于在 EBookCC 上阅读、转换与创作电子书、漫画、日漫生肉翻译以及 Kindle 适用 EPUB 文件的一切解答。",
    searchPlaceholder: "搜索主题（例如：Kindle、CBZ、OCR、漫画、EPUB、隐私）...",
    clear: "清除",
    expandAll: "展开全部",
    collapseAll: "折叠全部",
    noMatchTitle: "未找到符合条件的问题",
    noMatchDesc: "请尝试搜索其他关键字，例如 Kindle、CBZ、EPUB、OCR 或 漫画。",
    resetFilter: "重置搜索条件",
    allTopics: "所有主题",
    catEbooks: "电子书与 Kindle",
    catComics: "漫画与连环画",
    catAi: "AI 与翻译",
    catGeneral: "隐私与常见",
    cardReaderTitle: "在线阅读器",
    cardReaderDesc: "支持引导式分镜放大、墨水屏模式及自定义字体的 EPUB、PDF、CBZ 与 CBR 阅读器。",
    cardReaderAction: "启动阅读器",
    cardConverterTitle: "批量转换器",
    cardConverterDesc: "批量将 CBZ 转换为 EPUB、切割漫画双页跨页、扫描 PDF OCR 并自动翻译生肉漫画。",
    cardConverterAction: "打开转换器",
    cardStudioTitle: "漫画与故事创作室",
    cardStudioDesc: "绘制漫画分镜、添加对话框、利用 AI 撰写故事并导出 EPUB 文件。",
    cardStudioAction: "开始创作",
    bottomTitle: "需要更专业的电子书与漫画解决方案？",
    bottomReaderTitle: "适用于漫画与连环画读者",
    bottomReaderList: [
      "将 CBZ 和 CBR 压缩包转换为规范的 EPUB 文件。",
      "针对智能手机将双页跨页垂直裁切为单页。",
      "AI OCR 自动识别对话框文字并翻译外国漫画生肉。",
      "引导式逐格阅读模式，减少眼睛疲劳。"
    ],
    bottomAuthorTitle: "适用于创作者与 Kindle 用户",
    bottomAuthorList: [
      "将文档格式化为兼容 Amazon Send-to-Kindle 的 EPUB。",
      "在单一画布中编写故事并排版漫画分镜。",
      "自定义编辑书籍封面、书名、作者及目录元数据。",
      "零追踪 — 100% 浏览器本地私密运行。"
    ],
    btnConvert: "立即转换书籍与漫画",
    btnRead: "打开在线阅读器",
    btnCreate: "创作漫画或故事"
  },
  es: {
    badge: "Centro de Ayuda y Base de Conocimientos",
    title: "Preguntas Frecuentes (FAQ)",
    subtitle: "Todo lo que necesitas saber sobre leer, convertir y crear e-books, cómics, traducción de manga y archivos EPUB para Kindle en EBookCC.",
    searchPlaceholder: "Buscar temas (ej. Kindle, CBZ, OCR, Manga, EPUB, Privacidad)...",
    clear: "Limpiar",
    expandAll: "Expandir Todo",
    collapseAll: "Contraer Todo",
    noMatchTitle: "No se encontraron preguntas coincidentes",
    noMatchDesc: "Intenta buscar con diferentes palabras clave como 'Kindle', 'CBZ', 'EPUB', 'OCR' o 'Manga'.",
    resetFilter: "Restablecer filtros",
    allTopics: "Todos los temas",
    catEbooks: "E-Books y Kindle",
    catComics: "Manga y Cómics",
    catAi: "IA y Traducción",
    catGeneral: "Privacidad y General",
    cardReaderTitle: "Lector Web",
    cardReaderDesc: "Lee EPUB, PDF, CBZ y CBR con zoom guiado por viñeta, modo E-ink y tipografía personalizada.",
    cardReaderAction: "Abrir Lector",
    cardConverterTitle: "Convertidor por Lotes",
    cardConverterDesc: "Convierte CBZ a EPUB, divide páginas dobles de manga, escanea OCR en PDF y traduce cómics.",
    cardConverterAction: "Abrir Convertidor",
    cardStudioTitle: "Estudio de Cómics e Historias",
    cardStudioDesc: "Dibuja viñetas, añade bocadillos, escribe historias con IA y exporta archivos EPUB.",
    cardStudioAction: "Empezar a Crear",
    bottomTitle: "¿Necesitas soluciones especializadas en libros y cómics?",
    bottomReaderTitle: "Para Lectores de Cómics y Manga",
    bottomReaderList: [
      "Convierte archivos CBZ y CBR en archivos EPUB validados.",
      "Divide imágenes de doble página verticalmente para teléfonos móviles.",
      "Extracción de bocadillos por IA y traducción automática de manga raw.",
      "Modo de lectura guiada viñeta por viñeta para reducir el cansancio visual."
    ],
    bottomAuthorTitle: "Para Escritores, Autores y Usuarios de Kindle",
    bottomAuthorList: [
      "Da formato a tus documentos para enviar a Kindle de Amazon.",
      "Escribe historias y organiza viñetas en un solo lienzo.",
      "Edita portada, título, autor y metadatos de la tabla de contenidos.",
      "Sin seguimiento — 100% privado en tu navegador."
    ],
    btnConvert: "Convertir Libros y Cómics",
    btnRead: "Abrir Lector Web",
    btnCreate: "Crear Cómic o Historia"
  },
  pt: {
    badge: "Central de Ajuda e Base de Conhecimento",
    title: "Perguntas Frequentes (FAQ)",
    subtitle: "Tudo o que você precisa saber sobre leitura, conversão e criação de e-books, quadrinhos, tradução de mangás e arquivos EPUB para Kindle no EBookCC.",
    searchPlaceholder: "Pesquisar tópicos (ex.: Kindle, CBZ, OCR, Mangá, EPUB, Privacidade)...",
    clear: "Limpar",
    expandAll: "Expandir Tudo",
    collapseAll: "Recolher Tudo",
    noMatchTitle: "Nenhuma pergunta correspondente encontrada",
    noMatchDesc: "Tente pesquisar com palavras-chave diferentes como 'Kindle', 'CBZ', 'EPUB', 'OCR' ou 'Mangá'.",
    resetFilter: "Redefinir Filtros",
    allTopics: "Todos os Tópicos",
    catEbooks: "E-Books e Kindle",
    catComics: "Mangás e HQs",
    catAi: "IA e Tradução",
    catGeneral: "Privacidade e Geral",
    cardReaderTitle: "Leitor Web",
    cardReaderDesc: "Leia EPUB, PDF, CBZ e CBR com zoom guiado em painéis, modo E-ink e tipografia personalizada.",
    cardReaderAction: "Abrir Leitor",
    cardConverterTitle: "Conversor em Lote",
    cardConverterDesc: "Converta CBZ para EPUB, divida páginas duplas de mangá, OCR em PDF e traduza mangás.",
    cardConverterAction: "Abrir Conversor",
    cardStudioTitle: "Estúdio de Quadrinhos e Histórias",
    cardStudioDesc: "Desenhe quadros, adicione balões de fala, escreva histórias com IA e exporte em EPUB.",
    cardStudioAction: "Começar a Criar",
    bottomTitle: "Precisa de soluções especializadas para livros e quadrinhos?",
    bottomReaderTitle: "Para Leitores de Quadrinhos e Mangás",
    bottomReaderList: [
      "Converta arquivos CBZ e CBR em e-books EPUB limpos.",
      "Divida páginas duplas de mangá em páginas simples para celular.",
      "Extração de texto via OCR e tradução automática com IA.",
      "Modo de leitura guiada painel a painel para maior conforto visual."
    ],
    bottomAuthorTitle: "Para Escritores, Autores e Usuários de Kindle",
    bottomAuthorList: [
      "Formate documentos em EPUB compatíveis com Amazon Send-to-Kindle.",
      "Escreva histórias e organize painéis de quadrinhos em uma tela única.",
      "Edite capa, título, autor e sumário.",
      "Sem rastreamento — 100% privado no seu navegador."
    ],
    btnConvert: "Converter Livros e Quadrinhos",
    btnRead: "Abrir Leitor Web",
    btnCreate: "Criar Quadrinho ou História"
  },
  ko: {
    badge: "도움말 센터 및 지식 베이스",
    title: "자주 묻는 질문 (FAQ)",
    subtitle: "EBookCC에서 전자책, 만화, 일본어 원본 만화 번역 및 Kindle용 EPUB 읽기, 변환, 제작에 관한 모든 내용.",
    searchPlaceholder: "주제 검색 (예: Kindle, CBZ, OCR, 만화, EPUB, 개인정보 보호)...",
    clear: "지우기",
    expandAll: "모두 펼치기",
    collapseAll: "모두 접기",
    noMatchTitle: "일치하는 질문을 찾을 수 없습니다",
    noMatchDesc: "'Kindle', 'CBZ', 'EPUB', 'OCR' 또는 '만화'와 같은 다른 키워드로 검색해 보세요.",
    resetFilter: "검색 필터 초기화",
    allTopics: "모든 주제",
    catEbooks: "전자책 및 Kindle",
    catComics: "만화 및 코믹스",
    catAi: "AI 및 번역",
    catGeneral: "개인정보 및 일반",
    cardReaderTitle: "웹 리더",
    cardReaderDesc: "컷가이드 확대, 전자종이(E-ink) 모드, 맞춤 폰트로 EPUB, PDF, CBZ, CBR을 쾌적하게 감상하세요.",
    cardReaderAction: "리더 실행",
    cardConverterTitle: "일괄 변환기",
    cardConverterDesc: "CBZ를 EPUB으로 변환, 만화 양면 페이지 분할, PDF OCR 텍스트 추출 및 만화 자동 번역.",
    cardConverterAction: "변환기 열기",
    cardStudioTitle: "만화 & 스토리 스튜디오",
    cardStudioDesc: "컷 그리기, 말풍선 추가, AI 프롬프트 스토리 작성 및 EPUB 내보내기를 지원합니다.",
    cardStudioAction: "제작 시작",
    bottomTitle: "더 전문적인 전자책 & 만화 솔루션이 필요하신가요?",
    bottomReaderTitle: "만화 및 코믹스 독자용",
    bottomReaderList: [
      "CBZ 및 CBR 압축파일을 올바른 EPUB 파일로 변환합니다.",
      "스마트폰 환경에 맞춰 양면 페이지를 세로로 잘라냅니다.",
      "AI OCR 기반 말풍선 추출 및 외국어 만화 자동 번역.",
      "눈의 피로를 줄여주는 컷별 가이드 읽기 모드."
    ],
    bottomAuthorTitle: "작가, 저자 및 Kindle 사용자용",
    bottomAuthorList: [
      "Amazon Send-to-Kindle 지원 규격의 EPUB 문서 생성.",
      "단일 캔버스에서 글로 된 스토리 작성과 만화 컷 배치를 통합.",
      "표지 이미지, 제목, 저자, 목차 메타데이터 수정 가능.",
      "추적 제로 — 100% 브라우저 로컬 개인정보 보호."
    ],
    btnConvert: "지금 책 & 만화 변환하기",
    btnRead: "웹 리더 열기",
    btnCreate: "만화 또는 스토리 만들기"
  },
  de: {
    badge: "Hilfe-Center & Wissensdatenbank",
    title: "Häufig gestellte Fragen (FAQ)",
    subtitle: "Alles, was Sie über das Lesen, Konvertieren und Erstellen von E-Books, Comics, Manga-Übersetzungen und Kindle-EPUB-Dateien auf EBookCC wissen müssen.",
    searchPlaceholder: "Themen suchen (z. B. Kindle, CBZ, OCR, Manga, EPUB)...",
    clear: "Löschen",
    expandAll: "Alle ausklappen",
    collapseAll: "Alle einklappen",
    noMatchTitle: "Keine passenden Fragen gefunden",
    noMatchDesc: "Suchen Sie mit anderen Begriffen wie 'Kindle', 'CBZ', 'EPUB', 'OCR' oder 'Manga'.",
    resetFilter: "Suchfilter zurücksetzen",
    allTopics: "Alle Themen",
    catEbooks: "E-Books & Kindle",
    catComics: "Manga & Comics",
    catAi: "KI & Übersetzung",
    catGeneral: "Datenschutz & Allgemein",
    cardReaderTitle: "Web-Reader",
    cardReaderDesc: "Lesen Sie EPUB, PDF, CBZ & CBR mit geführtem Panel-Zoom, E-Ink-Modus und individueller Typografie.",
    cardReaderAction: "Reader starten",
    cardConverterTitle: "Stapel-Konverter",
    cardConverterDesc: "Konvertieren Sie CBZ in EPUB, teilen Sie Doppelseiten, scannen Sie PDF-OCR und übersetzen Sie Mangas.",
    cardConverterAction: "Konverter öffnen",
    cardStudioTitle: "Comic & Story Studio",
    cardStudioDesc: "Zeichnen Sie Panels, fügen Sie Sprechblasen hinzu, schreiben Sie Geschichten mit KI und exportieren Sie EPUBs.",
    cardStudioAction: "Erstellung starten",
    bottomTitle: "Benötigen Sie spezialisierte E-Book- und Comic-Lösungen?",
    bottomReaderTitle: "Für Comic- & Manga-Leser",
    bottomReaderList: [
      "Konvertieren Sie CBZ- und CBR-Archive in saubere EPUB-Dateien.",
      "Teilen Sie Doppelseiten vertikal für Smartphones.",
      "KI-OCR-Sprechblasen-Extraktion und automatische Manga-Übersetzung.",
      "Geführter Panel-für-Panel-Lesemodus für entspanntes Lesen."
    ],
    bottomAuthorTitle: "Für Autoren und Kindle-Nutzer",
    bottomAuthorList: [
      "Formatieren Sie Dokumente für Amazon Send-to-Kindle.",
      "Schreiben Sie Geschichten und arrangieren Sie Panels auf einer Leinwand.",
      "Bearbeiten Sie Buchcover, Titel, Autor und Inhaltsverzeichnis.",
      "Kein Tracking — 100% private Ausführung im Browser."
    ],
    btnConvert: "Bücher & Comics konvertieren",
    btnRead: "Web-Reader öffnen",
    btnCreate: "Comic oder Story erstellen"
  },
  ar: {
    badge: "مركز المساعدة وقاعدة المعرفة",
    title: "الأسئلة الشائعة (FAQ)",
    subtitle: "كل ما تحتاج معرفته حول قراءة وتحويل وإنشاء الكتب الإلكترونية، والقصص المصورة، وترجمة المانغا وملفات EPUB لـ Kindle على EBookCC.",
    searchPlaceholder: "البحث في المواضيع (مثل Kindle، CBZ، OCR، المانغا، EPUB، الخصوصية)...",
    clear: "مسح",
    expandAll: "توسيع الكل",
    collapseAll: "طي الكل",
    noMatchTitle: "لم يتم العثور على أسئلة مطابقة",
    noMatchDesc: "جرب البحث بكلمات مفتاحية أخرى مثل 'Kindle' أو 'CBZ' أو 'EPUB' أو 'OCR' أو 'Manga'.",
    resetFilter: "إعادة ضبط خيارات البحث",
    allTopics: "جميع المواضيع",
    catEbooks: "الكتب الإلكترونية وKindle",
    catComics: "المانغا والكوميكس",
    catAi: "الذكاء الاصطناعي والترجمة",
    catGeneral: "الخصوصية والعامة",
    cardReaderTitle: "القارئ الإلكتروني",
    cardReaderDesc: "اقرأ ملفات EPUB وPDF وCBZ وCBR مع التكبير الموجه للإطارات، وضع الحبر الإلكتروني، والخطوط المخصصة.",
    cardReaderAction: "تشغيل القارئ",
    cardConverterTitle: "المحول الدفعي",
    cardConverterDesc: "حول CBZ إلى EPUB، وقسم الصفحات المزدوجة، واستخرج النصوص بـ OCR، وترجم المانغا.",
    cardConverterAction: "فتح المحول",
    cardStudioTitle: "استوديو الكوميكس والقصص",
    cardStudioDesc: "ارسم إطارات الكوميكس، وأضف فقاعات الكلام، واكتب قصصاً بمساعدة الذكاء الاصطناعي وصدر بصيغة EPUB.",
    cardStudioAction: "بدء الإنشاء",
    bottomTitle: "هل تحتاج إلى حلول متخصصة للكتب الإلكترونية والكوميكس؟",
    bottomReaderTitle: "لقراء المانغا والكوميكس",
    bottomReaderList: [
      "تحويل أرشيفات CBZ وCBR إلى ملفات EPUB متوافقة.",
      "تقسيم الصفحات المزدوجة عمودياً لتناسب الهواتف الذكية.",
      "استخراج فقاعات الكلام بـ OCR وترجمة المانغا تلقائياً.",
      "وضع قراءة موجه إطاراً بإطار لراحة العينين."
    ],
    bottomAuthorTitle: "للكتاب والمؤلفين ومستخدمي Kindle",
    bottomAuthorList: [
      "تنسيق المستندات لتصبح متوافقة مع خدمة Send-to-Kindle من أمازون.",
      "كتابة القصص وتنسيق الإطارات في لوحة واحدة.",
      "تعديل غلاف الكتاب، العنوان، اسم المؤلف وجدول المحتويات.",
      "بدون تتبع — تنفيذ خاص 100% داخل المتصفح المحلي."
    ],
    btnConvert: "تحويل الكتب والكوميكس الآن",
    btnRead: "فتح القارئ الإلكتروني",
    btnCreate: "إنشاء كوميكس أو قصة"
  },
  ru: {
    badge: "Центр помощи и база знаний",
    title: "Часто задаваемые вопросы (FAQ)",
    subtitle: "Всё, что вам нужно знать о чтении, конвертации и создании электронных книг, комиксов, переводе манги и файлах EPUB для Kindle на EBookCC.",
    searchPlaceholder: "Поиск по темам (например, Kindle, CBZ, OCR, Манга, EPUB, Конфиденциальность)...",
    clear: "Очистить",
    expandAll: "Развернуть все",
    collapseAll: "Свернуть все",
    noMatchTitle: "Совпадающих вопросов не найдено",
    noMatchDesc: "Попробуйте поискать по другим ключевым словам, таким как 'Kindle', 'CBZ', 'EPUB', 'OCR' или 'Манга'.",
    resetFilter: "Сбросить фильтры",
    allTopics: "Все темы",
    catEbooks: "Электронные книги и Kindle",
    catComics: "Манга и комиксы",
    catAi: "ИИ и перевод",
    catGeneral: "Конфиденциальность",
    cardReaderTitle: "Веб-ридер",
    cardReaderDesc: "Читайте EPUB, PDF, CBZ и CBR с покадровым зумом, режимом E-Ink и настраиваемыми шрифтами.",
    cardReaderAction: "Запустить ридер",
    cardConverterTitle: "Пакетный конвертер",
    cardConverterDesc: "Конвертируйте CBZ в EPUB, разделяйте двухстраничные развороты манги, распознавайте PDF и переводите комиксы.",
    cardConverterAction: "Открыть конвертер",
    cardStudioTitle: "Студия комиксов и историй",
    cardStudioDesc: "Рисуйте кадры, добавляйте облака с текстом, пишите истории с ИИ и экспортируйте в EPUB.",
    cardStudioAction: "Начать создание",
    bottomTitle: "Нужны специализированные решения для книг и комиксов?",
    bottomReaderTitle: "Для читателей манги и комиксов",
    bottomReaderList: [
      "Конвертируйте архивы CBZ и CBR в валидные файлы EPUB.",
      "Разделяйте двухстраничные развороты вертикально для смартфонов.",
      "Извлечение текста из речевых облаков с помощью ИИ OCR и автоперевод.",
      "Режим пошагового чтения по кадрам для комфорта глаз."
    ],
    bottomAuthorTitle: "Для авторов и пользователей Kindle",
    bottomAuthorList: [
      "Форматируйте документы в EPUB, совместимый с Amazon Send-to-Kindle.",
      "Пишите истории и компонуйте кадры комиксов на едином холсте.",
      "Редактируйте обложку, название, автора и оглавление.",
      "Без отслеживания — 100% приватная обработка в браузере."
    ],
    btnConvert: "Конвертировать книги и комиксы",
    btnRead: "Открыть веб-ридер",
    btnCreate: "Создать комикс или историю"
  },
  it: {
    badge: "Centro Assistenza & Knowledge Base",
    title: "Domande Frequenti (FAQ)",
    subtitle: "Tutto ciò che devi sapere su lettura, conversione e creazione di e-book, fumetti, traduzione di manga e file EPUB per Kindle su EBookCC.",
    searchPlaceholder: "Cerca argomenti (es. Kindle, CBZ, OCR, Manga, EPUB, Privacy)...",
    clear: "Cancella",
    expandAll: "Espandi Tutto",
    collapseAll: "Comprimi Tutto",
    noMatchTitle: "Nessuna domanda corrispondente trovata",
    noMatchDesc: "Prova a cercare con parole chiave diverse come 'Kindle', 'CBZ', 'EPUB', 'OCR' o 'Manga'.",
    resetFilter: "Ripristina filtri",
    allTopics: "Tutti gli argomenti",
    catEbooks: "E-Book e Kindle",
    catComics: "Manga e Fumetti",
    catAi: "IA e Traduzione",
    catGeneral: "Privacy e Generale",
    cardReaderTitle: "Lettore Web",
    cardReaderDesc: "Leggi EPUB, PDF, CBZ e CBR con zoom guidato sulle vignette, modalità E-Ink e font personalizzati.",
    cardReaderAction: "Avvia Lettore",
    cardConverterTitle: "Convertitore Batch",
    cardConverterDesc: "Converti CBZ in EPUB, dividi doppie pagine manga, scansiona PDF con OCR e traduci manga.",
    cardConverterAction: "Apri Convertitore",
    cardStudioTitle: "Studio Fumetti e Storie",
    cardStudioDesc: "Disegna vignette, aggiungi fumetti di testo, scrivi storie con l'IA ed esporta in EPUB.",
    cardStudioAction: "Inizia a Creare",
    bottomTitle: "Hai bisogno di soluzioni specializzate per e-book e fumetti?",
    bottomReaderTitle: "Per Lettori di Fumetti e Manga",
    bottomReaderList: [
      "Converti archivi CBZ e CBR in file EPUB corretti.",
      "Dividi le doppie pagine verticalmente per smartphone.",
      "Estrazione OCR dei fumetti di testo e traduzione automatica IA.",
      "Modalità di lettura guidata vignetta per vignetta per il riposo visivo."
    ],
    bottomAuthorTitle: "Per Scrittori, Autori e Utenti Kindle",
    bottomAuthorList: [
      "Formatta i documenti in EPUB compatibili con Amazon Send-to-Kindle.",
      "Scrivi storie e organizza vignette su una tela unica.",
      "Modifica copertina, titolo, autore e sommario.",
      "Zero tracciamento — 100% privato nel tuo browser."
    ],
    btnConvert: "Converti Libri e Fumetti Ora",
    btnRead: "Apri Lettore Web",
    btnCreate: "Crea Fumetto o Storia"
  }
};

export function getFAQUIStrings(lang: LanguageCode): FAQUIStrings {
  return UI_STRINGS[lang] || UI_STRINGS.en;
}

export function getFAQItems(lang: LanguageCode): FAQItem[] {
  switch (lang) {
    case "fr":
      return [
        {
          id: "faq-1",
          category: "ebooks",
          question: "Comment convertir des bandes dessinées CBZ, CBR ou PDF en EPUB pour Kindle, Kobo ou Apple Books ?",
          answer: "Vous pouvez convertir instantanément vos fichiers CBZ, CBR ou PDF en EPUB grâce au convertisseur universel EBookCC. Téléchargez votre archive, sélectionnez la sortie 'EPUB' ou 'Kindle EPUB', activez la compression d'image si besoin et cliquez sur Convertir. L'EPUB généré conserve une haute résolution d'image tout en optimisant la taille du fichier.",
          keywords: ["cbz", "cbr", "pdf", "epub", "kindle", "kobo", "apple books", "convertir"],
          links: [
            { text: "Ouvrir le Convertisseur", view: "convert", description: "Convertir des fichiers CBZ, CBR, PDF & EPUB" },
            { text: "Ouvrir le Lecteur Web", view: "read", description: "Lire vos EPUB ou CBZ dans votre navigateur" }
          ]
        },
        {
          id: "faq-2",
          category: "ebooks",
          question: "Comment envoyer des e-books EPUB convertis directement sur mon appareil Kindle ?",
          answer: "Après la conversion sur EBookCC, téléchargez le fichier EPUB et utilisez le service officiel 'Send to Kindle' d'Amazon (amazon.com/sendtokindle) ou envoyez-le par e-mail à votre adresse Kindle. Le format EPUB est nativement pris en charge par tous les appareils Kindle récents.",
          keywords: ["send to kindle", "amazon kindle", "epub kindle", "paperwhite"],
          links: [{ text: "Convertir pour Kindle", view: "convert", description: "Formater des livres pour Amazon Kindle" }]
        },
        {
          id: "faq-3",
          category: "ebooks",
          question: "Puis-je réagencer ou extraire du texte propre à partir de manuels PDF et de documents numérisés ?",
          answer: "Oui ! EBookCC intègre un moteur d'OCR et de réagencement texte par IA. Lorsque vous téléchargez un livre PDF ou scanné, l'OCR extrait le texte, nettoie les sauts de page et vous permet d'exporter en EPUB réagencable, HTML ou texte brut.",
          keywords: ["ocr", "pdf", "extraire texte", "pdf scanné", "epub"],
          links: [{ text: "Tester l'OCR & Convertisseur PDF", view: "convert", description: "Extraire le texte et convertir en EPUB" }]
        },
        {
          id: "faq-4",
          category: "comics",
          question: "Comment fonctionne le découpeur de doubles pages de manga pour la lecture sur smartphone ?",
          answer: "Les doubles pages de mangas sont souvent illisibles sur petit écran. EBookCC détecte automatiquement les doubles pages, les découpe verticalement en pages simples droite/gauche et réorganise le sens de lecture selon le sens japonais (droite à gauche) ou occidental.",
          keywords: ["manga", "double page", "découper page", "lecture mobile"],
          links: [
            { text: "Essayer le Découpeur de Pages", view: "convert", description: "Découper les doubles pages pour smartphone" },
            { text: "Lancer le Lecteur Manga", view: "read", description: "Lire des mangas en mode défilement webtoon" }
          ]
        },
        {
          id: "faq-5",
          category: "comics",
          question: "Comment traduire automatiquement des mangas japonais bruts, des webtoons coréens ou des bandes dessinées ?",
          answer: "EBookCC intègre un traducteur IA pour manga & webtoon. Il détecte automatiquement les bulles de texte par vision par ordinateur, extrait le texte par OCR (japonais, coréen, chinois, anglais), efface le texte original et superpose la traduction propre dans les bulles en plus de 12 langues.",
          keywords: ["traduire manga", "ia ocr", "raw manga", "webtoon", "bulle de texte"],
          links: [
            { text: "Traduire un Manga en Ligne", view: "convert", description: "Détection de bulles et traduction IA" },
            { text: "Créer des Mangas & BD", view: "create", description: "Concevoir des BD avec bulles personnalisées" }
          ]
        },
        {
          id: "faq-6",
          category: "comics",
          question: "Comment créer mes propres bandes dessinées IA, mangas ou romans visuels ?",
          answer: "EBookCC intègre un studio de création de BD interactif. Vous pouvez dessiner sur un canevas numérique avec prise en charge de la pression de stylet (Wacom/Apple Pencil), générer des cases et récits grâce à l'IA, ajouter des bulles de texte et exporter en CBZ ou EPUB.",
          keywords: ["créer bd", "générateur manga ia", "studio dessin", "epub bd"],
          links: [{ text: "Ouvrir le Studio BD", view: "create", description: "Dessiner et générer des histoires en BD" }]
        },
        {
          id: "faq-7",
          category: "ai",
          question: "Quels modèles d'IA puis-je utiliser pour la traduction, l'OCR et la création ?",
          answer: "EBookCC prend en charge plusieurs fournisseurs d'IA : Google Gemini (Gemini 2.5 Flash / Pro), OpenAI (GPT-4o), Anthropic Claude, ainsi que des modèles LLM locaux comme Ollama ou LM Studio pour une confidentialité totale hors ligne.",
          keywords: ["ia", "gemini", "openai", "claude", "ollama", "lm studio"],
          links: [{ text: "Configurer les Clés d'IA", view: "home", description: "Régler Gemini ou vos LLM locaux" }]
        },
        {
          id: "faq-8",
          category: "general",
          question: "EBookCC est-il gratuit et mes fichiers restent-ils confidentiels ?",
          answer: "Oui ! EBookCC s'exécute directement dans votre navigateur web. Le traitement des fichiers, le recadrage, la compilation EPUB et la lecture s'effectuent 100% en local sur votre appareil. Vos fichiers ne sont jamais téléchargés ni revendus à des serveurs externes.",
          keywords: ["gratuit", "privé", "confidentialité", "local", "navigateur"],
          links: [
            { text: "Lire en Toute Confidentialité", view: "read", description: "Charger des fichiers locaux dans le lecteur" },
            { text: "Retourner à l'Accueil", view: "home", description: "Découvrir toutes les fonctionnalités" }
          ]
        },
        {
          id: "faq-9",
          category: "ebooks",
          question: "Quels formats de fichiers sont pris en charge pour la lecture et la conversion ?",
          answer: "EBookCC prend en charge un large éventail de formats : EPUB, PDF, CBZ, CBR, MOBI, AZW3, TXT, DOCX, HTML, WEBP, PNG, JPG et archives ZIP. Vous pouvez les lire en ligne ou les convertir en un clic.",
          keywords: ["formats", "epub", "pdf", "cbz", "cbr", "mobi", "docx"],
          links: [{ text: "Convertir des Formats par Lot", view: "convert", description: "Convertir entre EPUB, CBZ, PDF et MOBI" }]
        },
        {
          id: "faq-10",
          category: "general",
          question: "Comment lire des livres et BD sur des liseuses E-Ink (Kindle, Onyx Boox, Kobo) ?",
          answer: "EBookCC propose un mode de lecture E-Ink dédié avec des thèmes monochromes à fort contraste, une typographie renforcée et un changement de page sans scintillement optimisé pour le rafraîchissement des écrans à encre électronique.",
          keywords: ["e-ink", "onyx boox", "kobo", "kindle", "encre electronique"],
          links: [{ text: "Tester le Mode E-Ink", view: "read", description: "Lire avec un contraste élevé et sans scintillement" }]
        },
        {
          id: "faq-11",
          category: "comics",
          question: "Comment ajouter des bulles de texte dessinées à la main et des dialogues personnalisés ?",
          answer: "Dans le Studio BD, choisissez l'outil Bulle de Texte pour dessiner à main levée ou utiliser des modèles (parole, pensée, cri, chuchotement), positionner la flèche dynamiquement et saisir le texte avec redimensionnement automatique des polices.",
          keywords: ["bulles dessinées", "bulle de texte", "dialogues", "studio bd"],
          links: [{ text: "Ouvrir le Studio BD", view: "create", description: "Concevoir des cases avec bulles dessinées à la main" }]
        },
        {
          id: "faq-12",
          category: "comics",
          question: "Comment fonctionne la lecture en ligne par cases découpées ?",
          answer: "Le Lecteur Web intègre un mode découpage de cases qui divise les pages de BD complexes en gros plans individuels par case. Naviguez facilement de case en case avec les flèches du clavier ou des gestes de balayage.",
          keywords: ["découpage cases", "lire en ligne", "zoom case", "lecteur manga"],
          links: [{ text: "Lancer le Lecteur Web", view: "read", description: "Lire des BD avec zoom guidé par case" }]
        },
        {
          id: "faq-13",
          category: "comics",
          question: "Comment créer des collages de bandes dessinées et des grilles de cases sur mesure ?",
          answer: "Avec le Studio BD, agencez des grilles multi-cases, combinez plusieurs illustrations en un collage harmonieux, personnalisez les gouttières et bordures puis exportez vers CBZ ou EPUB.",
          keywords: ["collage bd", "créer collage", "grille cases", "créateur bd"],
          links: [{ text: "Créer un Collage BD", view: "create", description: "Concevoir et exporter des collages BD" }]
        },
        {
          id: "faq-14",
          category: "ai",
          question: "Comment l'IA YOLO détecte-t-elle automatiquement les cases et les bulles de texte ?",
          answer: "EBookCC utilise la vision par ordinateur (dont des modèles de détection YOLO) pour analyser automatiquement les pages de BD, isoler les cases rectangulaires, repérer les bulles et extraire leurs coordonnées pour un OCR et une traduction propres.",
          keywords: ["yolo", "détection cases", "ocr ia", "bulles de texte"],
          links: [{ text: "Tester la Détection YOLO & OCR", view: "convert", description: "Détecter automatiquement les cases et le texte" }]
        }
      ];

    case "ja":
      return [
        {
          id: "faq-1",
          category: "ebooks",
          question: "CBZ、CBR、またはPDFコミックをKindle、Kobo、Apple Books用のEPUBに変換するにはどうすればよいですか？",
          answer: "EBookCCのユニバーサルコンバーターを使えば、CBZ、CBR、PDFコミックを即座にEPUBに変換できます。ファイルをアップロードし、『EPUB』または『Kindle EPUB』を選択して『変換』をクリックするだけです。画像解像度を維持しながら、電子書籍リーダー向けにファイルサイズを最適化します。",
          keywords: ["cbz", "cbr", "pdf", "epub", "kindle", "kobo", "apple books", "変換"],
          links: [
            { text: "一括コンバーターを開く", view: "convert", description: "CBZ、CBR、PDF、EPUBの一括変換" },
            { text: "Webリーダーを開く", view: "read", description: "変換したEPUBやCBZをブラウザで直ちに閲覧" }
          ]
        },
        {
          id: "faq-2",
          category: "ebooks",
          question: "変換したEPUB電子書籍をKindle端末に直接送信するにはどうすればよいですか？",
          answer: "EBookCCでEPUBに変換後、ファイルをダウンロードしてAmazon公式の『Send to Kindle』(amazon.com/sendtokindle) サービスを利用するか、Kindleメールアドレス宛に送信してください。最新のKindle端末およびKindleアプリでEPUBが完全にサポートされています。",
          keywords: ["send to kindle", "amazon kindle", "epub kindle", "paperwhite"],
          links: [{ text: "Kindle向け変換を開始", view: "convert", description: "Amazon Kindle用にフォーマット変換" }]
        },
        {
          id: "faq-3",
          category: "ebooks",
          question: "PDF教科書やスキャン文書から綺麗なテキストを抽出・リフローできますか？",
          answer: "はい！EBookCCにはAI OCR & リフローエンジンが搭載されています。PDF教科書やスキャン本をアップロードすると、内蔵OCRが文字を読み取り、改行やヘッダーのノイズをクリーンアップしてEPUBやHTML、テキスト形式で抽出できます。",
          keywords: ["ocr", "pdf教科書", "リフロー", "テキスト抽出", "スキャンpdf"],
          links: [{ text: "PDF OCR & コンバーターを試す", view: "convert", description: "テキストを抽出してリフローEPUB化" }]
        },
        {
          id: "faq-4",
          category: "comics",
          question: "スマホ閲覧用のマンガ見開き分割機能はどのように動作しますか？",
          answer: "マンガの見開き（2ページ組み）はスマホ画面では小さく見づらくなりがちです。EBookCCは自動で見開きを検出して左右の単一ページに縦分割し、右開き（マンガ）または左開きの読書順序に合わせて再構成します。",
          keywords: ["マンガ", "見開き分割", "2ページ分割", "スマホ閲覧", "ウェブトゥーン"],
          links: [
            { text: "ページ分割機能を試す", view: "convert", description: "見開きページをスマホ用単一ページに分割" },
            { text: "マンガリーダーを起動", view: "read", description: "コマ表示ガイドや縦スクロールでマンガを閲覧" }
          ]
        },
        {
          id: "faq-5",
          category: "comics",
          question: "外国のマンガや韓国ウェブトゥーンを自動翻訳するにはどうすればよいですか？",
          answer: "EBookCCはAIマンガ翻訳機能を備えています。画像認識で吹き出しを自動検出し、日本語・英語・韓国語・中国語を高精度OCR処理。元のテキストを消去し、12以上の言語に翻訳された綺麗なテキストを吹き出し内に配置します。",
          keywords: ["マンガ翻訳", "ai ocr", "生マンガ", "ウェブトゥーン翻訳", "吹き出し"],
          links: [
            { text: "オンラインでマンガを自動翻訳", view: "convert", description: "吹き出し検出・消去・AI翻訳" },
            { text: "マンガ・コミックを作成", view: "create", description: "吹き出し付きのコマ割コミックをデザイン" }
          ]
        },
        {
          id: "faq-6",
          category: "comics",
          question: "自分だけのAIコミック、マンガ、ビジュアルノベルを作成するには？",
          answer: "EBookCCにはインタラクティブなコミック＆キャンバススタジオが用意されています。WacomやApple Pencilの筆圧感知に対応したキャンバス描画、AIプロンプトによるコマ絵やプロット生成、吹き出し配置を行い、CBZやEPUBで書き出せます。",
          keywords: ["コミック作成", "aiマンガ生成", "マンガ作成", "キャンバス描画"],
          links: [{ text: "コミック＆キャンバススタジオを開く", view: "create", description: "コマ割とAIストーリー生成" }]
        },
        {
          id: "faq-7",
          category: "ai",
          question: "翻訳、OCR、コミック作成に使用できるAIモデルは何ですか？",
          answer: "Google Gemini (Gemini 2.5 Flash / Pro)、OpenAI (GPT-4o)、Anthropic Claude、さらにOllamaやLM StudioなどのローカルLLMに対応しており、オフラインで完全にプライベートな環境で利用可能です。",
          keywords: ["aiモデル", "gemini", "openai", "claude", "ollama", "lm studio"],
          links: [{ text: "AI & APIキーの設定", view: "home", description: "GeminiやローカルLLMをアプリ設定で登録" }]
        },
        {
          id: "faq-8",
          category: "general",
          question: "EBookCCは無料ですか？アップロードしたファイルのプライバシーは保護されますか？",
          answer: "はい！EBookCCはブラウザ内で直接動作します。ファイルの処理、画像切り抜き、EPUBのビルド、読書はすべてお使いの端末上でローカルに行われます。ファイルが外部サーバーに送信されたり販売されることはありません。",
          keywords: ["プライバシー", "オフライン", "無料電子書籍リーダー", "ローカル処理"],
          links: [
            { text: "プライベートに電子書籍を読む", view: "read", description: "ローカルファイルをプライベートリーダーに読み込む" },
            { text: "ホーム画面に戻る", view: "home", description: "EBookCCの全機能を探索" }
          ]
        },
        {
          id: "faq-9",
          category: "ebooks",
          question: "閲覧および変換でサポートされているファイル形式は何ですか？",
          answer: "EPUB、PDF、CBZ、CBR、MOBI、AZW3、TXT、DOCX、HTML、WEBP、PNG、JPG、ZIP圧縮ファイルなど、多彩な電子書籍・コミック形式に対応しています。",
          keywords: ["形式", "epub", "pdf", "cbz", "cbr", "mobi", "docx"],
          links: [{ text: "一括形式変換", view: "convert", description: "EPUB、CBZ、PDF、MOBI間の相互変換" }]
        },
        {
          id: "faq-10",
          category: "general",
          question: "E-Ink端末（Kindle、Onyx Boox、Kobo等）で読むにはどうすればよいですか？",
          answer: "EBookCCには専用のE-Ink閲覧モードが用意されています。ハイコントラストなモノクロ表示、太字フォント、チラつきを抑えたページ切り替えなど、電子ペーパーの画面更新に最適化されています。",
          keywords: ["e-ink", "onyx boox", "kobo", "電子ペーパー", "ハイコントラスト"],
          links: [{ text: "E-Inkモードで読む", view: "read", description: "チラつきのないハイコントラスト表示で読書" }]
        },
        {
          id: "faq-11",
          category: "comics",
          question: "フリーハンドの吹き出しやカスタムセリフを追加するにはどうすればよいですか？",
          answer: "コミック＆ストーリースタジオで吹き出しツールを選択し、フリーハンド描画または各種テンプレート（セリフ、心の中、叫び、ささやき）を選択。しっぽの位置を自由に変え、自動フォント調整付きでセリフを入力できます。",
          keywords: ["フリーハンド吹き出し", "吹き出し描画", "台詞", "コミックスタジオ"],
          links: [{ text: "コミックスタジオを開く", view: "create", description: "フリーハンド吹き出し付きでコマをデザイン" }]
        },
        {
          id: "faq-12",
          category: "comics",
          question: "分割コマでのオンライン閲覧はどのように動作しますか？",
          answer: "Webリーダーのコマ分割モードを使えば、複雑なマンガページを1コマごとのアップ表示に分割できます。キーボードの矢印キーやスワイプ操作で1コマ目から2コマ目へ順番にガイド表示されます。",
          keywords: ["コマ分割", "オンライン閲覧", "コマズーム", "マンガリーダー"],
          links: [{ text: "Webリーダーを起動", view: "read", description: "コマ送りガイドでマンガを閲覧" }]
        },
        {
          id: "faq-13",
          category: "comics",
          question: "カスタムコミックコラージュや複数コマレイアウトを作成するには？",
          answer: "コミック＆ストーリースタジオで複数コマのグリッドを配置し、複数のイラスト画像を組み合わせてまとまりのあるコラージュを作成。枠線や背景色を調整してCBZやEPUBで出力できます。",
          keywords: ["コミックコラージュ", "コラージュ作成", "コマ割りレイアウト", "マンガ作成"],
          links: [{ text: "コミックコラージュを作成", view: "create", description: "多コマコラージュのデザインと書き出し" }]
        },
        {
          id: "faq-14",
          category: "ai",
          question: "YOLO AIはどのようにマンガのコマや吹き出しを自動検出しますか？",
          answer: "EBookCCはYOLOベースの物体検出AIを統合しており、マンガページをスキャンして矩形コマの分離、吹き出しの検出、テキスト位置の特定を自動で行います。手動でのトリミングは不要です。",
          keywords: ["yolo検出", "コマ検出", "ai ocr", "吹き出し検出"],
          links: [{ text: "YOLO & OCR検出を試す", view: "convert", description: "コマとテキストの自動一括検出" }]
        }
      ];

    case "zh-Hant":
    case "zh-Hans":
      const isHant = lang === "zh-Hant";
      return [
        {
          id: "faq-1",
          category: "ebooks",
          question: isHant ? "如何將 CBZ、CBR 或 PDF 漫畫轉換為適用於 Kindle、Kobo 或 Apple Books 的 EPUB？" : "如何将 CBZ、CBR 或 PDF 漫画转换为适用于 Kindle、Kobo 或 Apple Books 的 EPUB？",
          answer: isHant ? "您可以使用 EBookCC 的通用轉換器將 CBZ、CBR 或 PDF 漫畫文件即時轉換為 EPUB。上傳您的漫畫壓縮檔，選擇「EPUB」或「Kindle EPUB」輸出，點擊轉換即可。生成的 EPUB 保持高解析度圖像，同時優化文件大小。" : "您可以使用 EBookCC 的通用转换器将 CBZ、CBR 或 PDF 漫画文件即时转换为 EPUB。上传您的漫画压缩包，选择“EPUB”或“Kindle EPUB”输出，点击转换即可。生成的 EPUB 保持高分辨率图像，同时优化文件大小。",
          keywords: ["cbz", "cbr", "pdf", "epub", "kindle", "kobo", "apple books", "convert"],
          links: [
            { text: isHant ? "開啟通用轉換器" : "打开通用转换器", view: "convert", description: isHant ? "批量轉換 CBZ、CBR、PDF 與 EPUB" : "批量转换 CBZ、CBR、PDF 与 EPUB" },
            { text: isHant ? "開啟線上閱讀器" : "打开在线阅读器", view: "read", description: isHant ? "直接在瀏覽器中閱讀轉換後的電子書" : "直接在浏览器中阅读转换后的电子书" }
          ]
        },
        {
          id: "faq-2",
          category: "ebooks",
          question: isHant ? "如何將轉換後的 EPUB 電子書直接發送到我的 Kindle 裝置？" : "如何将转换后的 EPUB 电子书直接发送到我的 Kindle 设备？",
          answer: isHant ? "在 EBookCC 上轉換為 EPUB 格式後，下載檔案並使用 Amazon 官方的「Send to Kindle」服務 (amazon.com/sendtokindle) 或透過電子郵件發送到您的 Kindle 地址。現代 Kindle 裝置均完美支援 EPUB。" : "在 EBookCC 上转换为 EPUB 格式后，下载文件并使用 Amazon 官方的“Send to Kindle”服务 (amazon.com/sendtokindle) 或通过电子邮件发送到您的 Kindle 地址。现代 Kindle 设备均完美支持 EPUB。",
          keywords: ["send to kindle", "amazon kindle", "epub kindle", "paperwhite"],
          links: [{ text: isHant ? "開始為 Kindle 轉換" : "开始为 Kindle 转换", view: "convert", description: isHant ? "格式化漫畫與文字書以適應 Kindle" : "格式化漫画与文字书以适应 Kindle" }]
        },
        {
          id: "faq-3",
          category: "ebooks",
          question: isHant ? "我可以從 PDF 教科書和掃描文檔中重排或提取純文字嗎？" : "我可以从 PDF 教科书和扫描文档中重排或提取纯文本吗？",
          answer: isHant ? "可以！EBookCC 內建 AI OCR 與重排引擎。當您上傳 PDF 教科書或掃描圖片檔時，內建的 OCR 會識別文字、清除換行與雜訊，並導出重排的 EPUB、HTML 或純文字。" : "可以！EBookCC 内置 AI OCR 与重排引擎。当您上传 PDF 教科书或扫描图片包时，内置的 OCR 会识别文本、清除换行与噪声，并导出重排的 EPUB、HTML 或纯文本。",
          keywords: ["ocr", "pdf textbook", "reflow", "extract text", "epub"],
          links: [{ text: isHant ? "嘗試 PDF OCR 與轉換器" : "尝试 PDF OCR 与转换器", view: "convert", description: isHant ? "提取文字並轉換為可重排 EPUB" : "提取文本并转换为可重排 EPUB" }]
        },
        {
          id: "faq-4",
          category: "comics",
          question: isHant ? "漫畫雙頁切割器在手機閱讀上是如何運作的？" : "漫画双页切割器在手机阅读上 nexus 是如何工作的？",
          answer: isHant ? "傳統漫畫跨頁（雙頁）在手機上顯示字體極小。EBookCC 會自動檢測雙頁跨頁，將其垂直裁切為獨立的左右單頁，並根據日漫（右開）或西式（左開）閱讀順序重新排序。" : "传统漫画跨页（双页）在手机上显示字体极小。EBookCC 会自动检测双页跨页，将其垂直裁切为独立的左右单页，并根据日漫（右开）或西式（左开）阅读顺序重新排序。",
          keywords: ["manga", "dual page", "page splitter", "mobile reading"],
          links: [
            { text: isHant ? "嘗試分鏡與頁面切割器" : "尝试分镜与页面切割器", view: "convert", description: isHant ? "將雙頁跨頁切割為手機單頁" : "将双页跨页切割为手机单页" },
            { text: isHant ? "啟動漫畫閱讀器" : "启动漫画阅读器", view: "read", description: isHant ? "支援分鏡引導放大與條漫滾動模式" : "支持分镜引导放大与条漫滚动模式" }
          ]
        },
        {
          id: "faq-5",
          category: "comics",
          question: isHant ? "如何自動翻譯日文生肉漫畫、韓國 Webtoon 或外國連環畫？" : "如何自动翻译日文生肉漫画、韩国 Webtoon 或外国连环画？",
          answer: isHant ? "EBookCC 提供 AI 漫畫翻譯器。它利用電腦視覺自動識別對話框，精確提取日、韓、英、中等文字，擦除原文字並覆蓋 12+ 種語言的譯文。" : "EBookCC 提供 AI 漫画翻译器。它利用计算机视觉自动识别对话框，精确提取日、韩、英、中等文本，擦除原文本并覆盖 12+ 种语言的译文。",
          keywords: ["translate manga", "ai ocr", "raw manga", "webtoon", "speech bubble"],
          links: [
            { text: isHant ? "線上翻譯生肉漫畫" : "在线翻译生肉漫画", view: "convert", description: isHant ? "AI 對話框檢測、擦除與文字翻譯" : "AI 对话框检测、擦除与文本翻译" },
            { text: isHant ? "創作漫畫與連環畫" : "创作漫画与连环画", view: "create", description: isHant ? "設計帶有對話框的多分鏡漫畫" : "设计带有对话框的多分镜漫画" }
          ]
        },
        {
          id: "faq-6",
          category: "comics",
          question: isHant ? "如何創作屬於我自己的 AI 漫畫、漫畫作品或視覺小說？" : "如何创作属于我自己 AI 漫画、漫画作品或视觉小说？",
          answer: isHant ? "EBookCC 擁有互動式漫畫畫布工作室。您支援 Wacom / Apple Pencil 壓感手繪，透過 AI 提示詞生成分鏡畫面或故事大綱，添加對話框並導出 CBZ 或 EPUB。" : "EBookCC 拥有交互式漫画画布工作室。您支持 Wacom / Apple Pencil 压感手绘，通过 AI 提示词生成分镜画面或故事大纲，添加对话框并导出 CBZ 或 EPUB。",
          keywords: ["create comic", "ai comic generator", "manga maker", "canvas creator"],
          links: [{ text: isHant ? "開啟漫畫畫布工作室" : "打开漫画画布工作室", view: "create", description: isHant ? "設計多分鏡漫畫並生成 AI 故事情節" : "设计多分镜漫画并生成 AI 故事情节" }]
        },
        {
          id: "faq-7",
          category: "ai",
          question: isHant ? "我可以使用哪些 AI 模型進行翻譯、OCR 文字識別和漫畫創作？" : "我可以使用哪些 AI 模型进行翻译、OCR 文字识别和漫画创作？",
          answer: isHant ? "EBookCC 支援多個 AI 提供商：Google Gemini (Gemini 2.5 Flash / Pro)、OpenAI (GPT-4o)、Anthropic Claude，以及本機運行的 Ollama 或 LM Studio 等本地 LLM 模型。" : "EBookCC 支持多个 AI 提供商：Google Gemini (Gemini 2.5 Flash / Pro)、OpenAI (GPT-4o)、Anthropic Claude，以及本地运行的 Ollama 或 LM Studio 等本地 LLM 模型。",
          keywords: ["ai models", "gemini", "openai", "claude", "ollama", "lm studio"],
          links: [{ text: isHant ? "配置 AI 與 API 金鑰" : "配置 AI 与 API 密钥", view: "home", description: isHant ? "在應用設定中設定 Gemini 或本機 AI" : "在应用设置中设置 Gemini 或本地 AI" }]
        },
        {
          id: "faq-8",
          category: "general",
          question: isHant ? "EBookCC 是免費的嗎？我上傳的檔案私密安全嗎？" : "EBookCC 是免费的吗？我上传的文件私密安全吗？",
          answer: isHant ? "是的！EBookCC 完全在您的網頁瀏覽器內部運行。所有檔案處理、圖片裁切、EPUB 編譯與閱讀均在您的用戶端本機進行，絕不上傳或出售給外部伺服器。" : "是的！EBookCC 完全 gamble 在您的网页浏览器内部运行。所有文件处理、图片裁切、EPUB 编译与阅读均在您的客户端本地进行，绝不上传或出售给外部服务器。",
          keywords: ["privacy", "offline", "free ebook reader", "browser local processing"],
          links: [
            { text: isHant ? "私密閱讀電子書" : "私密阅读电子书", view: "read", description: isHant ? "將本機檔案載入私密瀏覽器閱讀器" : "将本地文件加载入私密浏览器阅读器" },
            { text: isHant ? "返回首頁" : "返回首页", view: "home", description: isHant ? "探索 EBookCC 的所有功能" : "探索 EBookCC 的所有功能" }
          ]
        },
        {
          id: "faq-9",
          category: "ebooks",
          question: isHant ? "閱讀和轉換支援哪些檔案格式？" : "阅读和转换支持哪些文件格式？",
          answer: isHant ? "EBookCC 支援豐富的格式，包括 EPUB、PDF、CBZ、CBR、MOBI、AZW3、TXT、DOCX、HTML、WEBP、PNG、JPG 和 ZIP 漫畫壓縮檔。支援一鍵線上閱讀或格式轉換。" : "EBookCC 支持丰富的格式，包括 EPUB、PDF、CBZ、CBR、MOBI、AZW3、TXT、DOCX、HTML、WEBP、PNG、JPG 和 ZIP 漫画压缩包。支持一键在线阅读或格式转换。",
          keywords: ["formats", "epub", "pdf", "cbz", "cbr", "mobi", "docx"],
          links: [{ text: isHant ? "批量格式轉換" : "批量格式转换", view: "convert", description: isHant ? "在 EPUB、CBZ、PDF 與 MOBI 之間轉換" : "在 EPUB、CBZ、PDF 与 MOBI 之间转换" }]
        },
        {
          id: "faq-10",
          category: "general",
          question: isHant ? "如何在 E-Ink 墨水屏裝置（Kindle、Onyx Boox、Kobo）上閱讀電子書和漫畫？" : "如何在 E-Ink 墨水屏设备（Kindle、Onyx Boox、Kobo）上阅读电子书和漫画？",
          answer: isHant ? "EBookCC 提供專用的 E-Ink 墨水屏閱讀模式，具有高對比度黑白主題、加粗字型、禁用無效動畫及按鍵/點擊翻頁，專為電子墨水屏優化。" : "EBookCC 提供专用的 E-Ink 墨水屏阅读模式，具有高对比度黑白主题、加粗字体、禁用无效动画及按键/点击翻页，专为电子墨水屏优化。",
          keywords: ["e-ink", "onyx boox", "kobo", "kindle browser", "e-paper mode"],
          links: [{ text: isHant ? "使用 E-Ink 模式閱讀" : "使用 E-Ink 模式阅读", view: "read", description: isHant ? "無頻閃、高對比度舒適閱讀" : "无频闪、高对比度舒适阅读" }]
        },
        {
          id: "faq-11",
          category: "comics",
          question: isHant ? "如何在漫畫中添加手繪對話框和自訂對話文字？" : "如何在漫画中添加手绘对话框和自定义对话文字？",
          answer: isHant ? "在漫畫工作室中，選擇「對話框」工具即可自由手繪或選擇預設氣泡範本（對話、思考、大喊、低語），自由調整尾巴位置並輸入文字，字型會自動縮放。" : "在漫画工作室中，选择“对话框”工具即可自由手绘或选择预设气泡模板（对话、思考、大喊、低语），自由调整尾巴位置并输入文字，字体会自动缩放。",
          keywords: ["freehand bubbles", "speech bubbles", "dialogue", "comic studio"],
          links: [{ text: isHant ? "開啟漫畫工作室" : "打开漫画工作室", view: "create", description: isHant ? "手繪對話框並設計漫畫分鏡" : "手绘对话框并设计漫画分镜" }]
        },
        {
          id: "faq-12",
          category: "comics",
          question: isHant ? "分割分鏡線上閱讀是如何運作的？" : "分割分镜在线阅读是如何工作的？",
          answer: isHant ? "線上閱讀器提供分鏡切割模式，可將多格漫畫頁面分解為單個分鏡特寫。您可以使用鍵盤方向鍵或滑動手勢順序導覽第 1 格到第 2 格。" : "在线阅读器提供分镜切割模式，可将多格漫画页面分解为单个分镜特写。您可以使用键盘方向键或滑动手势顺序导航第 1 格到第 2 格。",
          keywords: ["split panels", "read online", "panel zoom", "manga reader"],
          links: [{ text: isHant ? "啟動線上閱讀器" : "启动在线阅读器", view: "read", description: isHant ? "透過分鏡引導放大閱讀漫畫" : "通过分镜引导放大阅读漫画" }]
        },
        {
          id: "faq-13",
          category: "comics",
          question: isHant ? "如何建立自訂漫畫拼圖和多格排版？" : "如何创建自定义漫画拼图和多格排版？",
          answer: isHant ? "透過漫畫工作室，您可以排版多格網格，將多張插圖組合為精美的漫畫拼圖，設定邊界與背景色，並導出為 CBZ 或 EPUB。" : "通过漫画工作室，您可以排版多格网格，将多张插图组合为精美的漫画拼图，设置边界与背景色，并导出为 CBZ 或 EPUB。",
          keywords: ["comic collage", "create collage", "panel layouts", "comic maker"],
          links: [{ text: isHant ? "建立漫畫拼圖" : "创建漫画拼图", view: "create", description: isHant ? "設計並導出多分鏡漫畫拼圖" : "设计并导出多分镜漫画拼图" }]
        },
        {
          id: "faq-14",
          category: "ai",
          question: isHant ? "YOLO AI 如何自動檢測漫畫分鏡和對話框？" : "YOLO AI 如何自动检测漫画分镜和对话框？",
          answer: isHant ? "EBookCC 整合電腦視覺模型（包括基於 YOLO 的分鏡檢測），能自動掃描漫畫頁面、分離矩形分鏡、定位對話框並提取文字座標，無需手動裁切。" : "EBookCC 整合计算机视觉模型（包括基于 YOLO 的分镜检测），能自动扫描漫画页面、分离矩形分镜、定位对话框并提取文本坐标，无需手动裁切。",
          keywords: ["yolo detect", "panel detection", "ai ocr", "automatic cropping"],
          links: [{ text: isHant ? "嘗試 YOLO 與 AI 檢測" : "尝试 YOLO 与 AI 检测", view: "convert", description: isHant ? "批量自動檢測分鏡與提取文字" : "批量自动检测分镜与提取文本" }]
        }
      ];

    default:
      // Fallback to English for other languages (or can be localized further)
      return getFAQItems("en");
  }
}
