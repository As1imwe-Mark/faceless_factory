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
import dotenv from 'dotenv';
import { generateSRT, assembleVideo, downloadFile } from './src/lib/video-processor.js';

dotenv.config();

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

// Add missing columns if they don't exist
try {
  db.exec("ALTER TABLE jobs ADD COLUMN mode TEXT");
} catch (e) {
  // Column already exists or other error
}
try {
  db.exec("ALTER TABLE jobs ADD COLUMN assets TEXT");
} catch (e) {
  // Column already exists or other error
}

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

  // 1. Debug middleware - move to the very top
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // 2. Trailing slash redirect
  app.use((req, res, next) => {
    if (req.path.length > 1 && req.path.endsWith('/') && !req.path.startsWith('/socket.io')) {
      const query = req.url.slice(req.path.length);
      const safepath = req.path.slice(0, -1).replace(/\/+/g, '/');
      res.redirect(301, safepath + query);
    } else {
      next();
    }
  });

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
    console.log('Hit /api/jobs GET');
    const rows = db.prepare('SELECT * FROM jobs ORDER BY createdAt DESC').all();
    const jobs = rows.map((row: any) => ({
      ...row,
      script: JSON.parse(row.script || '{}')
    }));
    res.json(jobs);
  });

  app.delete('/api/jobs/:id', (req, res) => {
    const { id } = req.params;
    try {
      db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
      io.emit('job-deleted', id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete job' });
    }
  });

  app.post('/api/jobs/:id/cancel', (req, res) => {
    const { id } = req.params;
    try {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
      if (!job) return res.status(404).json({ error: 'Job not found' });
      
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return res.status(400).json({ error: 'Job cannot be cancelled in its current state' });
      }

      db.prepare('UPDATE jobs SET status = ?, error = ? WHERE id = ?').run('cancelled', 'Job cancelled by user', id);
      
      const updatedJob = { ...job, status: 'cancelled', error: 'Job cancelled by user', script: JSON.parse(job.script || '{}') };
      io.emit('job-update', updatedJob);
      
      res.json({ success: true, job: updatedJob });
    } catch (error) {
      res.status(500).json({ error: 'Failed to cancel job' });
    }
  });

  app.post('/api/jobs/:id/retry', (req, res) => {
    const { id } = req.params;
    try {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
      if (!job) return res.status(404).json({ error: 'Job not found' });
      
      const assets = JSON.parse(job.assets || '{}');
      if (!assets.audio && !assets.audioUrl) {
        return res.status(400).json({ error: 'Cannot retry: original assets are missing' });
      }

      // Reset job status
      db.prepare('UPDATE jobs SET status = ?, progress = ?, error = ? WHERE id = ?').run('pending', 0, null, id);
      
      const updatedJob = { 
        ...job, 
        status: 'pending', 
        progress: 0, 
        error: null, 
        script: JSON.parse(job.script || '{}'),
        assets: assets
      };
      io.emit('job-update', updatedJob);
      
      // Re-trigger assembly in background
      (async () => {
        try {
          const jobId = id;
          const script = updatedJob.script;
          const audioPath = assets.audio;
          const imagePaths = assets.images || [];
          const videoPath = assets.video;
          const musicPath = assets.music;
          const wordTimestamps = assets.wordTimestamps;
          const isLyrics = job.mode === 'lyrics';
          const sceneVideoPaths = assets.sceneVideos || [];

          if (!fs.existsSync(audioPath)) {
            throw new Error('Original audio file is no longer available. Please re-upload.');
          }

          await assembleVideo(jobId, script, audioPath, imagePaths, videoPath, musicPath, wordTimestamps, outputDir, (p) => {
            const currentJob = db.prepare('SELECT status FROM jobs WHERE id = ?').get(id) as any;
            if (currentJob?.status === 'cancelled') return;
            const progress = 70 + (p * 0.25);
            db.prepare('UPDATE jobs SET progress = ? WHERE id = ?').run(progress, id);
            io.emit('job-update', { ...updatedJob, progress });
          }, isLyrics, sceneVideoPaths);

          db.prepare('UPDATE jobs SET status = ?, progress = ?, videoUrl = ? WHERE id = ?').run('completed', 100, `/output/${id}.mp4`, id);
          io.emit('job-update', { ...updatedJob, status: 'completed', progress: 100, videoUrl: `/output/${id}.mp4` });
        } catch (error: any) {
          console.error("Retry assembly error:", error);
          db.prepare('UPDATE jobs SET status = ?, error = ? WHERE id = ?').run('failed', error.message, id);
          io.emit('job-update', { ...updatedJob, status: 'failed', error: error.message });
        }
      })();
      
      res.json({ success: true, job: updatedJob });
    } catch (error) {
      res.status(500).json({ error: 'Failed to retry job' });
    }
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

  app.get('/api/download/:id', (req, res) => {
    const { id } = req.params;
    const filePath = path.join(outputDir, `${id}.mp4`);
    if (fs.existsSync(filePath)) {
      res.download(filePath, `production_${id}.mp4`);
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  });

  app.post('/api/assemble', upload.fields([
    { name: 'audio', maxCount: 1 }, 
    { name: 'images', maxCount: 20 },
    { name: 'sceneVideos', maxCount: 20 },
    { name: 'video', maxCount: 1 },
    { name: 'music', maxCount: 1 }
  ]), async (req, res) => {
    try {
      const { topic, voice, tone, mode, script: scriptJson, musicUrl, audioUrl, videoUrl: remoteVideoUrl, wordTimestamps: wordTimestampsJson } = req.body;
      const files = (req.files || {}) as { [fieldname: string]: Express.Multer.File[] };
      const audioFile = files['audio']?.[0];
      const imageFiles = files['images'] || [];
      const sceneVideoFiles = files['sceneVideos'] || [];
      const uploadedVideo = files['video']?.[0];
      const uploadedMusicFile = files['music']?.[0];

      if (!audioFile && !audioUrl && !scriptJson) {
        return res.status(400).json({ error: 'Missing audio file/URL or script data' });
      }

      const script = scriptJson ? JSON.parse(scriptJson) : {};
      const wordTimestamps = wordTimestampsJson ? JSON.parse(wordTimestampsJson) : null;
      const jobId = uuidv4();
      const isLyrics = mode === 'lyrics';
      
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
      
      db.prepare('INSERT INTO jobs (id, topic, voice, tone, mode, status, progress, createdAt, script, assets) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(job.id, job.topic, job.voice, job.tone, mode, job.status, job.progress, job.createdAt, JSON.stringify(job.script), null);
      
      io.emit('job-update', job);

      // Start assembly in background
      (async () => {
        try {
          let finalAudioPath = audioFile?.path || null;
          let finalVideoPath = uploadedVideo?.path || null;
          let finalMusicPath = uploadedMusicFile?.path || null;

          // Download audio if provided as URL
          if (!finalAudioPath && audioUrl) {
            job.status = 'Downloading Audio';
            db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(job.status, job.id);
            io.emit('job-update', job);
            const audioDest = path.join(uploadsDir, `${uuidv4()}.wav`);
            await downloadFile(audioUrl, audioDest);
            finalAudioPath = audioDest;
          }

          if (!finalAudioPath) {
            throw new Error('No audio source provided');
          }

          // Download remote video if provided (YouTube or Stock)
          if (!finalVideoPath && remoteVideoUrl) {
            const currentJob = db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as any;
            if (currentJob?.status === 'cancelled') return;

            job.status = 'Downloading Video';
            db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(job.status, job.id);
            io.emit('job-update', job);
            
            const isYoutube = remoteVideoUrl.includes('youtube.com') || remoteVideoUrl.includes('youtu.be');
            const videoExt = isYoutube ? '.mp4' : path.extname(remoteVideoUrl.split('?')[0]) || '.mp4';
            const dest = path.join(uploadsDir, `${uuidv4()}${videoExt}`);
            
            if (ytdl.validateURL(remoteVideoUrl)) {
              try {
                await new Promise<void>((resolve, reject) => {
                  const stream = ytdl(remoteVideoUrl, { 
                    filter: 'audioandvideo',
                    quality: 'highestvideo'
                  });
                  
                  stream.pipe(fs.createWriteStream(dest))
                    .on('finish', () => resolve())
                    .on('error', (err) => {
                      console.error("YTDL Error:", err);
                      reject(err);
                    });
                });
                finalVideoPath = dest;
              } catch (ytdlError) {
                console.warn("YTDL failed, attempting direct download as fallback:", ytdlError);
                await downloadFile(remoteVideoUrl, dest);
                finalVideoPath = dest;
              }
            } else {
              await downloadFile(remoteVideoUrl, dest);
              finalVideoPath = dest;
            }
          }

          // Download music if provided
          if (!finalMusicPath && musicUrl) {
            const currentJob = db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as any;
            if (currentJob?.status === 'cancelled') return;

            job.status = 'Downloading Music';
            db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(job.status, job.id);
            io.emit('job-update', job);
            const musicDest = path.join(uploadsDir, `${uuidv4()}.mp3`);
            await downloadFile(musicUrl, musicDest);
            finalMusicPath = musicDest;
          }

          const currentJobBeforeAssemble = db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as any;
          if (currentJobBeforeAssemble?.status === 'cancelled') return;

          job.status = 'Assembling Video';
          job.progress = 70;
          db.prepare('UPDATE jobs SET status = ?, progress = ? WHERE id = ?').run(job.status, job.progress, job.id);
          io.emit('job-update', job);

          const imagePaths = imageFiles.map(f => f.path);
          const sceneVideoPaths = sceneVideoFiles.map(f => f.path);

          // Store asset paths for potential retries
          const assets = {
            audio: finalAudioPath,
            audioUrl: audioUrl,
            images: imagePaths,
            sceneVideos: sceneVideoPaths,
            video: finalVideoPath,
            music: finalMusicPath,
            wordTimestamps: wordTimestamps
          };
          db.prepare('UPDATE jobs SET assets = ? WHERE id = ?').run(JSON.stringify(assets), job.id);

          await assembleVideo(jobId, script, finalAudioPath, imagePaths, finalVideoPath, finalMusicPath, wordTimestamps, outputDir, (p) => {
            const currentJob = db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as any;
            if (currentJob?.status === 'cancelled') return;
            job.progress = 70 + (p * 0.25);
            db.prepare('UPDATE jobs SET progress = ? WHERE id = ?').run(job.progress, job.id);
            io.emit('job-update', job);
          }, isLyrics, sceneVideoPaths);

          const finalJobCheck = db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as any;
          if (finalJobCheck?.status === 'cancelled') return;

          job.status = 'completed';
          job.progress = 100;
          job.videoUrl = `/output/${jobId}.mp4`;
          db.prepare('UPDATE jobs SET status = ?, progress = ?, videoUrl = ? WHERE id = ?').run(job.status, job.progress, job.videoUrl, job.id);
          io.emit('job-update', job);
        } catch (error: any) {
          const currentJob = db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as any;
          if (currentJob?.status === 'cancelled') return;

          console.error("Assembly error:", error);
          job.status = 'failed';
          job.error = error.message;
          db.prepare('UPDATE jobs SET status = ?, error = ? WHERE id = ?').run(job.status, job.error, job.id);
          io.emit('job-update', job);
        }
      })();

      res.status(202).json(job);
    } catch (error: any) {
      console.error("Error in /api/assemble:", error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  app.post('/api/jobs', (req, res) => {
    // This endpoint is now deprecated in favor of /api/assemble
    res.status(410).json({ error: 'Please use /api/assemble' });
  });

  // Catch-all for unmatched API routes to ensure they return JSON instead of HTML
  app.all('/api/*', (req, res) => {
    console.log(`Unmatched API request: ${req.method} ${req.url}`);
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
  });

  // Global error handler for API routes
  app.use('/api', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('API Error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal Server Error',
      code: err.code
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: false // Explicitly disable HMR to prevent websocket connection errors
      },
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
