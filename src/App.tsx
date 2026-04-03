import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  Video, 
  Plus, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Play, 
  Download, 
  Settings,
  Sparkles,
  Type,
  Music,
  Mic,
  Layout
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

import { generateScript, generateSpeech } from './lib/ai-engine';

interface Job {
  id: string;
  topic: string;
  status: string;
  progress: number;
  videoUrl?: string;
  createdAt: string;
  tone?: string;
  voice?: string;
  error?: string;
}

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState('');
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState('inspiring');
  const [voice, setVoice] = useState('Kore');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('job-update', (updatedJob: Job) => {
      setJobs(prev => {
        const index = prev.findIndex(j => j.id === updatedJob.id);
        if (index >= 0) {
          const newJobs = [...prev];
          newJobs[index] = updatedJob;
          return newJobs;
        }
        return [updatedJob, ...prev];
      });
      
      setSelectedJob(prev => prev?.id === updatedJob.id ? updatedJob : prev);
    });

    fetch('/api/jobs')
      .then(res => res.json())
      .then(setJobs);

    return () => {
      newSocket.close();
    };
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic || isGenerating) return;

    setIsGenerating(true);
    try {
      // 1. Generate Script
      setGenerationStep('Generating Script...');
      const script = await generateScript(topic, tone);
      if (!script) throw new Error('Failed to generate script');

      // 2. Generate Speech
      setGenerationStep('Synthesizing Voice...');
      const fullText = `${script.hook}. ${script.body.join('. ')}. ${script.cta}`;
      const audioBlob = await generateSpeech(fullText, voice);
      if (!audioBlob) throw new Error('Failed to generate speech');

      // 3. Upload to backend for assembly
      setGenerationStep('Uploading to Factory...');
      const formData = new FormData();
      formData.append('audio', audioBlob, 'narration.mp3');
      formData.append('topic', topic);
      formData.append('voice', voice);
      formData.append('tone', tone);
      formData.append('script', JSON.stringify(script));

      const res = await fetch('/api/assemble', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        setTopic('');
        setIsCreating(false);
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start assembly');
      }
    } catch (error: any) {
      console.error("Generation error:", error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsGenerating(false);
      setGenerationStep('');
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-purple-500/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Video className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">
              Faceless Factory
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-white/5 rounded-lg transition-colors text-white/60 hover:text-white">
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setIsCreating(true)}
              className="px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-white/90 transition-all active:scale-95 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New Video
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        {/* Hero Section */}
        <div className="mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">
            Automate your <span className="text-purple-500">viral content</span>
          </h2>
          <p className="text-white/40 text-lg max-w-2xl">
            Generate high-quality short-form videos with AI. From script to final render, 
            everything is handled automatically.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
          {[
            { label: 'Total Videos', value: jobs.length, icon: Video },
            { label: 'Processing', value: jobs.filter(j => j.status !== 'completed' && j.status !== 'failed').length, icon: Clock },
            { label: 'Completed', value: jobs.filter(j => j.status === 'completed').length, icon: CheckCircle2 },
            { label: 'Failed', value: jobs.filter(j => j.status === 'failed').length, icon: AlertCircle },
          ].map((stat, i) => (
            <div key={i} className="p-6 rounded-2xl bg-white/5 border border-white/5">
              <div className="flex items-center justify-between mb-4">
                <stat.icon className={cn("w-5 h-5", i === 3 ? "text-red-500" : "text-purple-500")} />
              </div>
              <div className="text-2xl font-bold">{stat.value}</div>
              <div className="text-white/40 text-sm">{stat.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Left: Jobs List */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold">Active Productions</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <AnimatePresence mode="popLayout">
                {jobs.map((job) => (
                  <motion.div
                    key={job.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    onClick={() => setSelectedJob(job)}
                    className={cn(
                      "group relative bg-white/5 border rounded-2xl overflow-hidden transition-all cursor-pointer",
                      selectedJob?.id === job.id ? "border-purple-500 ring-1 ring-purple-500" : "border-white/5 hover:border-white/20"
                    )}
                  >
                    <div className="aspect-video bg-neutral-900 relative overflow-hidden">
                      {job.status === 'completed' ? (
                        <video src={job.videoUrl} className="w-full h-full object-cover" />
                      ) : job.status === 'failed' ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-red-500/10">
                          <AlertCircle className="w-8 h-8 text-red-500" />
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-12 h-12 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin" />
                        </div>
                      )}
                      <div className="absolute top-3 right-3">
                        <span className={cn(
                          "text-[10px] px-2 py-1 rounded-md uppercase font-bold tracking-wider backdrop-blur-md",
                          job.status === 'completed' ? "bg-green-500/20 text-green-400 border border-green-500/20" : 
                          job.status === 'failed' ? "bg-red-500/20 text-red-400 border border-red-500/20" :
                          "bg-purple-500/20 text-purple-400 border border-purple-500/20"
                        )}>
                          {job.status}
                        </span>
                      </div>
                    </div>
                    <div className="p-4">
                      <h4 className="font-medium mb-1 line-clamp-1">{job.topic}</h4>
                      <div className="flex items-center justify-between text-xs text-white/40">
                        <span>{new Date(job.createdAt).toLocaleTimeString()}</span>
                        <span>{job.progress}%</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {jobs.length === 0 && (
                <div className="col-span-full py-20 text-center border-2 border-dashed border-white/5 rounded-3xl">
                  <p className="text-white/20">No active productions. Start by creating a new video.</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: Inspector */}
          <div className="lg:col-span-1">
            <div className="sticky top-28 space-y-6">
              {selectedJob ? (
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-white/5 border border-white/10 rounded-3xl p-6"
                >
                  <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                    <Layout className="w-5 h-5 text-purple-500" />
                    Production Details
                  </h3>
                  
                  <div className="space-y-6">
                    <div className="aspect-[9/16] w-full max-w-[240px] mx-auto bg-black rounded-2xl overflow-hidden shadow-2xl border border-white/10 relative">
                      {selectedJob.status === 'completed' ? (
                        <video src={selectedJob.videoUrl} controls className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-white/20 text-sm text-center p-6 gap-4">
                          <div className="w-12 h-12 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
                          Preview will be available once generation completes
                        </div>
                      )}
                    </div>

                    <div className="space-y-4">
                      <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                        <label className="text-[10px] uppercase tracking-widest text-white/40 mb-2 block">Current Status</label>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${selectedJob.progress}%` }}
                              className={cn("h-full", selectedJob.status === 'failed' ? "bg-red-500" : "bg-purple-500")}
                            />
                          </div>
                          <span className="text-sm font-mono">{selectedJob.progress}%</span>
                        </div>
                        <p className={cn("text-xs mt-2 font-medium", selectedJob.status === 'failed' ? "text-red-400" : "text-purple-400")}>
                          {selectedJob.status}
                        </p>
                      </div>

                      <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                        <label className="text-[10px] uppercase tracking-widest text-white/40 mb-2 block">Metadata</label>
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <p className="text-white/40">Tone</p>
                            <p className="capitalize">{selectedJob.tone || 'Inspiring'}</p>
                          </div>
                          <div>
                            <p className="text-white/40">Voice</p>
                            <p className="capitalize">{selectedJob.voice || 'Kore'}</p>
                          </div>
                        </div>
                      </div>

                      {selectedJob.status === 'completed' && (
                        <a 
                          href={selectedJob.videoUrl} 
                          download 
                          className="w-full py-3 bg-white text-black rounded-xl font-bold hover:bg-white/90 transition-all flex items-center justify-center gap-2"
                        >
                          <Download className="w-4 h-4" />
                          Download Final Render
                        </a>
                      )}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="h-[400px] border-2 border-dashed border-white/5 rounded-3xl flex flex-col items-center justify-center text-center p-8">
                  <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
                    <Play className="w-8 h-8 text-white/20" />
                  </div>
                  <h4 className="text-white/40 font-medium">Select a project to view details</h4>
                  <p className="text-white/20 text-sm mt-2">Real-time production monitoring and preview will appear here.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Create Modal */}
      <AnimatePresence>
        {isCreating && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCreating(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-[#111] border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-2xl font-bold">Configure Production</h3>
                  <button onClick={() => setIsCreating(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                    <Plus className="w-6 h-6 rotate-45" />
                  </button>
                </div>

                <form onSubmit={handleCreate} className="space-y-8">
                  <div className="space-y-4">
                    <label className="text-sm font-medium text-white/60 flex items-center gap-2">
                      <Type className="w-4 h-4" />
                      Topic or Prompt
                    </label>
                    <textarea
                      autoFocus
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="e.g. The history of Rome in 60 seconds, or 5 facts about space..."
                      className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 min-h-[120px] focus:outline-none focus:border-purple-500/50 transition-colors resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <label className="text-sm font-medium text-white/60 flex items-center gap-2">
                        <Mic className="w-4 h-4" />
                        Narrator Voice
                      </label>
                      <select 
                        value={voice}
                        onChange={(e) => setVoice(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:border-purple-500/50 appearance-none"
                      >
                        <option value="Kore">Kore (Female, Warm)</option>
                        <option value="Puck">Puck (Male, Energetic)</option>
                        <option value="Charon">Charon (Male, Deep)</option>
                        <option value="Fenrir">Fenrir (Male, Bold)</option>
                        <option value="Zephyr">Zephyr (Male, Soft)</option>
                      </select>
                    </div>
                    <div className="space-y-4">
                      <label className="text-sm font-medium text-white/60 flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        Content Tone
                      </label>
                      <select 
                        value={tone}
                        onChange={(e) => setTone(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:border-purple-500/50 appearance-none"
                      >
                        <option value="inspiring">Inspiring</option>
                        <option value="shocking">Shocking</option>
                        <option value="educational">Educational</option>
                        <option value="funny">Funny</option>
                        <option value="sad">Sad</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-4">
                    <button 
                      type="submit"
                      disabled={isGenerating}
                      className={cn(
                        "w-full py-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-2xl font-bold text-lg hover:shadow-lg hover:shadow-purple-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-3",
                        isGenerating && "opacity-70 cursor-not-allowed"
                      )}
                    >
                      {isGenerating ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                          {generationStep}
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-5 h-5" />
                          Start Automated Production
                        </>
                      )}
                    </button>
                    <p className="text-center text-white/30 text-xs mt-4">
                      Estimated generation time: 2-3 minutes
                    </p>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
