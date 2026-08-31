import { LanguageCode } from "../context/LanguageContext";

export interface FAQLink {
  text: string;
  view?: "read" | "create" | "convert" | "home" | "faq" | "settings";
  action?: "settings";
  description: string;
}

export interface FAQItem {
  id: string;
  category: "ebooks" | "comics" | "ai" | "general";
  question: string;
  answer: string;
  keywords: string[];
  links?: FAQLink[];
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
    subtitle: "Everything you need to know about reading, converting, creating, and publishing e-books, comics, novels, raw manga translations, and Kindle-ready EPUB files on EBookCC.",
    searchPlaceholder: "Search topics (e.g., Kindle, CBZ, OCR, Manga, Publish, EPUB, Privacy)...",
    clear: "Clear",
    expandAll: "Expand All",
    collapseAll: "Collapse All",
    noMatchTitle: "No matching questions found",
    noMatchDesc: "Try searching with different keywords like 'Kindle', 'CBZ', 'Publish', 'EPUB', 'OCR', or 'Manga'.",
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
    cardStudioDesc: "Draw comic panels, write novels, publish to bookshelf, add speech bubbles, and export EPUBs.",
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
      "Publish comics and novels to the community bookshelf & cloud storage.",
      "Format documents into Amazon Send-to-Kindle compliant EPUBs.",
      "Write text stories, novels, and compile custom comic panels in one canvas.",
      "Edit book cover art, title, author, and table of contents metadata.",
      "Zero tracking — 100% private, client-side browser execution."
    ],
    btnConvert: "Convert Books & Comics Now",
    btnRead: "Open E-Book Web Reader",
    btnCreate: "Create & Publish Comic or Novel"
  },
  fr: {
    badge: "Centre d'Aide & Base de Connaissances",
    title: "Foire Aux Questions (FAQ)",
    subtitle: "Tout ce que vous devez savoir sur la lecture, la conversion, la création et la publication d'e-books, de bandes dessinées, de romans et de fichiers EPUB pour Kindle.",
    searchPlaceholder: "Rechercher un sujet (ex. Kindle, CBZ, OCR, Publier, Manga, EPUB, Confidentialité)...",
    clear: "Effacer",
    expandAll: "Tout Développer",
    collapseAll: "Tout Réduire",
    noMatchTitle: "Aucune question correspondante trouvée",
    noMatchDesc: "Essayez avec d'autres mots-clés comme 'Kindle', 'CBZ', 'Publier', 'EPUB', 'OCR' ou 'Manga'.",
    resetFilter: "Réinitialiser les Filtres",
    allTopics: "Tous les Sujets",
    catEbooks: "E-Books & Kindle",
    catComics: "Mangas & BD",
    catAi: "IA & Traduction",
    catGeneral: "Confidentialité & Général",
    cardReaderTitle: "Lecteur Web",
    cardReaderDesc: "Lisez EPUB, PDF, CBZ & CBR avec zoom guidé par case, mode E-ink et typographie personnalisée.",
    cardReaderAction: "Lancer le Lecteur",
    cardConverterTitle: "Convertisseur par Lot",
    cardConverterDesc: "Convertissez CBZ en EPUB, découpez les doubles pages manga, appliquez l'OCR PDF et traduisez les mangas.",
    cardConverterAction: "Ouvrir le Convertisseur",
    cardStudioTitle: "Studio BD & Histoire",
    cardStudioDesc: "Dessinez des cases, écrivez des romans, publiez vos œuvres, ajoutez des bulles et exportez en EPUB.",
    cardStudioAction: "Commencer à Créer",
    bottomTitle: "Besoin de solutions e-book et BD plus spécialisées ?",
    bottomReaderTitle: "Pour les Lecteurs de BD & Manga",
    bottomReaderList: [
      "Convertissez les archives CBZ et CBR en fichiers EPUB propres et valides.",
      "Découpez les doubles pages de manga verticalement pour smartphones.",
      "Extraction OCR de bulles de dialogue et traduction automatique de mangas.",
      "Mode de lecture guidée case par case pour un confort visuel optimal."
    ],
    bottomAuthorTitle: "Pour les Écrivains, Auteurs et Utilisateurs de Kindle",
    bottomAuthorList: [
      "Publiez des bandes dessinées et des romans sur la bibliothèque communautaire et le cloud.",
      "Formatez vos documents en EPUB compatibles avec Amazon Send-to-Kindle.",
      "Rédigez des histoires et des romans, puis assemblez vos cases dans un canevas unique.",
      "Éditez la couverture, le titre, l'auteur et la table des matières.",
      "Zéro suivi — exécution 100% privée en local dans le navigateur."
    ],
    btnConvert: "Convertir Livres & BD",
    btnRead: "Ouvrir le Lecteur Web",
    btnCreate: "Créer et Publier BD ou Roman"
  },
  ja: {
    badge: "ヘルプセンター＆ナレッジベース",
    title: "よくある質問 (FAQ)",
    subtitle: "EBookCCでの電子書籍、マンガ、小説の閲覧・変換・作成・公開（出版）に関するすべての情報。",
    searchPlaceholder: "トピックを検索 (例: Kindle, CBZ, OCR, マンガ, 公開, EPUB, プライバシー)...",
    clear: "クリア",
    expandAll: "すべて展開",
    collapseAll: "すべて折りたたむ",
    noMatchTitle: "一致する質問が見つかりませんでした",
    noMatchDesc: "'Kindle'、'CBZ'、'公開'、'EPUB'、'OCR'、'マンガ'などのキーワードでお試しください。",
    resetFilter: "検索フィルターをリセット",
    allTopics: "すべてのトピック",
    catEbooks: "電子書籍 & Kindle",
    catComics: "マンガ & コミック",
    catAi: "AI & 翻訳",
    catGeneral: "プライバシー & 一般",
    cardReaderTitle: "Webリーダー",
    cardReaderDesc: "EPUB、PDF、CBZ、CBRをコマ送りガイド、E-inkモード、カスタムフォントで快適に閲覧。",
    cardReaderAction: "リーダーを起動",
    cardConverterTitle: "一括コンバーター",
    cardConverterDesc: "CBZからEPUBへの一括変換、見開き自動分割、PDF OCR、生マンガの自動翻訳に対応。",
    cardConverterAction: "コンバーターを開く",
    cardStudioTitle: "コミック＆ストーリースタジオ",
    cardStudioDesc: "コマ描き、小説執筆、本棚への公開、吹き出し配置、EPUB書き出しをサポート。",
    cardStudioAction: "制作を開始する",
    bottomTitle: "より専門的な電子書籍・マンガソリューションをお探しですか？",
    bottomReaderTitle: "マンガ・コミック読者向け",
    bottomReaderList: [
      "CBZ・CBR圧縮ファイルを標準EPUBファイルに高品質変換。",
      "スマホ画面に合わせて見開きページを自動で縦分割。",
      "AI OCRによる吹き出し認識と外国語マンガの自動翻訳。",
      "目の疲れを軽減するコマ送りガイド閲覧モード。"
    ],
    bottomAuthorTitle: "作家・著者・Kindleユーザー向け",
    bottomAuthorList: [
      "マンガや小説をコミュニティ本棚＆クラウドストレージに公開・出版。",
      "Amazon Send-to-Kindle互換のEPUBフォーマットを作成。",
      "ひとつのキャンバスで小説執筆とマンガのコマ配置を統合。",
      "表紙画像、タイトル、著者名、目次メタデータを編集可能。",
      "追跡なし — ブラウザ内で100%完全ローカル処理。"
    ],
    btnConvert: "書籍・マンガを変換",
    btnRead: "Webリーダーを開く",
    btnCreate: "マンガや小説を作成・公開"
  },
  "zh-Hant": {
    badge: "說明中心與知識庫",
    title: "常見問題 (FAQ)",
    subtitle: "關於在 EBookCC 上閱讀、轉換、創作與發布電子書、漫畫、小說以及 Kindle 適用 EPUB 檔案的一切解答。",
    searchPlaceholder: "搜尋主題（例如：Kindle、CBZ、OCR、漫畫、發布、EPUB、隱私）...",
    clear: "清除",
    expandAll: "全部展開",
    collapseAll: "全部摺疊",
    noMatchTitle: "找不到相符的問題",
    noMatchDesc: "請嘗試搜尋其他關鍵字，如「Kindle」、「CBZ」、「發布」、「EPUB」、「OCR」或「漫畫」。",
    resetFilter: "重設搜尋篩選",
    allTopics: "所有主題",
    catEbooks: "電子書與 Kindle",
    catComics: "漫畫與繪本",
    catAi: "AI 與翻譯",
    catGeneral: "隱私與一般",
    cardReaderTitle: "線上閱讀器",
    cardReaderDesc: "閱讀 EPUB、PDF、CBZ 與 CBR，支援分鏡導覽放大、E-ink 墨水屏模式與自訂字型。",
    cardReaderAction: "啟動閱讀器",
    cardConverterTitle: "批次轉換器",
    cardConverterDesc: "批次將 CBZ 轉換為 EPUB、分割漫畫雙頁跨頁、掃描 PDF OCR 並即時翻譯漫畫。",
    cardConverterAction: "開啟轉換器",
    cardStudioTitle: "漫畫與故事創作室",
    cardStudioDesc: "繪製漫畫分鏡、撰寫小說故事、發布至社群書架、添加對話框並導出 EPUB。",
    cardStudioAction: "開始創作",
    bottomTitle: "需要更專業的電子書與漫畫解決方案？",
    bottomReaderTitle: "針對漫畫與繪本讀者",
    bottomReaderList: [
      "將 CBZ 與 CBR 壓縮檔轉換為規範的 EPUB 檔案。",
      "將漫畫跨頁雙頁自動垂直分割為直式手機單頁。",
      "AI OCR 自動對話框文字提取與外國生肉漫畫翻譯。",
      "分鏡引導逐格閱讀模式，極大減輕視覺疲勞。"
    ],
    bottomAuthorTitle: "針對作家、創作者與 Kindle 使用者",
    bottomAuthorList: [
      "將創作的漫畫與小說發布至社群書架與雲端儲存。",
      "將文檔格式化為相容 Amazon Send-to-Kindle 的 EPUB。",
      "在單一畫布中編寫故事小說並排版漫畫分鏡。",
      "自訂編輯書籍封面、書名、作者及目錄元資料。",
      "零追蹤 — 100% 瀏覽器本機私密運行。"
    ],
    btnConvert: "立即轉換書籍與漫畫",
    btnRead: "開啟線上閱讀器",
    btnCreate: "創作並發布漫畫或小說"
  },
  "zh-Hans": {
    badge: "帮助中心与知识库",
    title: "常见问题 (FAQ)",
    subtitle: "关于在 EBookCC 上阅读、转换、创作与发布电子书、漫画、小说以及 Kindle 适用 EPUB 文件的一切解答。",
    searchPlaceholder: "搜索主题（例如：Kindle、CBZ、OCR、漫画、发布、EPUB、隐私）...",
    clear: "清除",
    expandAll: "全部展开",
    collapseAll: "全部折叠",
    noMatchTitle: "未找到匹配的问题",
    noMatchDesc: "请尝试搜索其他关键词，如“Kindle”、“CBZ”、“发布”、“EPUB”、“OCR”或“漫画”。",
    resetFilter: "重置搜索筛选",
    allTopics: "所有主题",
    catEbooks: "电子书与 Kindle",
    catComics: "漫画与绘本",
    catAi: "AI 与翻译",
    catGeneral: "隐私与常规",
    cardReaderTitle: "在线阅读器",
    cardReaderDesc: "阅读 EPUB、PDF、CBZ 与 CBR，支持分镜引导放大、E-ink 墨水屏模式与自定义字体。",
    cardReaderAction: "启动阅读器",
    cardConverterTitle: "批量转换器",
    cardConverterDesc: "批量将 CBZ 转换为 EPUB、切分漫画双页跨页、扫描 PDF OCR 并即时翻译漫画。",
    cardConverterAction: "打开转换器",
    cardStudioTitle: "漫画与故事创作室",
    cardStudioDesc: "绘制漫画分镜、编写小说故事、发布至社区书架、添加对话框并导出 EPUB。",
    cardStudioAction: "开始创作",
    bottomTitle: "需要更专业的电子书与漫画解决方案？",
    bottomReaderTitle: "针对漫画与绘本读者",
    bottomReaderList: [
      "将 CBZ 与 CBR 压缩包转换为规范的 EPUB 文件。",
      "将漫画跨页双页自动垂直切分为竖屏手机单页。",
      "AI OCR 自动对话框文本提取与外国生肉漫画翻译。",
      "分镜引导逐格阅读模式，极大减轻视觉疲劳。"
    ],
    bottomAuthorTitle: "针对作家、创作者与 Kindle 用户",
    bottomAuthorList: [
      "将创作的漫画与小说发布至社区书架与云端存储。",
      "将文档格式化为兼容 Amazon Send-to-Kindle 的 EPUB。",
      "在单一画布中编写故事小说并排版漫画分镜。",
      "自定义编辑书籍封面、书名、作者及目录元数据。",
      "零追踪 — 100% 浏览器本地私密运行。"
    ],
    btnConvert: "立即转换书籍与漫画",
    btnRead: "打开在线阅读器",
    btnCreate: "创作并发布漫画或小说"
  },
  es: {
    badge: "Centro de Ayuda y Base de Conocimientos",
    title: "Preguntas Frecuentes (FAQ)",
    subtitle: "Todo lo que necesitas saber sobre leer, convertir, crear y publicar e-books, cómics, novelas y archivos EPUB para Kindle en EBookCC.",
    searchPlaceholder: "Buscar temas (ej. Kindle, CBZ, OCR, Manga, Publicar, EPUB, Privacidad)...",
    clear: "Borrar",
    expandAll: "Expandir Todo",
    collapseAll: "Contraer Todo",
    noMatchTitle: "No se encontraron preguntas coincidentes",
    noMatchDesc: "Prueba con palabras clave como 'Kindle', 'CBZ', 'Publicar', 'EPUB', 'OCR' o 'Manga'.",
    resetFilter: "Restablecer Filtros",
    allTopics: "Todos los Temas",
    catEbooks: "E-Books y Kindle",
    catComics: "Manga y Cómics",
    catAi: "IA y Traducción",
    catGeneral: "Privacidad y General",
    cardReaderTitle: "Lector Web",
    cardReaderDesc: "Lee EPUB, PDF, CBZ y CBR con zoom guiado en viñetas, modo E-ink y tipografía personalizada.",
    cardReaderAction: "Abrir Lector",
    cardConverterTitle: "Conversor por Lotes",
    cardConverterDesc: "Convierte CBZ a EPUB, divide páginas dobles de manga, escanea OCR en PDF y traduce mangas.",
    cardConverterAction: "Abrir Conversor",
    cardStudioTitle: "Estudio de Cómics e Historias",
    cardStudioDesc: "Dibuja viñetas, escribe novelas, publica en la estantería, agrega bocadillos y exporta en EPUB.",
    cardStudioAction: "Empezar a Crear",
    bottomTitle: "¿Necesitas soluciones especializadas para libros y cómics?",
    bottomReaderTitle: "Para Lectores de Cómics y Manga",
    bottomReaderList: [
      "Convierte archivos CBZ y CBR en e-books EPUB limpios.",
      "Divide páginas dobles de manga en páginas simples para móvil.",
      "Extracción de texto mediante OCR y traducción automática con IA.",
      "Modo de lectura guiada viñeta por viñeta para mayor comodidad visual."
    ],
    bottomAuthorTitle: "Para Escritores, Autores y Usuarios de Kindle",
    bottomAuthorList: [
      "Publica cómics y novelas en la estantería comunitaria y en el almacenamiento en la nube.",
      "Da formato a tus documentos para enviar a Kindle de Amazon.",
      "Escribe historias y novelas, y organiza viñetas en un solo lienzo.",
      "Edita portada, título, autor y metadatos de la tabla de contenidos.",
      "Sin seguimiento — 100% privado en tu navegador."
    ],
    btnConvert: "Convertir Libros y Cómics",
    btnRead: "Abrir Lector Web",
    btnCreate: "Crear y Publicar Cómic o Novela"
  },
  pt: {
    badge: "Central de Ajuda e Base de Conhecimento",
    title: "Perguntas Frequentes (FAQ)",
    subtitle: "Tudo o que você precisa saber sobre leitura, conversão, criação e publicação de e-books, quadrinhos, romances e arquivos EPUB no EBookCC.",
    searchPlaceholder: "Pesquisar tópicos (ex.: Kindle, CBZ, OCR, Publicar, Mangá, EPUB, Privacidade)...",
    clear: "Limpar",
    expandAll: "Expandir Tudo",
    collapseAll: "Recolher Tudo",
    noMatchTitle: "Nenhuma pergunta correspondente encontrada",
    noMatchDesc: "Tente pesquisar com palavras-chave como 'Kindle', 'CBZ', 'Publicar', 'EPUB', 'OCR' ou 'Mangá'.",
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
    cardStudioDesc: "Desenhe quadros, escreva romances, publique na estante, adicione balões de fala e exporte em EPUB.",
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
      "Publique quadrinhos e romances na estante comunitária e no armazenamento em nuvem.",
      "Formate documentos em EPUB compatíveis com Amazon Send-to-Kindle.",
      "Escreva histórias e romances, e organize painéis de quadrinhos em uma tela única.",
      "Edite capa, título, autor e sumário.",
      "Sem rastreamento — 100% privado no seu navegador."
    ],
    btnConvert: "Converter Livros e Quadrinhos",
    btnRead: "Abrir Leitor Web",
    btnCreate: "Criar e Publicar Quadrinho ou Romance"
  },
  ko: {
    badge: "도움말 센터 및 지식 베이스",
    title: "자주 묻는 질문 (FAQ)",
    subtitle: "EBookCC에서 전자책, 만화, 소설의 읽기, 변환, 제작 및 게시(출판)에 관한 모든 내용.",
    searchPlaceholder: "주제 검색 (예: Kindle, CBZ, OCR, 게시, 만화, EPUB, 개인정보 보호)...",
    clear: "지우기",
    expandAll: "모두 펼치기",
    collapseAll: "모두 접기",
    noMatchTitle: "일치하는 질문을 찾을 수 없습니다",
    noMatchDesc: "'Kindle', 'CBZ', '게시', 'EPUB', 'OCR' 또는 '만화'와 같은 다른 키워드로 검색해 보세요.",
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
    cardStudioDesc: "컷 그리기, 소설 집필, 책장 게시, 말풍선 추가 및 EPUB 내보내기를 지원합니다.",
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
      "만화와 소설을 커뮤니티 책장 및 클라우드 저장소에 게시/출판.",
      "Amazon Send-to-Kindle 지원 규격의 EPUB 문서 생성.",
      "단일 캔버스에서 소설 스토리 작성과 만화 컷 배치를 통합.",
      "표지 이미지, 제목, 저자, 목차 메타데이터 수정 가능.",
      "추적 제로 — 100% 브라우저 로컬 개인정보 보호."
    ],
    btnConvert: "지금 책 & 만화 변환하기",
    btnRead: "웹 리더 열기",
    btnCreate: "만화 또는 소설 제작 및 게시"
  },
  de: {
    badge: "Hilfe-Center & Wissensdatenbank",
    title: "Häufig gestellte Fragen (FAQ)",
    subtitle: "Alles, was Sie über das Lesen, Konvertieren, Erstellen und Veröffentlichen von E-Books, Comics, Romanen und Kindle-EPUB-Dateien auf EBookCC wissen müssen.",
    searchPlaceholder: "Themen suchen (z. B. Kindle, CBZ, OCR, Veröffentlichen, Manga, EPUB)...",
    clear: "Löschen",
    expandAll: "Alle ausklappen",
    collapseAll: "Alle einklappen",
    noMatchTitle: "Keine passenden Fragen gefunden",
    noMatchDesc: "Suchen Sie mit Begriffen wie 'Kindle', 'CBZ', 'Veröffentlichen', 'EPUB', 'OCR' oder 'Manga'.",
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
    cardStudioDesc: "Zeichnen Sie Panels, schreiben Sie Romane, veröffentlichen Sie im Regal, fügen Sie Sprechblasen hinzu.",
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
      "Veröffentlichen Sie Comics und Romane im Community-Bücherregal und Cloud-Speicher.",
      "Formatieren Sie Dokumente für Amazon Send-to-Kindle.",
      "Schreiben Sie Geschichten und Romane auf einer Leinwand.",
      "Bearbeiten Sie Buchcover, Titel, Autor und Inhaltsverzeichnis.",
      "Kein Tracking — 100% private Ausführung im Browser."
    ],
    btnConvert: "Bücher & Comics konvertieren",
    btnRead: "Web-Reader öffnen",
    btnCreate: "Comic oder Roman erstellen & veröffentlichen"
  },
  ar: {
    badge: "مركز المساعدة وقاعدة المعرفة",
    title: "الأسئلة الشائعة (FAQ)",
    subtitle: "كل ما تحتاج معرفته حول قراءة وتحويل وإنشاء ونشر الكتب الإلكترونية، والقصص المصورة، والروايات وملفات EPUB لـ Kindle على EBookCC.",
    searchPlaceholder: "البحث في المواضيع (مثل Kindle، CBZ، OCR، نشر، المانغا، EPUB، الخصوصية)...",
    clear: "مسح",
    expandAll: "توسيع الكل",
    collapseAll: "طي الكل",
    noMatchTitle: "لم يتم العثور على أسئلة مطابقة",
    noMatchDesc: "جرب البحث بكلمات مثل 'Kindle' أو 'CBZ' أو 'نشر' أو 'EPUB' أو 'OCR' أو 'Manga'.",
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
    cardStudioDesc: "ارسم إطارات الكوميكس، اكتب الروايات، انشر في الرف، أضف فقاعات الكلام وصدر بصيغة EPUB.",
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
      "نشر القصص المصورة والروايات في مكتبة المجتمع والتخزين السحابي.",
      "تنسيق المستندات لتصبح متوافقة مع خدمة Send-to-Kindle من أمازون.",
      "كتابة القصص والروايات وتنسيق الإطارات في لوحة واحدة.",
      "تعديل غلاف الكتاب، العنوان، اسم المؤلف وجدول المحتويات.",
      "بدون تتبع — تنفيذ خاص 100% داخل المتصفح المحلي."
    ],
    btnConvert: "تحويل الكتب والكوميكس الآن",
    btnRead: "فتح القارئ الإلكتروني",
    btnCreate: "إنشاء ونشر كوميكس أو رواية"
  },
  ru: {
    badge: "Центр помощи и база знаний",
    title: "Часто задаваемые вопросы (FAQ)",
    subtitle: "Всё, что вам нужно знать о чтении, конвертации, создании и публикации электронных книг, комиксов, новелл и файлов EPUB для Kindle на EBookCC.",
    searchPlaceholder: "Поиск по темам (например, Kindle, CBZ, OCR, Публикация, Манга, EPUB)...",
    clear: "Очистить",
    expandAll: "Развернуть все",
    collapseAll: "Свернуть все",
    noMatchTitle: "Совпадающих вопросов не найдено",
    noMatchDesc: "Попробуйте поискать по словам 'Kindle', 'CBZ', 'Публикация', 'EPUB', 'OCR' или 'Манга'.",
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
    cardStudioDesc: "Рисуйте кадры, пишите новеллы, публикуйте на полку, добавляйте облака текста и экспортируйте в EPUB.",
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
      "Публикуйте комиксы и новеллы на книжной полке сообщества и в облачном хранилище.",
      "Форматируйте документы в EPUB, совместимый с Amazon Send-to-Kindle.",
      "Пишите истории и новеллы, компонуйте кадры комиксов на едином холсте.",
      "Редактируйте обложку, название, автора и оглавление.",
      "Без отслеживания — 100% приватная обработка в браузере."
    ],
    btnConvert: "Конвертировать книги и комиксы",
    btnRead: "Открыть веб-ридер",
    btnCreate: "Создать и опубликовать комикс или новеллу"
  },
  it: {
    badge: "Centro Assistenza & Knowledge Base",
    title: "Domande Frequenti (FAQ)",
    subtitle: "Tutto ciò che devi sapere su lettura, conversione, creazione e pubblicazione di e-book, fumetti, romanzi e file EPUB per Kindle su EBookCC.",
    searchPlaceholder: "Cerca argomenti (es. Kindle, CBZ, OCR, Pubblicare, Manga, EPUB, Privacy)...",
    clear: "Cancella",
    expandAll: "Espandi Tutto",
    collapseAll: "Comprimi Tutto",
    noMatchTitle: "Nessuna domanda corrispondente trovata",
    noMatchDesc: "Prova a cercare con parole chiave come 'Kindle', 'CBZ', 'Pubblicare', 'EPUB', 'OCR' o 'Manga'.",
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
    cardStudioDesc: "Disegna vignette, scrivi romanzi, pubblica sulla libreria, aggiungi fumetti di testo ed esporta in EPUB.",
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
      "Pubblica fumetti e romanzi nella libreria della community e nel cloud storage.",
      "Formatta i documenti in EPUB compatibili con Amazon Send-to-Kindle.",
      "Scrivi storie e romanzi, e organizza vignette su una tela unica.",
      "Modifica copertina, titolo, autore e sommario.",
      "Zero tracciamento — 100% privato nel tuo browser."
    ],
    btnConvert: "Converti Libri e Fumetti Ora",
    btnRead: "Apri Lettore Web",
    btnCreate: "Crea e Pubblica Fumetto o Romanzo"
  }
};

