import express from 'express';
import {
  buildUpstreamCatalogUrl,
  buildUpstreamCountriesUrl,
  buildUpstreamGenresUrl,
  buildUpstreamMovieDetailUrl,
  buildUpstreamTmdbLookupUrl,
  fetchNormalizedBackupSources,
  resolveAllowedPosterUrl,
} from './upstream.js';

async function proxyJsonRequest(
  upstreamUrl: string,
  res: express.Response
): Promise<void> {
  const upstreamRes = await fetch(upstreamUrl, {
    headers: { Accept: 'application/json' },
  });
  if (!upstreamRes.ok) {
    res.status(upstreamRes.status).json({
      status: false,
      msg: 'Máy chủ phim tạm thời không phản hồi.',
    });
    return;
  }
  const data = await upstreamRes.json();
  res.json(data);
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  router.get('/genres', async (_req, res) => {
    try {
      await proxyJsonRequest(buildUpstreamGenresUrl(), res);
    } catch {
      res.status(502).json({
        status: false,
        msg: 'Không thể tải danh sách thể loại.',
      });
    }
  });

  router.get('/countries', async (_req, res) => {
    try {
      await proxyJsonRequest(buildUpstreamCountriesUrl(), res);
    } catch {
      res.status(502).json({
        status: false,
        msg: 'Không thể tải danh sách quốc gia.',
      });
    }
  });

  router.get('/catalog', async (req, res) => {
    try {
      const upstreamUrl = buildUpstreamCatalogUrl({
        mode: typeof req.query.mode === 'string' ? req.query.mode : undefined,
        page: typeof req.query.page === 'string' ? req.query.page : undefined,
        sort_field:
          typeof req.query.sort_field === 'string'
            ? req.query.sort_field
            : undefined,
        sort_type:
          typeof req.query.sort_type === 'string'
            ? req.query.sort_type
            : undefined,
        sort_lang:
          typeof req.query.sort_lang === 'string'
            ? req.query.sort_lang
            : undefined,
        category:
          typeof req.query.category === 'string'
            ? req.query.category
            : undefined,
        country:
          typeof req.query.country === 'string' ? req.query.country : undefined,
        year: typeof req.query.year === 'string' ? req.query.year : undefined,
        limit:
          typeof req.query.limit === 'string' ? req.query.limit : undefined,
        keyword:
          typeof req.query.keyword === 'string' ? req.query.keyword : undefined,
      });
      await proxyJsonRequest(upstreamUrl, res);
    } catch {
      res.status(502).json({
        status: false,
        msg: 'Không thể tải danh sách phim lúc này.',
      });
    }
  });

  router.get('/movie/:slug', async (req, res) => {
    try {
      const upstreamUrl = buildUpstreamMovieDetailUrl(req.params.slug);
      await proxyJsonRequest(upstreamUrl, res);
    } catch (err) {
      const status =
        err instanceof Error && err.message.includes('không hợp lệ') ? 400 : 502;
      res.status(status).json({
        status: false,
        msg: 'Không thể tải thông tin phim.',
      });
    }
  });

  router.get('/tmdb/:type/:id', async (req, res) => {
    try {
      const upstreamUrl = buildUpstreamTmdbLookupUrl(
        req.params.type,
        req.params.id
      );
      await proxyJsonRequest(upstreamUrl, res);
    } catch (err) {
      const status =
        err instanceof Error && err.message.includes('không hợp lệ') ? 400 : 502;
      res.status(status).json({
        status: false,
        msg: 'Không tìm thấy phim theo mã TMDB.',
      });
    }
  });

  router.get('/backup', async (req, res) => {
    const keyword =
      typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';
    if (!keyword) {
      res.status(400).json({ status: false, msg: 'Thiếu tên phim cần tìm.' });
      return;
    }
    try {
      const result = await fetchNormalizedBackupSources(keyword);
      res.json({ status: true, data: result });
    } catch {
      res.status(502).json({
        status: false,
        msg: 'Không thể tìm thấy máy chủ dự phòng lúc này.',
      });
    }
  });

  router.get('/poster', async (req, res) => {
    const rawPath =
      typeof req.query.path === 'string' ? req.query.path : '';
    const targetUrl = resolveAllowedPosterUrl(rawPath);
    if (!targetUrl) {
      res.status(400).end();
      return;
    }
    try {
      const imgRes = await fetch(targetUrl);
      if (!imgRes.ok) {
        res.status(imgRes.status).end();
        return;
      }
      const contentType = imgRes.headers.get('content-type') || 'image/webp';
      const arrayBuf = await imgRes.arrayBuffer();
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(arrayBuf));
    } catch {
      res.status(502).end();
    }
  });

  return router;
}
