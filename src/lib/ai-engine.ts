import { GoogleGenAI, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

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
    "visual_keywords": ["keyword 1", "keyword 2", ...]
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
