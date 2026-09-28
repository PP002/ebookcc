// Unified Public Domain Library Client
// Connects to Gutenberg Books (via Gutendex API) & Public Domain Comics (via Internet Archive API)

export interface PublicBookItem {
  id: string; // "gutenberg-1342" or "archive-identifier"
  title: string;
  author: string;
  cover_url: string;
  content_type: 'epub' | 'comic';
  resource_url: string; // for epub: gutenberg epub url; for comic: page image template or stream root
  identifier?: string; // archive.org identifier
  description?: string;
  publicdate?: string;
  total_pages?: number;
  source: 'gutenberg' | 'archive';
  formats?: Record<string, string>;
  download_count?: number;
}

// Convert any target URL from gutenberg.org or archive.org to our secure backend proxy route
export function getLibraryProxyUrl(targetUrl: string): string {
  if (!targetUrl) return '';
  const isEpub = targetUrl.toLowerCase().includes('.epub') || targetUrl.toLowerCase().includes('epub');
  const basePath = isEpub ? '/api/library/proxy/book.epub' : '/api/library/proxy';
  return `${basePath}?fileUrl=${encodeURIComponent(targetUrl)}`;
}

// ─────────────────────────────────────────────
// Persistent Cover Image Cache (Avoids re-downloading on subpage navigation)
// ─────────────────────────────────────────────
const resolvedCoverCache = new Map<string, string>();

if (typeof window !== 'undefined') {
  try {
    const stored = sessionStorage.getItem('ebookcc_resolved_cover_cache');
    if (stored) {
      const parsed = JSON.parse(stored);
      Object.entries(parsed).forEach(([k, v]) => {
        if (typeof v === 'string' && v) resolvedCoverCache.set(k, v);
      });
    }
  } catch (_) {}
}

export function getCachedCoverUrl(idOrKey: string): string | null {
  if (!idOrKey) return null;
  return resolvedCoverCache.get(idOrKey) || null;
}

export function setCachedCoverUrl(idOrKey: string, url: string): void {
  if (!idOrKey || !url) return;
  resolvedCoverCache.set(idOrKey, url);
  if (typeof window !== 'undefined') {
    try {
      const obj: Record<string, string> = {};
      let count = 0;
      resolvedCoverCache.forEach((v, k) => {
        if (count < 200) {
          obj[k] = v;
          count++;
        }
      });
      sessionStorage.setItem('ebookcc_resolved_cover_cache', JSON.stringify(obj));
    } catch (_) {}
  }
}

// Generate direct streaming page image URL for Internet Archive items
export function getArchivePageImageUrl(identifier: string, pageIndex: number, size: 'medium' | 'thumb' | 'large' = 'medium'): string {
  if (!identifier) return '';
  const cleanId = identifier.replace(/^archive-/, '');
  if (size === 'thumb') {
    return `https://archive.org/download/${cleanId}/page/n${pageIndex}_thumb.jpg`;
  }
  if (size === 'large') {
    return `https://archive.org/download/${cleanId}/page/n${pageIndex}.jpg`;
  }
  return `https://archive.org/download/${cleanId}/page/n${pageIndex}_medium.jpg`;
}

// ─────────────────────────────────────────────
// Gutenberg Books Client (Gutendex API)
// ─────────────────────────────────────────────

interface GutendexAuthor {
  name: string;
  birth_year?: number;
  death_year?: number;
}

interface GutendexBook {
  id: number;
  title: string;
  authors: GutendexAuthor[];
  formats: Record<string, string>;
  download_count?: number;
  subjects?: string[];
  summaries?: string[];
}

