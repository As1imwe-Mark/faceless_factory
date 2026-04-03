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

export function generateASS(words: { word: string; start: number; end: number }[], totalDuration: number) {
  const header = `[Script Info]
Title: Word Highlighting Subtitles
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,32,&H00FFFFFF,&H0000FFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,2,0,2,10,10,100,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  let events = '';
  
  // Group words into lines (e.g., 5 words per line)
  const wordsPerLine = 5;
  for (let i = 0; i < words.length; i += wordsPerLine) {
    const lineWords = words.slice(i, i + wordsPerLine);
    const lineStart = lineWords[0].start;
    const lineEnd = lineWords[lineWords.length - 1].end;

    const formatTime = (seconds: number) => {
      const date = new Date(0);
      date.setSeconds(seconds);
      const ms = Math.floor((seconds % 1) * 100);
      return date.toISOString().substr(11, 8) + '.' + ms.toString().padStart(2, '0');
    };

    let lineText = '';
    lineWords.forEach((wordObj, index) => {
      const durationMs = Math.floor((wordObj.end - wordObj.start) * 100);
      // {\k<duration>} is the karaoke highlight tag in ASS
      lineText += `{\\k${durationMs}}${wordObj.word} `;
    });

    events += `Dialogue: 0,${formatTime(lineStart)},${formatTime(lineEnd)},Default,,0,0,0,,${lineText.trim()}\n`;
  }

  return header + events;
}

export async function assembleVideo(
  jobId: string,
  script: any,
  audioPath: string,
  imagePaths: string[],
  videoPath: string | null,
  musicPath: string | null,
  wordTimestamps: { word: string; start: number; end: number }[] | null,
  outputDir: string,
  onProgress: (progress: number) => void
) {
  const outputPath = path.join(outputDir, `${jobId}.mp4`);
  const subtitlePath = path.join(outputDir, `${jobId}.${wordTimestamps ? 'ass' : 'srt'}`);
  
  // Get audio duration
  const audioDuration = await new Promise<number>((resolve) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      resolve(metadata?.format?.duration || 30);
    });
  });

  // Generate Subtitles
  if (wordTimestamps) {
    const assContent = generateASS(wordTimestamps, audioDuration);
    fs.writeFileSync(subtitlePath, assContent);
  } else {
    const srtContent = generateSRT(script, audioDuration);
    fs.writeFileSync(subtitlePath, srtContent);
  }

  return new Promise((resolve, reject) => {
    let command = ffmpeg();
    const escapedSubtitlePath = subtitlePath.replace(/\\/g, '/').replace(/:/g, '\\\\:');
    const vfSubtitles = `subtitles='${escapedSubtitlePath}'`;

    if (videoPath) {
      command = command.input(videoPath);
      command = command.input(audioPath);
      
      let filterComplex = `[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,${vfSubtitles}[v]`;
      
      if (musicPath) {
        command = command.input(musicPath);
        filterComplex += ';[2:a]volume=0.2[bgm];[1:a][bgm]amix=inputs=2:duration=first[aout]';
      }

      command
        .complexFilter(filterComplex)
        .outputOptions([
          '-map [v]',
          `-map ${musicPath ? '[aout]' : '1:a'}`,
          '-c:v libx264',
          '-preset ultrafast',
          '-crf 28',
          '-c:a aac',
          '-shortest',
          '-pix_fmt yuv420p'
        ]);
    } else if (imagePaths.length > 0) {
      const durationPerImage = audioDuration / imagePaths.length;
      imagePaths.forEach((img) => {
        command = command.input(img).inputOptions(['-loop 1', `-t ${durationPerImage}`]);
      });

      const audioIndex = imagePaths.length;
      const musicIndex = musicPath ? audioIndex + 1 : -1;
      
      // Ken Burns Effect (Slow Zoom)
      let filterComplex = imagePaths.map((_, i) => 
        `[${i}:v]scale=1280:2276,zoompan=z='min(zoom+0.0015,1.5)':d=${Math.floor(durationPerImage * 25)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=720x1280,setsar=1[v${i}]`
      ).join(';') + ';' +
      imagePaths.map((_, i) => `[v${i}]`).join('') + `concat=n=${imagePaths.length}:v=1:a=0[cv];[cv]${vfSubtitles}[outv]`;

      command = command.input(audioPath);
      
      if (musicPath) {
        command = command.input(musicPath);
        filterComplex += `;[${musicIndex}:a]volume=0.2[bgm];[${audioIndex}:a][bgm]amix=inputs=2:duration=first[aout]`;
      }

      command
        .complexFilter(filterComplex)
        .outputOptions([
          '-map [outv]',
          `-map ${musicPath ? '[aout]' : `${audioIndex}:a:0`}`,
          '-c:v libx264',
          '-preset ultrafast',
          '-crf 28',
          '-c:a aac',
          '-shortest',
          '-pix_fmt yuv420p'
        ]);
    } else {
      const backgroundVideoUrl = 'https://sample-videos.com/video123/mp4/720/big_buck_bunny_720p_1mb.mp4';
      command = command.input(backgroundVideoUrl);
      command = command.input(audioPath);
      
      let filterComplex = `[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,${vfSubtitles}[v]`;
      
      if (musicPath) {
        command = command.input(musicPath);
        filterComplex += ';[2:a]volume=0.2[bgm];[1:a][bgm]amix=inputs=2:duration=first[aout]';
      }

      command
        .complexFilter(filterComplex)
        .outputOptions([
          '-map [v]',
          `-map ${musicPath ? '[aout]' : '1:a'}`,
          '-c:v libx264',
          '-preset ultrafast',
          '-crf 28',
          '-c:a aac',
          '-shortest',
          '-pix_fmt yuv420p'
        ]);
    }

    command
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
