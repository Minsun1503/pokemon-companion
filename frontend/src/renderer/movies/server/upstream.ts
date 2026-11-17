const UPSTREAM_MOVIE_ORIGIN = 'https://phimapi.com'
const UPSTREAM_MOVIE_V1_BASE = 'https://phimapi.com/v1/api'
const UPSTREAM_IMAGE_ORIGIN = 'https://phimimg.com'
const UPSTREAM_BACKUP_ORIGIN = 'https://phim.nguonc.com'

const ALLOWED_LIST_SLUGS = new Set([
  'phim-moi-cap-nhat',
  'phim-bo',
  'phim-le',
  'hoat-hinh',
  'tv-shows',
  'phim-chieu-rap',
  'phim-sap-chieu',
  'phim-vietsub',
  'phim-thuyet-minh',
  'phim-long-tieng',
])

const ALLOWED_IMAGE_HOSTS = new Set(['phimimg.com', 'img.phimapi.com', 'phim.nguonc.com', 'nguonc.com'])

export interface CatalogQueryParams {
  mode?: string
  page?: string | number
  sort_field?: string
  sort_type?: string
  sort_lang?: string
  category?: string
  country?: string
  year?: string
  limit?: string | number
  keyword?: string
}

export interface NormalizedEpisode {
  name: string
  link_embed: string
  link_m3u8: string
}

export interface NormalizedServer {
  server_name: string
  server_data: NormalizedEpisode[]
}

function cleanSlug(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
}

function cleanNumericString(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/[^0-9]/g, '')
}

/**
 * Maps internal catalog query params to the upstream movie catalog endpoint URL.
 */
export function buildUpstreamCatalogUrl(query: CatalogQueryParams): string {
  const pageNum = Math.max(1, Math.floor(Number(query.page) || 1))
  const limitNum = Math.min(48, Math.max(1, Math.floor(Number(query.limit) || 24)))
  const sortField = String(query.sort_field ?? 'modified.time').trim()
  const safeSortField = ['modified.time', 'year', '_id'].includes(sortField) ? sortField : 'modified.time'
  const sortType = query.sort_type === 'asc' ? 'asc' : 'desc'
  const sortLang = cleanSlug(query.sort_lang)
  const category = cleanSlug(query.category)
  const country = cleanSlug(query.country)
  const year = cleanNumericString(query.year)
  const keyword = String(query.keyword ?? '').trim()
  const modeRaw = String(query.mode ?? 'v1:phim-moi-cap-nhat').trim()

  if (keyword) {
    const searchUrl = new URL(`${UPSTREAM_MOVIE_V1_BASE}/tim-kiem`)
    searchUrl.searchParams.set('keyword', keyword)
    searchUrl.searchParams.set('page', String(pageNum))
    searchUrl.searchParams.set('sort_field', safeSortField)
    searchUrl.searchParams.set('sort_type', sortType)
    if (sortLang) searchUrl.searchParams.set('sort_lang', sortLang)
    if (category) searchUrl.searchParams.set('category', category)
    if (country) searchUrl.searchParams.set('country', country)
    if (year) searchUrl.searchParams.set('year', year)
    searchUrl.searchParams.set('limit', String(limitNum))
    return searchUrl.toString()
  }

  const requestedSlug = modeRaw.replace(/^v1:/, '')
  const listSlug = ALLOWED_LIST_SLUGS.has(requestedSlug) ? requestedSlug : 'phim-moi-cap-nhat'

  let basePath = `${UPSTREAM_MOVIE_V1_BASE}/danh-sach/${listSlug}`
  let omitCategory = false
  let omitCountry = false
  let omitYear = false

  if (listSlug === 'phim-moi-cap-nhat') {
    if (category) {
      basePath = `${UPSTREAM_MOVIE_V1_BASE}/the-loai/${category}`
      omitCategory = true
    } else if (country) {
      basePath = `${UPSTREAM_MOVIE_V1_BASE}/quoc-gia/${country}`
      omitCountry = true
    } else if (year) {
      basePath = `${UPSTREAM_MOVIE_V1_BASE}/nam/${year}`
      omitYear = true
    }
  }

  const url = new URL(basePath)
  url.searchParams.set('page', String(pageNum))
  url.searchParams.set('sort_field', safeSortField)
  url.searchParams.set('sort_type', sortType)
  if (sortLang) url.searchParams.set('sort_lang', sortLang)
  if (category && !omitCategory) url.searchParams.set('category', category)
  if (country && !omitCountry) url.searchParams.set('country', country)
  if (year && !omitYear) url.searchParams.set('year', year)
  url.searchParams.set('limit', String(limitNum))
  return url.toString()
}