export async function searchGutenbergBooks(query: string = '', page: number = 1): Promise<{
  results: PublicBookItem[];
  count: number;
}> {
  const cleanQuery = query.trim();
  const endpoint = cleanQuery
    ? `https://gutendex.com/books/?search=${encodeURIComponent(cleanQuery)}&page=${page}`
    : `https://gutendex.com/books/?sort=popular&page=${page}`;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`Gutendex returned status ${res.status}`);
    const data = await res.json();

    const results: PublicBookItem[] = (data.results || []).map((b: GutendexBook) => {
      // Pick best EPUB URL
      const epubUrl =
        b.formats['application/epub+zip'] ||
        b.formats['application/octet-stream'] ||
        `https://www.gutenberg.org/ebooks/${b.id}.epub3.images`;

      // Pick best Cover URL
      const coverUrl =
        b.formats['image/jpeg'] ||
        `https://www.gutenberg.org/cache/epub/${b.id}/pg${b.id}.cover.medium.jpg`;

      const authorName = b.authors && b.authors.length > 0
        ? b.authors.map(a => a.name.includes(',') ? a.name.split(',').reverse().join(' ').trim() : a.name).join(', ')
        : 'Project Gutenberg Author';

      const desc = b.summaries && b.summaries.length > 0
        ? b.summaries[0]
        : (b.subjects ? b.subjects.slice(0, 3).join(' • ') : '');

      return {
        id: `gutenberg-${b.id}`,
        title: b.title || 'Untitled Book',
        author: authorName,
        cover_url: coverUrl,
        content_type: 'epub' as const,
        resource_url: epubUrl,
        description: desc,
        source: 'gutenberg' as const,
        formats: b.formats,
        download_count: b.download_count,
      };
    });

    return { results, count: data.count || results.length };
  } catch (err) {
    console.error('Failed to search Gutenberg books:', err);
    return { results: [], count: 0 };
  }
}

// ─────────────────────────────────────────────
// Internet Archive Public Domain Comics Client
// ─────────────────────────────────────────────

interface ArchiveSearchDoc {
  identifier: string;
  title?: string;
  publicdate?: string;
  creator?: string | string[];
  imagecount?: number | string;
  downloads?: number;
  description?: string;
}

export async function searchArchiveComics(query: string = '', page: number = 1): Promise<{
  results: PublicBookItem[];
  count: number;
}> {
  const cleanQuery = query.trim();

  // Active public domain comic search query across archive.org collections and text mediatypes
  const primarySearchQuery = cleanQuery
    ? `(collection:(comics)+OR+collection:(comicbooksandmagazines)+OR+subject:comic)+AND+mediatype:(texts)+AND+(${encodeURIComponent(cleanQuery)})`
    : `(collection:(comics)+OR+collection:(comicbooksandmagazines)+OR+subject:comic)+AND+mediatype:(texts)`;

  const endpoint = `https://archive.org/advancedsearch.php?q=${primarySearchQuery}&fl[]=identifier,title,publicdate,creator,imagecount,downloads,description&sort[]=downloads+desc&rows=24&page=${page}&output=json`;

  try {
    let res = await fetch(endpoint);
    let data: any = res.ok ? await res.json() : null;
    let docs: ArchiveSearchDoc[] = data?.response?.docs || [];

    // Fallback if zero items returned
    if (!docs || docs.length === 0) {
      const broadQuery = cleanQuery
        ? `(subject:comics+OR+title:comic)+AND+mediatype:(texts)+AND+(${encodeURIComponent(cleanQuery)})`
        : `(subject:comics+OR+title:comic)+AND+mediatype:(texts)`;
      const broadEndpoint = `https://archive.org/advancedsearch.php?q=${broadQuery}&fl[]=identifier,title,publicdate,creator,imagecount,downloads,description&sort[]=downloads+desc&rows=24&page=${page}&output=json`;
      const fallbackRes = await fetch(broadEndpoint);
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        docs = fallbackData?.response?.docs || [];
      }
    }

    const results: PublicBookItem[] = docs.map((doc) => {
      const creator = Array.isArray(doc.creator)
        ? doc.creator.join(', ')
        : (doc.creator || 'Classic Comic Book Publisher');

      const totalPages = doc.imagecount ? parseInt(String(doc.imagecount), 10) : undefined;

      return {
        id: `archive-${doc.identifier}`,
        identifier: doc.identifier,
        title: doc.title || doc.identifier.replace(/[-_]/g, ' '),
        author: creator,
        publicdate: doc.publicdate || '',
        cover_url: `https://archive.org/download/${doc.identifier}/page/n0_medium.jpg`,
        total_pages: totalPages,
        content_type: 'comic' as const,
        resource_url: `https://archive.org/download/${doc.identifier}/page/n0.jpg`,
        description: doc.description || (doc.publicdate ? `Published: ${doc.publicdate.substring(0, 10)}` : ''),
        source: 'archive' as const,
        download_count: doc.downloads,
      };
    });

    return { results, count: data?.response?.numFound || results.length };
  } catch (err) {
    console.error('Failed to search Archive comics:', err);
    return { results: [], count: 0 };
  }
}

