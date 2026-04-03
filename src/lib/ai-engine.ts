import { GoogleGenAI, Modality, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function generateWordTimestamps(audioBlob: Blob, text: string) {
  try {
    const base64Audio = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.readAsDataURL(audioBlob);
    });

    const prompt = `I have an audio file and its transcription. Please provide word-level timestamps for each word in the transcription.
    Transcription: "${text}"
    
    Return a JSON array of objects, each with "word", "start" (seconds), and "end" (seconds).
    Be as precise as possible.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { data: base64Audio, mimeType: audioBlob.type || "audio/wav" } }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING },
              start: { type: Type.NUMBER },
              end: { type: Type.NUMBER }
            },
            required: ["word", "start", "end"]
          }
        }
      }
    });

    return JSON.parse(response.text || "[]");
  } catch (error) {
    console.error("Error generating word timestamps:", error);
    return null;
  }
}

export async function generateScript(topic: string, tone: string) {
  const prompt = `Generate a viral short-form video script (TikTok/Reels) about: ${topic}. 
  Tone: ${tone}. 
  The script should be under 60 seconds when read. 
  Include a strong hook, educational or entertaining middle, and a call to action.
  Format the output as JSON with the following structure:
  {
    "hook": "...",
    "body": ["sentence 1", "sentence 2", ...],
    "cta": "...",
    "visual_prompts": [
      "detailed prompt for hook image",
      "detailed prompt for body sentence 1 image",
      "detailed prompt for body sentence 2 image",
      ...,
      "detailed prompt for cta image"
    ]
  }`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Error generating script:", error);
    return null;
  }
}

export async function generateImage(prompt: string) {
  try {
    // Using Pollinations.ai for free, unlimited image generation
    // It requires no API key and bypasses Gemini quota limits
    const encodedPrompt = encodeURIComponent(`A high-quality, cinematic, vertical 9:16 aspect ratio image for a video about: ${prompt}. No text in the image, masterpiece, highly detailed`);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=720&height=1280&nologo=true`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch image');
    
    const blob = await response.blob();
    return blob;
  } catch (error) {
    console.error("Error generating image:", error);
    return null;
  }
}

export async function generateSpeech(text: string, voice: string = 'Kore') {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Say cheerfully: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice as any },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      const binaryString = atob(base64Audio);
      const pcmBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        pcmBytes[i] = binaryString.charCodeAt(i);
      }

      // Create WAV header for 24000Hz, 1 channel, 16-bit PCM
      const sampleRate = 24000;
      const numChannels = 1;
      const bitsPerSample = 16;
      const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
      const blockAlign = numChannels * (bitsPerSample / 8);
      
      const header = new ArrayBuffer(44);
      const view = new DataView(header);
      
      const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      };

      writeString(0, 'RIFF');
      view.setUint32(4, 36 + pcmBytes.length, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, bitsPerSample, true);
      writeString(36, 'data');
      view.setUint32(40, pcmBytes.length, true);

      const wavHeader = new Uint8Array(header);
      const wavBytes = new Uint8Array(wavHeader.length + pcmBytes.length);
      wavBytes.set(wavHeader, 0);
      wavBytes.set(pcmBytes, wavHeader.length);

      return new Blob([wavBytes], { type: 'audio/wav' });
    }
    return null;
  } catch (error) {
    console.error("Error generating speech:", error);
    return null;
  }
}
