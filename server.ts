import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import multer from 'multer';
import { createClient } from 'pexels';
import ytdl from 'ytdl-core';
import Database from 'better-sqlite3';
import { generateSRT, assembleVideo, downloadFile } from './src/lib/video-processor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database('jobs.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    topic TEXT,
    voice TEXT,
    tone TEXT,
    status TEXT,
    progress REAL,
    createdAt TEXT,
    script TEXT,
    videoUrl TEXT,
    error TEXT
  )
`);

const pexelsClient = createClient(process.env.PEXELS_API_KEY || '');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage });

interface Job {
  id: string;
  topic: string;
  voice: string;
  tone: string;
  status: string;
  progress: number;
  createdAt: string;
  script: any;
  videoUrl?: string;
  error?: string;
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    }
  });

  const PORT = 3000;

  // Ensure directories exist
  const uploadsDir = path.join(__dirname, 'uploads');
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  app.use(express.json());
  app.use('/uploads', express.static(uploadsDir));
  app.use('/output', express.static(outputDir));

  // API Routes
  app.get('/api/jobs', (req, res) => {
    const rows = db.prepare('SELECT * FROM jobs ORDER BY createdAt DESC').all();
    const jobs = rows.map((row: any) => ({
      ...row,
      script: JSON.parse(row.script || '{}')
    }));
    res.json(jobs);
  });

  app.get('/api/stock-videos', async (req, res) => {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'Query is required' });
    
    try {
      const result = await pexelsClient.videos.search({ query: query as string, per_page: 10 });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch stock videos' });
    }
  });

  app.get('/api/youtube-info', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    
    try {
      const info = await ytdl.getBasicInfo(url as string);
      res.json({
        title: info.videoDetails.title,
        thumbnail: info.videoDetails.thumbnails[0].url,
        duration: info.videoDetails.lengthSeconds,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch YouTube info' });
    }
  });

  app.post('/api/assemble', upload.fields([
    { name: 'audio', maxCount: 1 }, 
    { name: 'images', maxCount: 20 },
    { name: 'video', maxCount: 1 }
  ]), async (req, res) => {
    const { topic, voice, tone, script: scriptJson, musicUrl, videoUrl: remoteVideoUrl, wordTimestamps: wordTimestampsJson } = req.body;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const audioFile = files['audio']?.[0];
    const imageFiles = files['images'] || [];
    const uploadedVideo = files['video']?.[0];

    if (!audioFile || !scriptJson) {
      return res.status(400).json({ error: 'Missing audio file or script data' });
    }

    const script = JSON.parse(scriptJson);
    const wordTimestamps = wordTimestampsJson ? JSON.parse(wordTimestampsJson) : null;
    const jobId = uuidv4();
    
    const job: Job = {
      id: jobId,
      topic,
      voice,
      tone,
      status: 'Preparing Assets',
      progress: 50,
      createdAt: new Date().toISOString(),
      script,
    };
    
    db.prepare('INSERT INTO jobs (id, topic, voice, tone, status, progress, createdAt, script) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(job.id, job.topic, job.voice, job.tone, job.status, job.progress, job.createdAt, JSON.stringify(job.script));
    
    io.emit('job-update', job);

    // Start assembly in background
    (async () => {
      try {
        let finalVideoPath = uploadedVideo?.path || null;
        let finalMusicPath = null;

        // Download remote video if provided (YouTube or Stock)
        if (!finalVideoPath && remoteVideoUrl) {
          job.status = 'Downloading Video';
          db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(job.status, job.id);
          io.emit('job-update', job);
          
          const videoExt = remoteVideoUrl.includes('youtube.com') ? '.mp4' : path.extname(remoteVideoUrl.split('?')[0]) || '.mp4';
          const dest = path.join(uploadsDir, `${uuidv4()}${videoExt}`);
          
          if (ytdl.validateURL(remoteVideoUrl)) {
            await new Promise<void>((resolve, reject) => {
              ytdl(remoteVideoUrl, { quality: 'highestvideo' })
                .pipe(fs.createWriteStream(dest))
                .on('finish', () => resolve())
                .on('error', reject);
            });
            finalVideoPath = dest;
          } else {
            await downloadFile(remoteVideoUrl, dest);
            finalVideoPath = dest;
          }
        }

        // Download music if provided
        if (musicUrl) {
          job.status = 'Downloading Music';
          db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(job.status, job.id);
          io.emit('job-update', job);
          const musicDest = path.join(uploadsDir, `${uuidv4()}.mp3`);
          await downloadFile(musicUrl, musicDest);
          finalMusicPath = musicDest;
        }

        job.status = 'Assembling Video';
        job.progress = 70;
        db.prepare('UPDATE jobs SET status = ?, progress = ? WHERE id = ?').run(job.status, job.progress, job.id);
        io.emit('job-update', job);

        const imagePaths = imageFiles.map(f => f.path);
        await assembleVideo(jobId, script, audioFile.path, imagePaths, finalVideoPath, finalMusicPath, wordTimestamps, outputDir, (p) => {
          job.progress = 70 + (p * 0.25);
          db.prepare('UPDATE jobs SET progress = ? WHERE id = ?').run(job.progress, job.id);
          io.emit('job-update', job);
        });

        job.status = 'completed';
        job.progress = 100;
        job.videoUrl = `/output/${jobId}.mp4`;
        db.prepare('UPDATE jobs SET status = ?, progress = ?, videoUrl = ? WHERE id = ?').run(job.status, job.progress, job.videoUrl, job.id);
        io.emit('job-update', job);
      } catch (error: any) {
        console.error("Assembly error:", error);
        job.status = 'failed';
        job.error = error.message;
        db.prepare('UPDATE jobs SET status = ?, error = ? WHERE id = ?').run(job.status, job.error, job.id);
        io.emit('job-update', job);
      }
    })();

    res.status(202).json(job);
  });

  app.post('/api/jobs', (req, res) => {
    // This endpoint is now deprecated in favor of /api/assemble
    res.status(410).json({ error: 'Please use /api/assemble' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