// Fetch total page count via https://archive.org/metadata/{identifier}
export async function fetchArchiveComicPageCount(identifier: string): Promise<number> {
  if (!identifier) return 24;
  try {
    const res = await fetch(`https://archive.org/metadata/${identifier}`);
    if (!res.ok) return 24;
    const data = await res.json();

    // Check direct metadata.imagecount
    if (data.metadata?.imagecount) {
      const count = parseInt(String(data.metadata.imagecount), 10);
      if (!isNaN(count) && count > 0) return count;
    }

    // Check files array for jp2.zip or cbr filecount
    if (Array.isArray(data.files)) {
      for (const file of data.files) {
        if (file.filecount) {
          const fc = parseInt(String(file.filecount), 10);
          if (!isNaN(fc) && fc > 0) return fc;
        }
      }
    }

    return 28;
  } catch (err) {
    console.warn('Could not fetch archive comic metadata, fallback to 24 pages:', err);
    return 24;
  }
}

// ─────────────────────────────────────────────
// Curated Public Domain Library Pool (Novels & Comics)
// ─────────────────────────────────────────────
export const PUBLIC_DOMAIN_LIBRARY_POOL: PublicBookItem[] = [
  // Classic Novels (Gutenberg)
  {
    id: 'gutenberg-1342',
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    cover_url: 'https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg',
    content_type: 'epub',
    resource_url: 'https://www.gutenberg.org/cache/epub/1342/pg1342.epub',
    description: 'A romantic masterpiece of manners, upbringing, morality, and marriage in Regency England.',
    source: 'gutenberg',
    download_count: 85200,
  },
  {
    id: 'gutenberg-84',
    title: 'Frankenstein; Or, The Modern Prometheus',
    author: 'Mary Wollstonecraft Shelley',
    cover_url: 'https://www.gutenberg.org/cache/epub/84/pg84.cover.medium.jpg',
    content_type: 'epub',
    resource_url: 'https://www.gutenberg.org/cache/epub/84/pg84.epub',
    description: 'The foundational gothic science fiction novel of Victor Frankenstein and his creature.',
    source: 'gutenberg',
    download_count: 72100,
  },
  {
    id: 'gutenberg-1661',
    title: 'The Adventures of Sherlock Holmes',
    author: 'Arthur Conan Doyle',
    cover_url: 'https://www.gutenberg.org/cache/epub/1661/pg1661.cover.medium.jpg',
    content_type: 'epub',
    resource_url: 'https://www.gutenberg.org/cache/epub/1661/pg1661.epub',
    description: 'Twelve classic detective stories featuring the world’s most celebrated consulting detective.',
    source: 'gutenberg',
    download_count: 64500,
  },
  {
    id: 'gutenberg-11',
    title: "Alice's Adventures in Wonderland",
    author: 'Lewis Carroll',
    cover_url: 'https://www.gutenberg.org/cache/epub/11/pg11.cover.medium.jpg',
    content_type: 'epub',
    resource_url: 'https://www.gutenberg.org/cache/epub/11/pg11.epub',
    description: 'The surreal journey of young Alice through a subterranean fantasy realm of talking animals.',
    source: 'gutenberg',
    download_count: 51200,
  },
  {
    id: 'gutenberg-64317',
    title: 'The Great Gatsby',
    author: 'F. Scott Fitzgerald',
    cover_url: 'https://www.gutenberg.org/cache/epub/64317/pg64317.cover.medium.jpg',
    content_type: 'epub',
    resource_url: 'https://www.gutenberg.org/cache/epub/64317/pg64317.epub',
    description: 'A portrait of the Jazz Age exploring ambition, obsession, and the American dream in Long Island.',
    source: 'gutenberg',
    download_count: 48900,
  },
  {
    id: 'gutenberg-345',
    title: 'Dracula',
    author: 'Bram Stoker',
    cover_url: 'https://www.gutenberg.org/cache/epub/345/pg345.cover.medium.jpg',
    content_type: 'epub',
    resource_url: 'https://www.gutenberg.org/cache/epub/345/pg345.epub',
    description: 'The definitive gothic horror novel introducing Count Dracula and his journey from Transylvania.',
    source: 'gutenberg',
    download_count: 46200,
  },
  {
    id: 'gutenberg-98',
    title: 'A Tale of Two Cities',
    author: 'Charles Dickens',
    cover_url: 'https://www.gutenberg.org/cache/epub/98/pg98.cover.medium.jpg',
    content_type: 'epub',
    resource_url: 'https://www.gutenberg.org/cache/epub/98/pg98.epub',
    description: 'A historical drama set in London and Paris during the turmoil of the French Revolution.',
    source: 'gutenberg',
    download_count: 43500,
  },
  {
    id: 'gutenberg-174',
    title: 'The Picture of Dorian Gray',
    author: 'Oscar Wilde',
    cover_url: 'https://www.gutenberg.org/cache/epub/174/pg174.cover.medium.jpg',
    content_type: 'epub',
    resource_url: 'https://www.gutenberg.org/cache/epub/174/pg174.epub',
    description: 'A philosophical novel regarding aestheticism, youth, hedonism, and a hidden aging portrait.',
    source: 'gutenberg',
    download_count: 39800,
  },
  {
    id: 'gutenberg-2701',
    title: 'Moby Dick; Or, The Whale',
    author: 'Herman Melville',
    cover_url: 'https://www.gutenberg.org/cache/epub/2701/pg2701.cover.medium.jpg',
    content_type: 'epub',
    resource_url: 'https://www.gutenberg.org/cache/epub/2701/pg2701.epub',
    description: 'The epic quest of Captain Ahab and the crew of the Pequod in relentless pursuit of the white whale.',
    source: 'gutenberg',
    download_count: 38200,
  },
  {
    id: 'gutenberg-35',
    title: 'The Time Machine',
    author: 'H. G. Wells',
    cover_url: 'https://www.gutenberg.org/cache/epub/35/pg35.cover.medium.jpg',
    content_type: 'epub',
    resource_url: 'https://www.gutenberg.org/cache/epub/35/pg35.epub',
    description: 'The foundational science fiction story of an inventor traveling forward into the distant future of the Eloi and Morlocks.',
    source: 'gutenberg',
    download_count: 35100,
  },
  {
    id: 'gutenberg-36',
    title: 'The War of the Worlds',
    author: 'H. G. Wells',
    cover_url: 'https://www.gutenberg.org/cache/epub/36/pg36.cover.medium.jpg',
    content_type: 'epub',
    resource_url: 'https://www.gutenberg.org/cache/epub/36/pg36.epub',
    description: 'A gripping first-person narrative of Martian invader tripods terrorizing Victorian England.',
    source: 'gutenberg',
    download_count: 34200,
  },
  {
    id: 'gutenberg-5200',
    title: 'Metamorphosis',
    author: 'Franz Kafka',
    cover_url: 'https://www.gutenberg.org/cache/epub/5200/pg5200.cover.medium.jpg',
    content_type: 'epub',
    resource_url: 'https://www.gutenberg.org/cache/epub/5200/pg5200.epub',
    description: 'The haunting psychological tale of Gregor Samsa awakening transformed into a monstrous insect.',
    source: 'gutenberg',
    download_count: 31800,
  },

  // Vintage Comics & Graphic Novels (Internet Archive - Active Verified Items)
  {
    id: 'archive-01TintinInTheLandOfTheSoviets',
    identifier: '01TintinInTheLandOfTheSoviets',
    title: 'Tintin Collection',
    author: 'Hergé',
    cover_url: 'https://archive.org/download/01TintinInTheLandOfTheSoviets/page/n0_medium.jpg',
    content_type: 'comic',
    resource_url: 'https://archive.org/download/01TintinInTheLandOfTheSoviets/page/n0.jpg',
    total_pages: 138,
    description: 'Classic graphic novel and adventure comic series created by Hergé.',
    source: 'archive',
    download_count: 482722,
  },
  {
    id: 'archive-invincible-compendiums',
    identifier: 'invincible-compendiums',
    title: 'Invincible [Compendiums]',
    author: 'Robert Kirkman',
    cover_url: 'https://archive.org/download/invincible-compendiums/page/n0_medium.jpg',
    content_type: 'comic',
    resource_url: 'https://archive.org/download/invincible-compendiums/page/n0.jpg',
    total_pages: 144,
    description: 'Mark Grayson is an average teenager who develops incredible superpowers in a universe of heroes and villains.',
    source: 'archive',
    download_count: 1448309,
  },
  {
    id: 'archive-139085831eleternautaparte01pdf',
    identifier: '139085831eleternautaparte01pdf',
    title: 'El Eternauta Parte 01',
    author: 'Héctor Germán Oesterheld',
    cover_url: 'https://archive.org/download/139085831eleternautaparte01pdf/page/n0_medium.jpg',
    content_type: 'comic',
    resource_url: 'https://archive.org/download/139085831eleternautaparte01pdf/page/n0.jpg',
    total_pages: 68,
    description: 'The legendary sci-fi graphic novel of a deadly alien snowfall and resistance in Buenos Aires.',
    source: 'archive',
    download_count: 418726,
  },
  {
    id: 'archive-Color_and_Light_James_Gurney_English',
    identifier: 'Color_and_Light_James_Gurney_English',
    title: 'Color and Light',
    author: 'James Gurney',
    cover_url: 'https://archive.org/download/Color_and_Light_James_Gurney_English/page/n0_medium.jpg',
    content_type: 'comic',
    resource_url: 'https://archive.org/download/Color_and_Light_James_Gurney_English/page/n0.jpg',
    total_pages: 227,
    description: 'Essential visual guide on light, color, and illustration art techniques for comic creators.',
    source: 'archive',
    download_count: 392960,
  },
  {
    id: 'archive-i-have-no-mouth-and-i-must-scream_202202',
    identifier: 'i-have-no-mouth-and-i-must-scream_202202',
    title: 'I Have No Mouth And I Must Scream',
    author: 'Harlan Ellison & John Byrne',
    cover_url: 'https://archive.org/download/i-have-no-mouth-and-i-must-scream_202202/page/n0_medium.jpg',
    content_type: 'comic',
    resource_url: 'https://archive.org/download/i-have-no-mouth-and-i-must-scream_202202/page/n0.jpg',
    total_pages: 48,
    description: 'Classic graphic novel adaptation of the famous sci-fi story illustrated by John Byrne.',
    source: 'archive',
    download_count: 376855,
  },
  {
    id: 'archive-manga_Berserk',
    identifier: 'manga_Berserk',
    title: 'Berserk (Dark Fantasy Manga)',
    author: 'Kentarou Miura',
    cover_url: 'https://archive.org/download/manga_Berserk/page/n0_medium.jpg',
    content_type: 'comic',
    resource_url: 'https://archive.org/download/manga_Berserk/page/n0.jpg',
    total_pages: 220,
    description: 'The epic dark fantasy manga series following Guts, the Black Swordsman.',
    source: 'archive',
    download_count: 444202,
  },
  {
    id: 'archive-eFilingComics',
    identifier: 'eFilingComics',
    title: 'Classic Comics Anthology',
    author: 'Public Domain Comic Artists',
    cover_url: 'https://archive.org/download/eFilingComics/page/n0_medium.jpg',
    content_type: 'comic',
    resource_url: 'https://archive.org/download/eFilingComics/page/n0.jpg',
    total_pages: 64,
    description: 'Collection of popular public domain comic issues and illustrated stories.',
    source: 'archive',
    download_count: 886986,
  },
  {
    id: 'archive-WaltDisneysComicsandStories-193-Vol17No01-Oct1956',
    identifier: 'WaltDisneysComicsandStories-193-Vol17No01-Oct1956',
    title: "Walt Disney's Comics and Stories #193",
    author: 'Carl Barks & Disney Artists',
    cover_url: 'https://archive.org/download/WaltDisneysComicsandStories-193-Vol17No01-Oct1956/page/n0_medium.jpg',
    content_type: 'comic',
    resource_url: 'https://archive.org/download/WaltDisneysComicsandStories-193-Vol17No01-Oct1956/page/n0.jpg',
    total_pages: 37,
    description: 'Vintage golden-age comic magazine with classic Donald Duck and Mickey Mouse stories.',
    source: 'archive',
    download_count: 2450,
  }
];

export const FEATURED_PUBLIC_DOMAIN_ITEMS: PublicBookItem[] = PUBLIC_DOMAIN_LIBRARY_POOL.slice(0, 6);

/**
 * Randomly selects a rich subset of books and comics from the public domain library pool.
 * Ensures at least two bookshelves worth of content (minimum 14-18 titles).
 */
export function getRandomLibrarySelection(count: number = 18): PublicBookItem[] {
  const novels = PUBLIC_DOMAIN_LIBRARY_POOL.filter(b => b.content_type === 'epub');
  const comics = PUBLIC_DOMAIN_LIBRARY_POOL.filter(b => b.content_type === 'comic');

  // Shuffle helper
  const shuffle = <T>(arr: T[]): T[] => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const half = Math.ceil(count / 2);
  const selectedNovels = shuffle(novels).slice(0, half);
  const selectedComics = shuffle(comics).slice(0, count - selectedNovels.length);

  // Alternate novels and comics for an engaging bookshelf rhythm
  const combined: PublicBookItem[] = [];
  const maxLen = Math.max(selectedNovels.length, selectedComics.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < selectedNovels.length) combined.push(selectedNovels[i]);
    if (i < selectedComics.length) combined.push(selectedComics[i]);
  }

  return combined;
}