export function buildUpstreamGenresUrl(): string {
  return `${UPSTREAM_MOVIE_ORIGIN}/the-loai`
}

export function buildUpstreamCountriesUrl(): string {
  return `${UPSTREAM_MOVIE_ORIGIN}/quoc-gia`
}

export function buildUpstreamMovieDetailUrl(slug: string): string {
  const safeSlug = encodeURIComponent(cleanSlug(slug))
  if (!safeSlug) {
    throw new Error('Mã phim không hợp lệ.')
  }
  return `${UPSTREAM_MOVIE_ORIGIN}/phim/${safeSlug}`
}

export function buildUpstreamTmdbLookupUrl(type: string, tmdbId: string): string {
  const safeType = type === 'movie' ? 'movie' : 'tv'
  const safeId = cleanNumericString(tmdbId)
  if (!safeId) {
    throw new Error('Mã TMDB không hợp lệ.')
  }
  return `${UPSTREAM_MOVIE_ORIGIN}/tmdb/${safeType}/${safeId}`
}

/**
 * Validates and resolves an upstream poster path or allowlisted absolute URL to prevent SSRF.
 */
export function resolveAllowedPosterUrl(rawPath: string): string | null {
  const trimmed = String(rawPath ?? '').trim()
  if (!trimmed) return null

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      const host = parsed.hostname.toLowerCase()
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && ALLOWED_IMAGE_HOSTS.has(host)) {
        return parsed.toString()
      }
      return null
    } catch {
      return null
    }
  }

  if (trimmed.startsWith('//') || trimmed.includes('..')) {
    return null
  }
  const cleanPath = trimmed.replace(/^\/+/, '')
  if (!cleanPath) return null
  return `${UPSTREAM_IMAGE_ORIGIN}/${cleanPath}`
}

interface BackupSearchResponse {
  items?: Array<{ name?: string; slug?: string }>
}

interface BackupDetailResponse {
  movie?: {
    episodes?: Array<{
      server_name?: string
      items?: Array<{
        name?: string
        embed?: string
        m3u8?: string
      }>
    }>
  }
}

/**
 * Queries the secondary backup provider server-side and returns neutral server labels.
 */
export async function fetchNormalizedBackupSources(
  keyword: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ matchedTitle: string; servers: NormalizedServer[] } | null> {
  const cleanName = String(keyword ?? '').trim()
  if (!cleanName) return null

  const searchRes = await fetchFn(`${UPSTREAM_BACKUP_ORIGIN}/api/films/search?keyword=${encodeURIComponent(cleanName)}`)
  if (!searchRes.ok) {
    throw new Error('Không thể tìm nguồn phát dự phòng.')
  }
  const searchJson = (await searchRes.json()) as BackupSearchResponse
  const firstMatch = searchJson?.items?.[0]
  if (!firstMatch?.slug) {
    return null
  }

  const detailRes = await fetchFn(`${UPSTREAM_BACKUP_ORIGIN}/api/film/${encodeURIComponent(firstMatch.slug)}`)
  if (!detailRes.ok) {
    throw new Error('Không thể tải tập phim dự phòng.')
  }
  const detailJson = (await detailRes.json()) as BackupDetailResponse
  const rawEpisodes = detailJson?.movie?.episodes ?? []
  const servers: NormalizedServer[] = rawEpisodes.map((srv) => ({
    server_name: `Dự phòng · ${srv?.server_name ?? 'Server'}`,
    server_data: (srv?.items ?? []).map((ep) => ({
      name: ep?.name ?? 'Tập',
      link_embed: ep?.embed ?? '',
      link_m3u8: ep?.m3u8 ?? '',
    })),
  }))

  return {
    matchedTitle: firstMatch?.name ?? cleanName,
    servers,
  }
}
