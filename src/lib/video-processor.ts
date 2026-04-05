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

export function generateASS(words: { word: string; start: number; end: number }[], totalDuration: number, isLyrics: boolean = false) {
  const fontSize = isLyrics ? 72 : 54;
  const alignment = 5; // 5 is middle center
  const primaryColor = '&H0000FFFF'; // Yellow for highlight (hit color)
  const secondaryColor = '&H00FFFFFF'; // White for base (un-hit color)
  const outlineColor = '&H00000000'; // Black outline
  
  const header = `[Script Info]
Title: Karaoke Style Subtitles
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},${primaryColor},${secondaryColor},${outlineColor},&H00000000,1,0,0,0,100,100,0,0,1,3,2,${alignment},10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  let events = '';
  
  const offset = 0;
  const wordsPerLine = isLyrics ? 5 : 6; // More words per line to "slow down" transitions

  for (let i = 0; i < words.length; i += wordsPerLine) {
    const lineWords = words.slice(i, i + wordsPerLine);
    const lineStart = Math.max(0, lineWords[0].start + offset);
    const lineEnd = Math.min(totalDuration, lineWords[lineWords.length - 1].end + offset + 0.8); // Stay longer

    const formatTime = (seconds: number) => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const cs = Math.floor((seconds % 1) * 100);
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
    };

    let lineText = '{\\fad(400,400)}'; // Smoother fade
    
    lineWords.forEach((wordObj, index) => {
      const durationCs = Math.floor((wordObj.end - wordObj.start) * 100);
      lineText += `{\\k${durationCs}}${wordObj.word}`;
      
      if (index < lineWords.length - 1) {
        const gapCs = Math.floor((lineWords[index + 1].start - wordObj.end) * 100);
        if (gapCs > 0) {
          lineText += `{\\k${gapCs}} `;
        } else {
          lineText += ` `;
        }
      }
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
  onProgress: (progress: number) => void,
  isLyrics: boolean = false,
  sceneVideoPaths: string[] = []
) {
  const outputPath = path.join(outputDir, `${jobId}.mp4`);
  const subtitlePath = path.join(outputDir, `${jobId}.${wordTimestamps ? 'ass' : 'srt'}`);
  
  const audioDuration = await new Promise<number>((resolve) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      resolve(metadata?.format?.duration || 30);
    });
  });

  if (wordTimestamps) {
    fs.writeFileSync(subtitlePath, generateASS(wordTimestamps, audioDuration, isLyrics));
  } else {
    fs.writeFileSync(subtitlePath, generateSRT(script, audioDuration));
  }

  return new Promise((resolve, reject) => {
    let command = ffmpeg();

    // Robust path escaping for FFmpeg filtergraph
    // On Linux, absolute paths starting with / are fine, but for the subtitles filter, 
    // we should wrap in single quotes and escape those single quotes.
    const escapedSubtitlePath = subtitlePath
      .replace(/\\/g, '/')
      .replace(/'/g, "'\\\\\\''")
      .replace(/:/g, '\\:');

    const vfSubtitles = `subtitles='${escapedSubtitlePath}'`;

    if (sceneVideoPaths.length > 0) {
      sceneVideoPaths.forEach((v) => {
        command.input(v);
      });

      const audioIndex = sceneVideoPaths.length;
      const musicIndex = musicPath ? audioIndex + 1 : -1;

      let filterComplex =
        sceneVideoPaths.map((_, i) =>
          `[${i}:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30,format=yuv420p[v${i}]`
        ).join(';')
        + ';'
        + sceneVideoPaths.map((_, i) => `[v${i}]`).join('')
        + `concat=n=${sceneVideoPaths.length}:v=1:a=0[cv];[cv]tpad=stop_mode=clone:stop_duration=${Math.ceil(audioDuration)},${vfSubtitles}[outv]`;

      command.input(audioPath);

      if (musicPath) {
        command.input(musicPath);
        filterComplex += `;[${musicIndex}:a]volume=0.2[bgm];[${audioIndex}:a][bgm]amix=inputs=2:duration=first[aout]`;
      }

      command
        .complexFilter(filterComplex)
        .outputOptions([
          '-map [outv]',
          `-map ${musicPath ? '[aout]' : `${audioIndex}:a:0`}`,
          '-c:v libx264',
          '-preset fast',
          '-crf 23',
          '-profile:v high',
          '-level 4.1',
          '-c:a aac',
          '-b:a 192k',
          '-shortest',
          '-pix_fmt yuv420p',
          '-movflags +faststart'
        ]);

    } else if (videoPath) {
      command.input(videoPath).inputOptions(['-stream_loop', '-1']).input(audioPath);

      let filterComplex = `[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30,format=yuv420p,${vfSubtitles}[v]`;

      if (musicPath) {
        command.input(musicPath);
        filterComplex += `;[2:a]volume=0.2[bgm];[1:a][bgm]amix=inputs=2:duration=first[aout]`;
      }

      command
        .complexFilter(filterComplex)
        .outputOptions([
          '-map [v]',
          `-map ${musicPath ? '[aout]' : '1:a'}`,
          '-c:v libx264',
          '-preset fast',
          '-crf 23',
          '-profile:v high',
          '-level 4.1',
          '-c:a aac',
          '-b:a 192k',
          '-shortest',
          '-pix_fmt yuv420p',
          '-movflags +faststart'
        ]);

    } else if (imagePaths.length > 0) {

      const durationPerImage = audioDuration / imagePaths.length;

      imagePaths.forEach((img) => {
        command.input(img).inputOptions(['-loop', '1', '-t', durationPerImage.toString()]);
      });

      const audioIndex = imagePaths.length;
      const musicIndex = musicPath ? audioIndex + 1 : -1;

      let filterComplex =
        imagePaths.map((_, i) =>
          `[${i}:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30,format=yuv420p[v${i}]`
        ).join(';')
        + ';'
        + imagePaths.map((_, i) => `[v${i}]`).join('')
        + `concat=n=${imagePaths.length}:v=1:a=0[cv];[cv]${vfSubtitles}[outv]`;

      command.input(audioPath);

      if (musicPath) {
        command.input(musicPath);
        filterComplex += `;[${musicIndex}:a]volume=0.2[bgm];[${audioIndex}:a][bgm]amix=inputs=2:duration=first[aout]`;
      }

      command
        .complexFilter(filterComplex)
        .outputOptions([
          '-map [outv]',
          `-map ${musicPath ? '[aout]' : `${audioIndex}:a:0`}`,
          '-c:v libx264',
          '-preset fast',
          '-crf 23',
          '-profile:v high',
          '-level 4.1',
          '-c:a aac',
          '-b:a 192k',
          '-shortest',
          '-pix_fmt yuv420p',
          '-movflags +faststart'
        ]);

    } else {
      // Fallback to a generated black background instead of a remote URL
      command.input(`color=c=black:s=720x1280:d=${audioDuration}`).inputFormat('lavfi');
      command.input(audioPath);

      let filterComplex = `[0:v]format=yuv420p,${vfSubtitles}[v]`;

      if (musicPath) {
        command.input(musicPath);
        filterComplex += `;[2:a]volume=0.2[bgm];[1:a][bgm]amix=inputs=2:duration=first[aout]`;
      }

      command
        .complexFilter(filterComplex)
        .outputOptions([
          '-map [v]',
          `-map ${musicPath ? '[aout]' : '1:a'}`,
          '-c:v libx264',
          '-preset fast',
          '-crf 23',
          '-profile:v high',
          '-level 4.1',
          '-c:a aac',
          '-b:a 192k',
          '-shortest',
          '-pix_fmt yuv420p',
          '-movflags +faststart'
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
    url,
    responseType: 'stream',
  });

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(dest);
    response.data.pipe(writer);
    writer.on('finish', () => resolve(dest));
    writer.on('error', reject);
  });
}
