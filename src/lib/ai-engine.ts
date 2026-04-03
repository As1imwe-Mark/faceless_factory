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
            { inlineData: { data: base64Audio, mimeType: "audio/mp3" } }
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
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: `A high-quality, cinematic, vertical 9:16 aspect ratio image for a video about: ${prompt}. No text in the image.`,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "9:16",
        },
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        const base64EncodeString = part.inlineData.data;
        const binaryString = atob(base64EncodeString);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return new Blob([bytes], { type: 'image/png' });
      }
    }
    return null;
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
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return new Blob([bytes], { type: 'audio/mp3' });
    }
    return null;
  } catch (error) {
    console.error("Error generating speech:", error);
    return null;
  }
}
