import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEEDS_SETUP, ready } from './lib/db.js';
import apiRouter from './routes/api.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 배포했는데 DB 환경변수가 아직 없는 상태 → 안내만 하고 멈춘다
app.use((req, res, next) => {
  if (!NEEDS_SETUP) return next();
  res.status(503).json({
    ok: false,
    error: 'TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 환경변수를 설정해 주세요. (README 의 "배포하기" 참고)',
  });
});

// 서버리스에서는 콜드 스타트마다 스키마를 확인한다 (한 번만 실행됨)
app.use(async (req, res, next) => {
  try {
    await ready();
    next();
  } catch (e) { next(e); }
});

app.use('/api', apiRouter);
app.use(express.static(path.join(ROOT, 'public')));

app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  const tooBig = err.code === 'LIMIT_FILE_SIZE';
  res.status(tooBig ? 400 : 500).json({
    ok: false,
    error: tooBig ? '이미지가 너무 큽니다. 4MB 이하로 올려주세요.' : (err.message || '서버 오류가 발생했습니다.'),
  });
});

export default app;
