import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import multer from 'multer';
import { generateSRT, assembleVideo } from './src/lib/video-processor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  createdAt: Date;
  script: any;
  videoUrl?: string;
  error?: string;
}

const jobs: Job[] = [];

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
    res.json(jobs);
  });

  app.post('/api/assemble', upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'images', maxCount: 20 }]), async (req, res) => {
    const { topic, voice, tone, script: scriptJson } = req.body;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const audioFile = files['audio']?.[0];
    const imageFiles = files['images'] || [];

    if (!audioFile || !scriptJson) {
      return res.status(400).json({ error: 'Missing audio file or script data' });
    }

    const script = JSON.parse(scriptJson);
    const jobId = uuidv4();
    
    const job: Job = {
      id: jobId,
      topic,
      voice,
      tone,
      status: 'Assembling Video',
      progress: 60,
      createdAt: new Date(),
      script,
    };
    
    jobs.push(job);
    io.emit('job-update', job);

    // Start assembly in background
    (async () => {
      try {
        const imagePaths = imageFiles.map(f => f.path);
        await assembleVideo(jobId, script, audioFile.path, imagePaths, outputDir, (p) => {
          job.progress = 60 + (p * 0.3);
          io.emit('job-update', job);
        });

        job.status = 'completed';
        job.progress = 100;
        job.videoUrl = `/output/${jobId}.mp4`;
        io.emit('job-update', job);
      } catch (error: any) {
        console.error("Assembly error:", error);
        job.status = 'failed';
        job.error = error.message;
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
