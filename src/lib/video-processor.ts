import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

export function generateSRT(script: any, totalDuration: number) {
  const sentences = [script.hook, ...script.body, script.cta];
  const durationPerSentence = totalDuration / sentences.length;
  
  let srt = '';
  sentences.forEach((sentence, i) => {
    const start = i * durationPerSentence;
    const end = (i + 1) * durationPerSentence;
    
    const formatTime = (seconds: number) => {
      const date = new Date(0);
      date.setSeconds(seconds);
      const ms = Math.floor((seconds % 1) * 1000);
      return date.toISOString().substr(11, 8) + ',' + ms.toString().padStart(3, '0');
    };
    
    srt += `${i + 1}\n${formatTime(start)} --> ${formatTime(end)}\n${sentence}\n\n`;
  });
  
  return srt;
}

export async function assembleVideo(
  jobId: string,
  script: any,
  audioPath: string,
  outputDir: string,
  onProgress: (progress: number) => void
) {
  const outputPath = path.join(outputDir, `${jobId}.mp4`);
  const srtPath = path.join(outputDir, `${jobId}.srt`);
  
  // Get audio duration
  const audioDuration = await new Promise<number>((resolve) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      resolve(metadata.format.duration || 30);
    });
  });

  // Generate SRT
  const srtContent = generateSRT(script, audioDuration);
  fs.writeFileSync(srtPath, srtContent);

  return new Promise((resolve, reject) => {
    const backgroundVideoUrl = 'https://sample-videos.com/video123/mp4/720/big_buck_bunny_720p_1mb.mp4';
    
    ffmpeg()
      .input(backgroundVideoUrl)
      .input(audioPath)
      .outputOptions([
        '-c:v libx264',
        '-preset ultrafast',
        '-crf 28',
        '-c:a aac',
        '-shortest',
        '-map 0:v:0',
        '-map 1:a:0',
        '-pix_fmt yuv420p',
        // Burn subtitles - this requires the srt file to be accessible by ffmpeg
        // Note: filter path must be escaped correctly
        `-vf subtitles=${srtPath.replace(/\\/g, '/')}:force_style='FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=1,Shadow=0,Alignment=2'`
      ])
      .on('progress', (progress) => {
        if (progress.percent) onProgress(Math.round(progress.percent));
      })
      .on('end', () => resolve(outputPath))
      .on('error', (err) => {
        console.error("FFmpeg error:", err);
        reject(err);
      })
      .save(outputPath);
  });
}

export async function downloadFile(url: string, dest: string) {
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream',
  });

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(dest);
    response.data.pipe(writer);
    writer.on('finish', () => resolve(dest));
    writer.on('error', reject);
  });
}