export function getFAQUIStrings(lang: LanguageCode): FAQUIStrings {
  return UI_STRINGS[lang] || UI_STRINGS.en;
}

const EN_FAQ_ITEMS: FAQItem[] = [
  {
    id: "faq-1",
    category: "ebooks",
    question: "How do I convert CBZ, CBR, or PDF comics to EPUB for Kindle, Kobo, or Apple Books?",
    answer: "You can convert CBZ, CBR, or PDF comic archives directly into EPUB using the universal converter on EBookCC. Upload your archive, choose 'EPUB' or 'Kindle EPUB' output, enable image compression or page splitting if needed, and click Convert. The resulting EPUB maintains high image quality while optimizing file size for e-readers.",
    keywords: ["cbz", "cbr", "pdf", "epub", "kindle", "kobo", "apple books", "convert"],
    links: [
      { text: "Open Batch Converter", view: "convert", description: "Convert CBZ, CBR, PDF & EPUB files in bulk" },
      { text: "Launch Web Reader", view: "read", description: "Read EPUB or CBZ books directly in your browser" }
    ]
  },
  {
    id: "faq-2",
    category: "ebooks",
    question: "How do I send converted EPUB e-books directly to my Kindle device?",
    answer: "After converting your files to EPUB on EBookCC, download the EPUB file and use Amazon's official 'Send to Kindle' service (amazon.com/sendtokindle) or email the file to your Kindle delivery address. Modern Kindle devices and apps natively accept standard EPUB files.",
    keywords: ["send to kindle", "amazon kindle", "epub kindle", "paperwhite", "e-reader"],
    links: [{ text: "Convert for Kindle", view: "convert", description: "Format comics and text books for Amazon Kindle" }]
  },
  {
    id: "faq-3",
    category: "ebooks",
    question: "Can I reflow or extract clean text from PDF textbooks and scanned documents?",
    answer: "Yes! EBookCC incorporates an AI OCR and text reflow engine. When you upload a PDF textbook or scanned image bundle, OCR recognizes the text, cleans line breaks, and allows you to export reflowable EPUB, HTML, or plain text.",
    keywords: ["ocr", "pdf textbook", "reflow", "extract text", "scanned pdf", "epub"],
    links: [{ text: "Try PDF OCR & Converter", view: "convert", description: "Extract text and convert to reflowable EPUB" }]
  },
  {
    id: "faq-4",
    category: "comics",
    question: "How does the dual-page manga splitter work for smartphone reading?",
    answer: "Double-page manga spreads are often hard to read on small phone screens. EBookCC automatically detects dual-page spreads, splits them vertically into clean single pages, and organizes the reading order according to Japanese right-to-left or Western left-to-right flow.",
    keywords: ["manga", "dual page", "page splitter", "mobile reading", "spreads"],
    links: [
      { text: "Try Page Splitter", view: "convert", description: "Split dual-page spreads into single mobile pages" },
      { text: "Launch Manga Reader", view: "read", description: "Read with guided panel zoom & webtoon scroll mode" }
    ]
  },
  {
    id: "faq-5",
    category: "comics",
    question: "How do I automatically translate raw Japanese manga, Korean Webtoons, or foreign comics?",
    answer: "EBookCC includes a built-in AI Manga & Webtoon Translator. It uses computer vision to automatically detect speech bubbles, extracts text via OCR (Japanese, Korean, Chinese, English), removes the original text, and overlays clean translated text in your choice of 12+ languages.",
    keywords: ["translate manga", "ai ocr", "raw manga", "webtoon", "speech bubble", "translation"],
    links: [
      { text: "Translate Raw Manga Online", view: "convert", description: "AI speech bubble detection, inpainting & translation" },
      { text: "Create Comics & Stories", view: "create", description: "Design multi-panel comics with speech balloons" }
    ]
  },
  {
    id: "faq-6",
    category: "comics",
    question: "How can I create my own AI comics, manga strips, or visual novels?",
    answer: "EBookCC features an interactive Comic & Story Studio canvas. You can draw with Wacom or Apple Pencil pressure sensitivity, generate panel imagery and storylines with AI prompts, add custom speech bubbles, and export directly as CBZ or EPUB.",
    keywords: ["create comic", "ai comic generator", "manga maker", "canvas creator", "story studio"],
    links: [{ text: "Open Comic Studio", view: "create", description: "Design multi-panel comics and generate AI stories" }]
  },
  {
    id: "faq-7",
    category: "ai",
    question: "Which AI models can I use for translation, OCR, and comic creation?",
    answer: "EBookCC supports multiple AI providers: Google Gemini, OpenAI, Anthropic Claude, Qwen, and local LLMs via Ollama or LM Studio for complete offline privacy.",
    keywords: ["ai models", "gemini", "openai", "claude", "qwen", "ollama", "lm studio", "api keys", "configure ai"],
    links: [{ text: "Configure AI & API Keys", action: "settings", description: "Set up Gemini, OpenAI, Anthropic Claude, Qwen, or local AI models in app settings" }]
  },
  {
    id: "faq-15",
    category: "comics",
    question: "How do I publish comics and novels to the community bookshelf and cloud storage?",
    answer: "In the Comic & Story Studio, click the menu in the top right and select 'Publish'. You can publish both illustrated comics and written novels directly to cloud storage and the public Bookshelf. Once published, readers worldwide can view your work in the Web Reader with live Metro-style animated previews, comment on panels, and you can edit or update your published works anytime from your creator workspace.",
    keywords: ["publish", "publish comics and novels", "publish comic", "publish novel", "bookshelf", "cloud storage", "community", "share stories", "author"],
    links: [
      { text: "Publish Comics & Novels", view: "create", description: "Create, format and publish your stories and comics" },
      { text: "Browse Community Bookshelf", view: "read", description: "Read published comics and novels" }
    ]
  },
  {
    id: "faq-8",
    category: "general",
    question: "Is EBookCC completely free to use and are my files private?",
    answer: "Yes! EBookCC runs entirely inside your modern web browser. All file processing, image cropping, EPUB compilation, and reading take place locally on your client device. Your private files are never sold or uploaded to unauthorized external servers.",
    keywords: ["privacy", "offline", "free ebook reader", "browser local processing", "security"],
    links: [
      { text: "Read Privately in Web Reader", view: "read", description: "Load local books into private browser reader" },
      { text: "Back to Home", view: "home", description: "Explore all features and tools" }
    ]
  },
  {
    id: "faq-9",
    category: "ebooks",
    question: "What file formats are supported for reading and conversion?",
    answer: "EBookCC supports a wide array of formats including EPUB, PDF, CBZ, CBR, MOBI, AZW3, TXT, DOCX, HTML, WEBP, PNG, JPG, and ZIP comic archives. You can read them directly or batch convert them with one click.",
    keywords: ["formats", "epub", "pdf", "cbz", "cbr", "mobi", "docx", "webp"],
    links: [{ text: "Batch Format Converter", view: "convert", description: "Convert between EPUB, CBZ, PDF & MOBI" }]
  },
  {
    id: "faq-10",
    category: "general",
    question: "How do I read books and comics on E-Ink devices (Kindle, Onyx Boox, Kobo)?",
    answer: "EBookCC includes a dedicated E-Ink reading mode featuring high-contrast black-and-white palettes, bold typography, flicker-free transitions, and key/tap navigation optimized for electronic paper displays.",
    keywords: ["e-ink", "onyx boox", "kobo", "kindle browser", "e-paper mode", "high contrast"],
    links: [{ text: "Read with E-Ink Mode", view: "read", description: "Enjoy high-contrast, flicker-free reading" }]
  },
  {
    id: "faq-11",
    category: "comics",
    question: "How do I add freehand speech bubbles and custom dialogue text?",
    answer: "In the Comic Studio, select the Speech Bubble tool to draw freehand bubbles or choose from preset templates (speech, thought, shout, whisper). Drag tail handles to target characters, and enter dialogue with automatic text auto-sizing.",
    keywords: ["freehand bubbles", "speech bubbles", "dialogue", "comic studio", "comic bubbles"],
    links: [{ text: "Open Comic Studio", view: "create", description: "Draw speech bubbles and design panels" }]
  },
  {
    id: "faq-12",
    category: "comics",
    question: "How does split-panel online reading work in the Web Reader?",
    answer: "The Web Reader includes a panel-splitting mode that breaks complex comic pages into individual panel close-ups. You can navigate through panels sequentially with keyboard arrows or swipe gestures.",
    keywords: ["split panels", "read online", "panel zoom", "manga reader", "guided view"],
    links: [{ text: "Launch Web Reader", view: "read", description: "Read comics with guided panel zoom" }]
  },
  {
    id: "faq-13",
    category: "comics",
    question: "How do I create custom comic collages and multi-panel layouts?",
    answer: "Using the Comic Studio, you can place multi-panel grid layouts, combine multiple illustrations into a cohesive collage, configure borders and background colors, and export as CBZ or EPUB.",
    keywords: ["comic collage", "create collage", "panel layouts", "comic maker"],
    links: [{ text: "Create Comic Collage", view: "create", description: "Design and export multi-panel collages" }]
  },
  {
    id: "faq-14",
    category: "ai",
    question: "How does YOLO AI automatically detect comic panels and speech bubbles?",
    answer: "EBookCC integrates computer vision models (including YOLO-based panel detection) that scan comic pages to automatically separate rectangular panels, locate speech bubbles, and extract text coordinates without manual cropping.",
    keywords: ["yolo detect", "panel detection", "ai ocr", "automatic cropping", "speech bubbles"],
    links: [{ text: "Try YOLO & OCR Detection", view: "convert", description: "Batch detect panels and extract text" }]
  }
];

export function getFAQItems(lang: LanguageCode): FAQItem[] {
  switch (lang) {
    case "en":
      return EN_FAQ_ITEMS;

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
          answer: "EBookCC prend en charge plusieurs fournisseurs d'IA : Google Gemini, OpenAI, Anthropic Claude, Qwen, ainsi que des modèles LLM locaux comme Ollama ou LM Studio pour une confidentialité totale hors ligne.",
          keywords: ["ia", "gemini", "openai", "claude", "qwen", "ollama", "lm studio", "api"],
          links: [{ text: "Configurer les Clés d'IA & API", action: "settings", description: "Régler Gemini, OpenAI, Claude, Qwen ou vos LLM locaux" }]
        },
        {
          id: "faq-15",
          category: "comics",
          question: "Comment publier des bandes dessinées et des romans sur la bibliothèque communautaire et le stockage cloud ?",
          answer: "Dans le Studio BD & Histoire, cliquez sur le menu en haut à droite et sélectionnez 'Publier'. Vous pouvez publier vos bandes dessinées illustrées ainsi que vos romans écrits directement sur le stockage cloud et la bibliothèque publique. Une fois publiés, vos œuvres sont visibles par les lecteurs du monde entier dans le Lecteur Web avec prévisualisations animées de style Metro, commentaires sur les cases, et vous pouvez les modifier à tout moment depuis votre espace créateur.",
          keywords: ["publier", "publier bd et romans", "publier manga", "publier roman", "bibliotheque", "cloud", "communaute"],
          links: [
            { text: "Publier BD & Romans", view: "create", description: "Créer et publier vos bandes dessinées et romans" },
            { text: "Explorer la Bibliothèque", view: "read", description: "Découvrir les œuvres publiées par la communauté" }
          ]
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
          answer: "EBookCCは複数のAIプロバイダーに対応しています：Google Gemini、OpenAI、Anthropic Claude、Qwen、さらにOllamaやLM StudioなどのローカルLLMに対応しており、オフラインで完全にプライベートな環境で利用可能です。",
          keywords: ["aiモデル", "gemini", "openai", "claude", "qwen", "ollama", "lm studio", "apiキー"],
          links: [{ text: "AI & APIキーの設定", action: "settings", description: "Gemini、OpenAI、Claude、QwenやローカルLLMを設定" }]
        },
        {
          id: "faq-15",
          category: "comics",
          question: "作成したマンガや小説をコミュニティ本棚やクラウドに公開（出版）するにはどうすればよいですか？",
          answer: "コミック＆ストーリースタジオの右上メニューから『公開』を選択します。イラスト付きマンガや執筆した小説をクラウドストレージおよびパブリック本棚へ直接公開できます。公開された作品はWebリーダーでMetroスタイルのライブアニメーションプレビュー付きで世界中の読者が閲覧可能になり、コマごとのコメント機能や、作者自身によるいつでもの再編集・更新に対応しています。",
          keywords: ["公開", "出版", "マンガ公開", "小説公開", "本棚", "クラウドストレージ", "コミュニティ"],
          links: [
            { text: "マンガ・小説を公開する", view: "create", description: "作品を制作して本棚へ公開" },
            { text: "コミュニティ本棚を閲覧", view: "read", description: "公開されたマンガや小説を読む" }
          ]
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
    case "zh-Hans": {
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
          question: isHant ? "漫畫雙頁切割器在手機閱讀上是如何運作的？" : "漫画双页切割器在手机阅读上是如何工作的？",
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
          question: isHant ? "如何創作屬於我自己的 AI 漫畫、漫畫作品或視覺小說？" : "如何创作属于我自己的 AI 漫画、漫画作品或视觉小说？",
          answer: isHant ? "EBookCC 擁有互動式漫畫畫布工作室。支援 Wacom / Apple Pencil 壓感手繪，透過 AI 提示詞生成分鏡畫面或故事大綱，添加對話框並導出 CBZ 或 EPUB。" : "EBookCC 拥有交互式漫画画布工作室。支持 Wacom / Apple Pencil 压感手绘，通过 AI 提示词生成分镜画面或故事大纲，添加对话框并导出 CBZ 或 EPUB。",
          keywords: ["create comic", "ai comic generator", "manga maker", "canvas creator"],
          links: [{ text: isHant ? "開啟漫畫畫布工作室" : "打开漫画画布工作室", view: "create", description: isHant ? "設計多分鏡漫畫並生成 AI 故事情節" : "设计多分镜漫画并生成 AI 故事情节" }]
        },
        {
          id: "faq-7",
          category: "ai",
          question: isHant ? "我可以使用哪些 AI 模型進行翻譯、OCR 文字識別和漫畫創作？" : "我可以使用哪些 AI 模型进行翻译、OCR 文字识别和漫画创作？",
          answer: isHant ? "EBookCC 支援多個 AI 提供商：Google Gemini、OpenAI、Anthropic Claude、Qwen，以及本機運行的 Ollama 或 LM Studio 等本地 LLM 模型，提供完全離線的隱私保護。" : "EBookCC 支持多个 AI 提供商：Google Gemini、OpenAI、Anthropic Claude、Qwen，以及本地运行的 Ollama 或 LM Studio 等本地 LLM 模型，提供完全离线的隐私保护。",
          keywords: ["ai models", "gemini", "openai", "claude", "qwen", "ollama", "lm studio", "api keys"],
          links: [{ text: isHant ? "配置 AI 與 API 金鑰" : "配置 AI 与 API 密钥", action: "settings", description: isHant ? "在應用設定中設定 Gemini、OpenAI、Claude、Qwen 或本機 AI" : "在应用设置中设置 Gemini、OpenAI、Claude、Qwen 或本地 AI" }]
        },
        {
          id: "faq-15",
          category: "comics",
          question: isHant ? "如何將創作的漫畫與小說發布到社群書架與雲端儲存？" : "如何将创作的漫画与小说发布到社区书架与云端存储？",
          answer: isHant ? "在漫畫與故事創作室中，點擊右上角選單並選擇「發布」。您可以將繪製的連環漫畫與原創小說直接發布至雲端儲存與公共書架。發布後，全球讀者均可在線上閱讀器中透過動態 Metro 風格預覽閱讀您的作品、發表分鏡評論，身為作者您亦可隨時在創作者工作區重新編輯或更新發布內容。" : "在漫画与故事创作室中，点击右上角菜单并选择“发布”。您可以将绘制的连环漫画与原创小说直接发布至云端存储与公共书架。发布后，全球读者均可在在线阅读器中通过动态 Metro 风格预览阅读您的作品、发表分镜评论，身为作者您亦可随时在创作者工作区重新编辑或更新发布内容。",
          keywords: ["publish", "publish comics and novels", "publish comic", "publish novel", "bookshelf", "cloud storage", "community", "share stories"],
          links: [
            { text: isHant ? "發布漫畫與小說" : "发布漫画与小说", view: "create", description: isHant ? "創作並發布您的作品" : "创作并发布您的作品" },
            { text: isHant ? "瀏覽社群書架" : "浏览社区书架", view: "read", description: isHant ? "探索社群發布的漫畫與小說" : "探索社区发布的漫画与小说" }
          ]
        },
        {
          id: "faq-8",
          category: "general",
          question: isHant ? "EBookCC 是免費的嗎？我上傳的檔案私密安全嗎？" : "EBookCC 是免费的吗？我上传的文件私密安全吗？",
          answer: isHant ? "是的！EBookCC 完全在您的網頁瀏覽器內部運行。所有檔案處理、圖片裁切、EPUB 編譯與閱讀均在您的用戶端本機進行，絕不上傳或出售給外部伺服器。" : "是的！EBookCC 完全在您的网页浏览器内部运行。所有文件处理、图片裁切、EPUB 编译与阅读均在您的客户端本地进行，绝不上传或出售给外部服务器。",
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
    }

    case "es":
      return [
        {
          id: "faq-1",
          category: "ebooks",
          question: "¿Cómo convierto cómics CBZ, CBR o PDF a EPUB para Kindle, Kobo o Apple Books?",
          answer: "Puedes convertir archivos de cómics CBZ, CBR o PDF directamente a EPUB usando el conversor universal de EBookCC. Sube tu archivo, elige salida 'EPUB' o 'Kindle EPUB', activa compresión si lo requieres y pulsa Convertir.",
          keywords: ["cbz", "cbr", "pdf", "epub", "kindle", "convertir"],
          links: [
            { text: "Abrir Conversor por Lotes", view: "convert", description: "Convertir CBZ, CBR, PDF y EPUB" },
            { text: "Abrir Lector Web", view: "read", description: "Leer libros en tu navegador" }
          ]
        },
        {
          id: "faq-2",
          category: "ebooks",
          question: "¿Cómo envío e-books EPUB convertidos directamente a mi Kindle?",
          answer: "Tras convertir a EPUB en EBookCC, descarga el archivo y utiliza 'Send to Kindle' de Amazon (amazon.com/sendtokindle) o envíalo por correo a tu dirección de Kindle.",
          keywords: ["send to kindle", "kindle", "epub kindle"],
          links: [{ text: "Convertir para Kindle", view: "convert", description: "Dar formato para Amazon Kindle" }]
        },
        {
          id: "faq-3",
          category: "ebooks",
          question: "¿Puedo extraer texto limpio de libros de texto PDF y documentos escaneados?",
          answer: "¡Sí! EBookCC cuenta con un motor de OCR e IA que reconoce el texto, limpia saltos de línea y permite exportar en EPUB ajustable, HTML o texto plano.",
          keywords: ["ocr", "pdf", "extraer texto", "epub"],
          links: [{ text: "Probar OCR y Conversor PDF", view: "convert", description: "Extraer texto a EPUB ajustable" }]
        },
        {
          id: "faq-4",
          category: "comics",
          question: "¿Cómo funciona la división de páginas dobles de manga para smartphones?",
          answer: "EBookCC detecta automáticamente las páginas dobles de manga y las divide verticalmente en páginas simples respetando el sentido de lectura japonés u occidental.",
          keywords: ["manga", "doble página", "división de páginas"],
          links: [
            { text: "Probar División de Páginas", view: "convert", description: "Dividir páginas dobles para móvil" },
            { text: "Lector de Manga", view: "read", description: "Leer con zoom guiado de viñetas" }
          ]
        },
        {
          id: "faq-5",
          category: "comics",
          question: "¿Cómo traducir automáticamente mangas japoneses, webtoons coreanos o cómics?",
          answer: "EBookCC incluye un traductor de manga con IA. Detecta bocadillos mediante visión artificial, extrae texto con OCR, elimina el texto original y superpone la traducción en más de 12 idiomas.",
          keywords: ["traducir manga", "ocr ia", "manga raw", "webtoon"],
          links: [
            { text: "Traducir Manga Online", view: "convert", description: "Detección de bocadillos y traducción IA" },
            { text: "Crear Cómics e Historias", view: "create", description: "Diseñar cómics con viñetas" }
          ]
        },
        {
          id: "faq-6",
          category: "comics",
          question: "¿Cómo puedo crear mis propios cómics IA, mangas o novelas visuales?",
          answer: "EBookCC dispone de un estudio interactivo donde puedes dibujar con sensibilidad de presión (Wacom/Apple Pencil), generar tramas con IA, agregar bocadillos y exportar a CBZ o EPUB.",
          keywords: ["crear cómic", "generador manga ia", "creador cómic"],
          links: [{ text: "Abrir Estudio de Cómics", view: "create", description: "Diseñar viñetas y generar historias" }]
        },
        {
          id: "faq-7",
          category: "ai",
          question: "¿Qué modelos de IA puedo utilizar para traducción, OCR y creación?",
          answer: "EBookCC admite múltiples proveedores de IA: Google Gemini, OpenAI, Anthropic Claude, Qwen y LLMs locales mediante Ollama o LM Studio para una privacidad totalmente sin conexión.",
          keywords: ["modelos ia", "gemini", "openai", "claude", "qwen", "ollama", "lm studio", "claves api"],
          links: [{ text: "Configurar Claves de IA y API", action: "settings", description: "Configurar Gemini, OpenAI, Claude, Qwen o modelos locales" }]
        },
        {
          id: "faq-15",
          category: "comics",
          question: "¿Cómo publicar cómics y novelas en la estantería comunitaria y en el almacenamiento en la nube?",
          answer: "En el Estudio de Cómics e Historias, haz clic en el menú superior derecho y selecciona 'Publicar'. Puedes publicar tanto cómics ilustrados como novelas escritas directamente en el almacenamiento en la nube y en la estantería pública. Una vez publicadas, lectores de todo el mundo pueden disfrutar de tus obras en el Lector Web con vistas previas animadas estilo Metro, comentar viñetas y editarlas cuando desees desde tu espacio de creador.",
          keywords: ["publicar", "publicar cómics y novelas", "publicar cómic", "publicar novela", "estantería", "nube", "comunidad"],
          links: [
            { text: "Publicar Cómics y Novelas", view: "create", description: "Crea y publica tus historias y cómics" },
            { text: "Explorar Estantería Comunitaria", view: "read", description: "Lee cómics y novelas publicadas" }
          ]
        },
        {
          id: "faq-8",
          category: "general",
          question: "¿Es EBookCC gratuito y son privados mis archivos?",
          answer: "¡Sí! EBookCC se ejecuta en tu navegador web. Todo el procesamiento y la lectura se realizan de forma local en tu dispositivo. Tus archivos nunca se suben ni venden a servidores no autorizados.",
          keywords: ["privacidad", "gratis", "lector ebook"],
          links: [{ text: "Leer en Lector Web", view: "read", description: "Cargar archivos en el lector privado" }]
        },
        {
          id: "faq-9",
          category: "ebooks",
          question: "¿Qué formatos son compatibles para lectura y conversión?",
          answer: "EBookCC admite EPUB, PDF, CBZ, CBR, MOBI, AZW3, TXT, DOCX, HTML, WEBP, PNG, JPG y archivos ZIP.",
          keywords: ["formatos", "epub", "pdf", "cbz", "cbr"],
          links: [{ text: "Conversor de Formatos", view: "convert", description: "Convertir entre EPUB, CBZ y PDF" }]
        },
        {
          id: "faq-10",
          category: "general",
          question: "¿Cómo leer en dispositivos E-Ink (Kindle, Onyx Boox, Kobo)?",
          answer: "EBookCC incluye un modo E-Ink con paleta monocromática de alto contraste, fuentes en negrita y navegación sin parpadeos optimizada para pantallas de tinta electrónica.",
          keywords: ["e-ink", "tinta electronica", "alto contraste"],
          links: [{ text: "Leer en Modo E-Ink", view: "read", description: "Lectura de alto contraste sin parpadeos" }]
        },
        {
          id: "faq-11",
          category: "comics",
          question: "¿Cómo agregar bocadillos de diálogo a mano alzada?",
          answer: "En el Estudio de Cómics, selecciona la herramienta de bocadillos para dibujar a mano alzada o elegir plantillas, ajustar colas de diálogo y escribir con autoajuste de texto.",
          keywords: ["bocadillos", "dialogo", "estudio comic"],
          links: [{ text: "Abrir Estudio de Cómics", view: "create", description: "Dibujar bocadillos y diseñar viñetas" }]
        },
        {
          id: "faq-12",
          category: "comics",
          question: "¿Cómo funciona la lectura online viñeta a viñeta?",
          answer: "El Lector Web divide las páginas complejas de cómic en primeros planos individuales de cada viñeta para una lectura guiada con flechas o gestos táctiles.",
          keywords: ["viñetas", "zoom viñeta", "lector manga"],
          links: [{ text: "Lanzar Lector Web", view: "read", description: "Leer con zoom guiado" }]
        },
        {
          id: "faq-13",
          category: "comics",
          question: "¿Cómo crear collages de cómics y diseños de cuadrícula?",
          answer: "En el Estudio puedes organizar cuadrículas, combinar ilustraciones en un collage y exportar a CBZ o EPUB.",
          keywords: ["collage", "cuadricula", "comic maker"],
          links: [{ text: "Crear Collage", view: "create", description: "Diseñar collages de cómics" }]
        },
        {
          id: "faq-14",
          category: "ai",
          question: "¿Cómo detecta YOLO AI viñetas y bocadillos?",
          answer: "EBookCC integra modelos de visión computacional YOLO que escanean páginas para separar viñetas rectangulares y localizar bocadillos automáticamente.",
          keywords: ["yolo", "deteccion viñetas", "ia ocr"],
          links: [{ text: "Probar Detección YOLO", view: "convert", description: "Detectar viñetas y texto" }]
        }
      ];

    case "pt":
      return [
        {
          id: "faq-1",
          category: "ebooks",
          question: "Como converter quadrinhos CBZ, CBR ou PDF para EPUB para Kindle, Kobo ou Apple Books?",
          answer: "Você pode converter arquivos CBZ, CBR ou PDF diretamente para EPUB usando o conversor universal do EBookCC com alta qualidade e tamanho otimizado.",
          keywords: ["cbz", "cbr", "pdf", "epub", "kindle", "converter"],
          links: [{ text: "Abrir Conversor", view: "convert", description: "Converter CBZ, CBR, PDF em lote" }]
        },
        {
          id: "faq-2",
          category: "ebooks",
          question: "Como enviar e-books EPUB diretamente para o meu Kindle?",
          answer: "Baixe o arquivo EPUB convertido e utilize o serviço 'Send to Kindle' da Amazon (amazon.com/sendtokindle) ou envie por e-mail para seu dispositivo.",
          keywords: ["send to kindle", "kindle", "epub kindle"],
          links: [{ text: "Converter para Kindle", view: "convert", description: "Formatar para Kindle" }]
        },
        {
          id: "faq-7",
          category: "ai",
          question: "Quais modelos de IA posso usar para tradução, OCR e criação?",
          answer: "O EBookCC suporta múltiplos provedores de IA: Google Gemini, OpenAI, Anthropic Claude, Qwen e LLMs locais via Ollama ou LM Studio para privacidade total offline.",
          keywords: ["modelos ia", "gemini", "openai", "claude", "qwen", "ollama", "lm studio", "chaves api"],
          links: [{ text: "Configurar IA e Chaves de API", action: "settings", description: "Configure Gemini, OpenAI, Claude, Qwen ou LLMs locais" }]
        },
        {
          id: "faq-15",
          category: "comics",
          question: "Como publicar quadrinhos e romances na estante comunitária e no armazenamento em nuvem?",
          answer: "No Estúdio de Quadrinhos e Histórias, clique no menu superior direito e selecione 'Publicar'. Você pode publicar tanto quadrinhos ilustrados quanto romances escritos diretamente no armazenamento em nuvem e na Estante pública. Uma vez publicados, leitores do mundo todo podem acessar suas obras no Leitor Web com prévias animadas estilo Metro, comentar e você pode editar a qualquer momento em seu espaço de criação.",
          keywords: ["publicar", "publicar quadrinhos e romances", "publicar hq", "publicar romance", "estante", "nuvem", "comunidade"],
          links: [
            { text: "Publicar Quadrinhos e Romances", view: "create", description: "Crie e publique suas histórias e quadrinhos" },
            { text: "Explorar Estante da Comunidade", view: "read", description: "Leia obras publicadas pela comunidade" }
          ]
        },
        {
          id: "faq-8",
          category: "general",
          question: "O EBookCC é gratuito e meus arquivos são privados?",
          answer: "Sim! O EBookCC roda 100% no seu navegador sem enviar arquivos a servidores externos.",
          keywords: ["privacidade", "gratis", "local"],
          links: [{ text: "Leitor Web Privado", view: "read", description: "Carregar arquivos no leitor seguro" }]
        },
        ...EN_FAQ_ITEMS.filter(item => !["faq-1", "faq-2", "faq-7", "faq-15", "faq-8"].includes(item.id))
      ];

    case "ko":
      return [
        {
          id: "faq-1",
          category: "ebooks",
          question: "CBZ, CBR 또는 PDF 만화를 Kindle, Kobo, Apple Books용 EPUB으로 변환하려면 어떻게 하나요?",
          answer: "EBookCC 범용 변환기를 사용하여 CBZ, CBR, PDF 만화 압축파일을 EPUB으로 즉시 변환할 수 있습니다. 파일을 업로드하고 'EPUB' 또는 'Kindle EPUB'을 선택한 후 변환을 클릭하세요.",
          keywords: ["cbz", "cbr", "pdf", "epub", "kindle", "변환"],
          links: [{ text: "일괄 변환기 열기", view: "convert", description: "CBZ, CBR, PDF 일괄 변환" }]
        },
        {
          id: "faq-2",
          category: "ebooks",
          question: "변환된 EPUB 전자책을 Kindle 기기로 직접 전송하는 방법은 무엇인가요?",
          answer: "EBookCC에서 EPUB으로 변환한 후 다운로드하여 Amazon의 공식 'Send to Kindle'(amazon.com/sendtokindle) 서비스를 이용하거나 Kindle 이메일로 전송하세요.",
          keywords: ["send to kindle", "kindle", "epub kindle"],
          links: [{ text: "Kindle용 변환", view: "convert", description: "Amazon Kindle용 포맷 변환" }]
        },
        {
          id: "faq-7",
          category: "ai",
          question: "번역, OCR 및 만화 제작에 어떤 AI 모델을 사용할 수 있나요?",
          answer: "EBookCC는 다양한 AI 제공업체를 지원합니다: Google Gemini, OpenAI, Anthropic Claude, Qwen, 그리고 완전한 오프라인 개인정보 보호를 위한 Ollama 또는 LM Studio 기반 로컬 LLM.",
          keywords: ["ai 모델", "gemini", "openai", "claude", "qwen", "ollama", "lm studio", "api 키"],
          links: [{ text: "AI 및 API 키 설정", action: "settings", description: "Gemini, OpenAI, Claude, Qwen 또는 로컬 AI 모델 설정" }]
        },
        {
          id: "faq-15",
          category: "comics",
          question: "제작한 만화와 소설을 커뮤니티 책장 및 클라우드 저장소에 게시(출판)하려면 어떻게 해야 하나요?",
          answer: "만화 & 스토리 스튜디오 우측 상단 메뉴에서 '게시'를 선택합니다. 그림 만화와 소설 텍스트를 클라우드 저장소 및 공개 책장에 직접 발행할 수 있습니다. 게시된 작품은 웹 리더에서 Metro 스타일 라이브 애니메이션 미리보기로 전 세계 독자가 감상할 수 있으며, 컷 댓글 작성 및 작가 워크스페이스를 통해 언제든지 수정 및 업데이트를 지원합니다.",
          keywords: ["게시", "출판", "만화 및 소설 게시", "만화 출판", "소설 출판", "책장", "클라우드 저장소", "커뮤니티"],
          links: [
            { text: "만화 및 소설 게시하기", view: "create", description: "작품을 만들고 책장에 게시" },
            { text: "커뮤니티 책장 둘러보기", view: "read", description: "게시된 만화와 소설 읽기" }
          ]
        },
        {
          id: "faq-8",
          category: "general",
          question: "EBookCC는 무료이며 파일 개인정보가 보호되나요?",
          answer: "네! EBookCC는 웹 브라우저 내부에서 100% 로컬로 작동하며 파일이 외부 서버에 무단 업로드되지 않습니다.",
          keywords: ["개인정보", "무료", "로컬 처리"],
          links: [{ text: "웹 리더 실행", view: "read", description: "로컬 파일 안전하게 읽기" }]
        },
        ...EN_FAQ_ITEMS.filter(item => !["faq-1", "faq-2", "faq-7", "faq-15", "faq-8"].includes(item.id))
      ];

    case "de":
      return [
        {
          id: "faq-1",
          category: "ebooks",
          question: "Wie konvertiere ich CBZ-, CBR- oder PDF-Comics in EPUB für Kindle, Kobo oder Apple Books?",
          answer: "Sie können CBZ-, CBR- oder PDF-Archive direkt im EBookCC Universal-Konverter in saubere EPUB-Dateien für Ihren E-Reader konvertieren.",
          keywords: ["cbz", "cbr", "pdf", "epub", "kindle", "konvertieren"],
          links: [{ text: "Stapel-Konverter öffnen", view: "convert", description: "CBZ, CBR, PDF & EPUB konvertieren" }]
        },
        {
          id: "faq-2",
          category: "ebooks",
          question: "Wie sende ich konvertierte EPUB-Dateien direkt an mein Kindle-Gerät?",
          answer: "Nutzen Sie den offiziellen Amazon 'Send to Kindle'-Dienst (amazon.com/sendtokindle) oder senden Sie die EPUB per E-Mail an Ihre Kindle-Adresse.",
          keywords: ["send to kindle", "kindle", "epub kindle"],
          links: [{ text: "Für Kindle konvertieren", view: "convert", description: "Formatierung für Amazon Kindle" }]
        },
        {
          id: "faq-7",
          category: "ai",
          question: "Welche KI-Modelle kann ich für Übersetzung, OCR und Comic-Erstellung nutzen?",
          answer: "EBookCC unterstützt mehrere KI-Anbieter: Google Gemini, OpenAI, Anthropic Claude, Qwen und lokale LLMs über Ollama oder LM Studio für vollständige Offline-Privatsphäre.",
          keywords: ["ki modelle", "gemini", "openai", "claude", "qwen", "ollama", "lm studio", "api schlüssel"],
          links: [{ text: "KI & API-Schlüssel konfigurieren", action: "settings", description: "Gemini, OpenAI, Claude, Qwen oder lokale KI-Modelle konfigurieren" }]
        },
        {
          id: "faq-15",
          category: "comics",
          question: "Wie veröffentliche ich Comics und Romane im Community-Bücherregal und Cloud-Speicher?",
          answer: "Klicken Sie im Comic & Story Studio oben rechts auf das Menü und wählen Sie 'Veröffentlichen'. Sie können sowohl illustrierte Comics als auch geschriebene Romane direkt im Cloud-Speicher und im öffentlichen Bücherregal veröffentlichen. Leser weltweit können Ihre Werke im Web-Reader mit animierten Metro-Vorschauen ansehen, Panels kommentieren und Sie können Ihre Werke jederzeit im Creator-Bereich bearbeiten.",
          keywords: ["veröffentlichen", "comics und romane veröffentlichen", "comic veröffentlichen", "roman veröffentlichen", "bücherregal", "cloud-speicher", "community"],
          links: [
            { text: "Comics & Romane veröffentlichen", view: "create", description: "Erstellen und veröffentlichen Sie Ihre Werke" },
            { text: "Community-Bücherregal durchsuchen", view: "read", description: "Veröffentlichte Werke lesen" }
          ]
        },
        {
          id: "faq-8",
          category: "general",
          question: "Ist EBookCC kostenlos und bleiben meine Dateien privat?",
          answer: "Ja! EBookCC läuft vollständig in Ihrem Browser. Alle Vorgänge finden lokal auf Ihrem Gerät statt.",
          keywords: ["datenschutz", "kostenlos", "lokal"],
          links: [{ text: "Web-Reader öffnen", view: "read", description: "Dateien sicher im Reader öffnen" }]
        },
        ...EN_FAQ_ITEMS.filter(item => !["faq-1", "faq-2", "faq-7", "faq-15", "faq-8"].includes(item.id))
      ];

    case "ar":
      return [
        {
          id: "faq-1",
          category: "ebooks",
          question: "كيف يمكنني تحويل ملفات CBZ و CBR و PDF إلى EPUB لأجهزة Kindle أو Kobo أو Apple Books؟",
          answer: "يمكنك تحويل أرشيفات الكوميكس CBZ و CBR و PDF مباشرة إلى EPUB باستخدام المحول الشامل في EBookCC بجودة عالية وحجم ملف مثالي.",
          keywords: ["cbz", "cbr", "pdf", "epub", "kindle", "تحويل"],
          links: [{ text: "فتح المحول الدفعي", view: "convert", description: "تحويل الملفات إلى EPUB" }]
        },
        {
          id: "faq-2",
          category: "ebooks",
          question: "كيف أرسل كتب EPUB الإلكترونية المحولة مباشرة إلى جهاز Kindle الخاص بي؟",
          answer: "بعد التحويل، قم بتنزيل ملف EPUB واستخدم خدمة 'Send to Kindle' الرسمية من أمازون (amazon.com/sendtokindle).",
          keywords: ["send to kindle", "kindle", "epub kindle"],
          links: [{ text: "تحويل لـ Kindle", view: "convert", description: "تنسيق لـ Kindle" }]
        },
        {
          id: "faq-7",
          category: "ai",
          question: "ما هي نماذج الذكاء الاصطناعي التي يمكنني استخدامها للترجمة واستخراج النصوص OCR وإنشاء الكوميكس؟",
          answer: "يدعم EBookCC العديد من موفري الذكاء الاصطناعي: Google Gemini و OpenAI و Anthropic Claude و Qwen بالإضافة إلى نماذج LLM المحلية عبر Ollama أو LM Studio لخصوصية تامة دون اتصال بالإنترنت.",
          keywords: ["نماذج الذكاء الاصطناعي", "gemini", "openai", "claude", "qwen", "ollama", "lm studio", "مفاتيح api"],
          links: [{ text: "تهيئة مفاتيح الذكاء الاصطناعي و API", action: "settings", description: "إعداد Gemini أو OpenAI أو Claude أو Qwen أو النماذج المحلية" }]
        },
        {
          id: "faq-15",
          category: "comics",
          question: "كيف يمكنني نشر القصص المصورة والروايات في مكتبة المجتمع والتخزين السحابي؟",
          answer: "في استوديو الكوميكس والقصص، انقر على القائمة في الزاوية العلوية وحدد 'نشر'. يمكنك نشر القصص المصورة والروايات المكتوبة مباشرة إلى التخزين السحابي ورف الكتب العام. بعد النشر، يمكن للقراء حول العالم تصفح أعمالك في القارئ الإلكتروني مع معاينات متحركة بأسلوب Metro، والتعليق على الإطارات، وتعديل أعمالك في أي وقت من مساحة العمل الخاصة بك.",
          keywords: ["نشر", "نشر القصص المصورة والروايات", "نشر كوميكس", "نشر رواية", "رف الكتب", "التخزين السحابي", "المجتمع"],
          links: [
            { text: "نشر القصص المصورة والروايات", view: "create", description: "إنشاء ونشر القصص والكوميكس" },
            { text: "تصفح رف كتب المجتمع", view: "read", description: "قراءة الأعمال المنشورة" }
          ]
        },
        {
          id: "faq-8",
          category: "general",
          question: "هل تطبيق EBookCC مجاني وهل ملفاتي آمنة وذات خصوصية؟",
          answer: "نعم! يعمل EBookCC بالكامل داخل متصفحك المحلي دون رفع الملفات إلى أي خوادم خارجية.",
          keywords: ["الخصوصية", "مجاني", "محلي"],
          links: [{ text: "القارئ الإلكتروني", view: "read", description: "قراءة الملفات بخصوصية" }]
        },
        ...EN_FAQ_ITEMS.filter(item => !["faq-1", "faq-2", "faq-7", "faq-15", "faq-8"].includes(item.id))
      ];

    case "ru":
      return [
        {
          id: "faq-1",
          category: "ebooks",
          question: "Как конвертировать комиксы CBZ, CBR или PDF в EPUB для Kindle, Kobo или Apple Books?",
          answer: "Вы можете конвертировать файлы CBZ, CBR или PDF напрямую в EPUB с помощью универсального конвертера EBookCC с сохранением качества изображений.",
          keywords: ["cbz", "cbr", "pdf", "epub", "kindle", "конвертировать"],
          links: [{ text: "Открыть конвертер", view: "convert", description: "Пакетная конвертация файлов" }]
        },
        {
          id: "faq-2",
          category: "ebooks",
          question: "Как отправить сконвертированные книги EPUB прямо на устройство Kindle?",
          answer: "После конвертации скачайте файл EPUB и воспользуйтесь официальным сервисом Amazon 'Send to Kindle' (amazon.com/sendtokindle).",
          keywords: ["send to kindle", "kindle", "epub kindle"],
          links: [{ text: "Конвертировать для Kindle", view: "convert", description: "Форматирование для Kindle" }]
        },
        {
          id: "faq-7",
          category: "ai",
          question: "Какие модели ИИ можно использовать для перевода, OCR и создания комиксов?",
          answer: "EBookCC поддерживает множество поставщиков ИИ: Google Gemini, OpenAI, Anthropic Claude, Qwen и локальные LLM через Ollama или LM Studio для полной автономной конфиденциальности.",
          keywords: ["модели ии", "gemini", "openai", "claude", "qwen", "ollama", "lm studio", "ключи api"],
          links: [{ text: "Настроить ИИ и ключи API", action: "settings", description: "Настройка Gemini, OpenAI, Claude, Qwen или локальных LLM" }]
        },
        {
          id: "faq-15",
          category: "comics",
          question: "Как опубликовать комиксы и новеллы на книжной полке сообщества и в облачном хранилище?",
          answer: "В Студии комиксов и историй откройте меню в правом верхнем углу и выберите 'Опубликовать'. Вы можете публиковать иллюстрированные комиксы и текстовые новеллы прямо в облачное хранилище и на общественную книжную полку. После публикации читатели со всего мира смогут просматривать ваши работы в веб-ридере с живыми анимациями в стиле Metro, комментировать кадры, а вы сможете редактировать их в любое время из рабочей области автора.",
          keywords: ["опубликовать", "опубликовать комиксы и новеллы", "опубликовать комикс", "опубликовать новеллу", "книжная полка", "облако", "сообщество"],
          links: [
            { text: "Опубликовать комиксы и новеллы", view: "create", description: "Создавайте и публикуйте работы" },
            { text: "Книжная полка сообщества", view: "read", description: "Читать опубликованные комиксы и новеллы" }
          ]
        },
        {
          id: "faq-8",
          category: "general",
          question: "Является ли EBookCC бесплатным и конфиденциальны ли мои файлы?",
          answer: "Да! EBookCC полностью работает в вашем веб-браузере локально. Ваши файлы никогда не передаются сторонним серверам.",
          keywords: ["конфиденциальность", "бесплатно", "локально"],
          links: [{ text: "Веб-ридер", view: "read", description: "Безопасное чтение" }]
        },
        ...EN_FAQ_ITEMS.filter(item => !["faq-1", "faq-2", "faq-7", "faq-15", "faq-8"].includes(item.id))
      ];

    case "it":
      return [
        {
          id: "faq-1",
          category: "ebooks",
          question: "Come convertire fumetti CBZ, CBR o PDF in EPUB per Kindle, Kobo o Apple Books?",
          answer: "Puoi convertire archivi CBZ, CBR o PDF direttamente in EPUB tramite il convertitore universale di EBookCC preservando l'alta qualità e ottimizzando le dimensioni.",
          keywords: ["cbz", "cbr", "pdf", "epub", "kindle", "convertire"],
          links: [{ text: "Apri Convertitore", view: "convert", description: "Converti file CBZ, CBR e PDF" }]
        },
        {
          id: "faq-2",
          category: "ebooks",
          question: "Come inviare e-book EPUB convertiti direttamente al mio dispositivo Kindle?",
          answer: "Scarica il file EPUB e usa il servizio ufficiale Amazon 'Send to Kindle' (amazon.com/sendtokindle) o invialo via email al tuo indirizzo Kindle.",
          keywords: ["send to kindle", "kindle", "epub kindle"],
          links: [{ text: "Converti per Kindle", view: "convert", description: "Formatta per Amazon Kindle" }]
        },
        {
          id: "faq-7",
          category: "ai",
          question: "Quali modelli di IA posso utilizzare per traduzione, OCR e creazione?",
          answer: "EBookCC supporta molteplici provider di intelligenza artificiale: Google Gemini, OpenAI, Anthropic Claude, Qwen e LLM locali tramite Ollama o LM Studio per una privacy offline completa.",
          keywords: ["modelli ia", "gemini", "openai", "claude", "qwen", "ollama", "lm studio", "chiavi api"],
          links: [{ text: "Configura IA e Chiavi API", action: "settings", description: "Imposta Gemini, OpenAI, Claude, Qwen o modelli locali" }]
        },
        {
          id: "faq-15",
          category: "comics",
          question: "Come posso pubblicare fumetti e romanzi nella libreria della community e nel cloud?",
          answer: "Nello Studio Fumetti e Storie, fai clic sul menu in alto a destra e seleziona 'Pubblica'. Puoi pubblicare sia fumetti illustrati che romanzi scritti direttamente sul cloud storage e sulla Libreria pubblica. Una volta pubblicate, i lettori di tutto il mondo possono visualizzare le tue opere nel Lettore Web con anteprime animate stile Metro, commentare le vignette e modificarle in qualsiasi momento dal tuo spazio autore.",
          keywords: ["pubblicare", "pubblicare fumetti e romanzi", "pubblica fumetto", "pubblica romanzo", "libreria", "cloud", "community"],
          links: [
            { text: "Pubblica Fumetti e Romanzi", view: "create", description: "Crea e pubblica le tue storie e fumetti" },
            { text: "Esplora Libreria Community", view: "read", description: "Leggi fumetti e romanzi pubblicati" }
          ]
        },
        {
          id: "faq-8",
          category: "general",
          question: "EBookCC è gratuito e i miei file sono protetti?",
          answer: "Sì! EBookCC funziona interamente nel browser. Tutti i processi avvengono in locale sul tuo dispositivo.",
          keywords: ["privacy", "gratuito", "locale"],
          links: [{ text: "Lettore Web", view: "read", description: "Lettura sicura nel browser" }]
        },
        ...EN_FAQ_ITEMS.filter(item => !["faq-1", "faq-2", "faq-7", "faq-15", "faq-8"].includes(item.id))
      ];

    default:
      return EN_FAQ_ITEMS;
  }
}
