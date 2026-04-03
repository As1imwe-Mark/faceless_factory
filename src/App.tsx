import React, { useState, useEffect, useRef } from 'react';
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
  Layout,
  Youtube,
  Upload,
  Search,
  Check,
  X,
  Music2,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

import { generateScript, generateSpeech, generateImage, generateWordTimestamps } from './lib/ai-engine';

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

  // New states
  const [mode, setMode] = useState<'video' | 'lyrics'>('video');
  const [videoSource, setVideoSource] = useState<'ai-images' | 'upload' | 'stock' | 'youtube'>('ai-images');
  const [useCustomScript, setUseCustomScript] = useState(false);
  const [customScript, setCustomScript] = useState('');
  const [musicUrl, setMusicUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [stockQuery, setStockQuery] = useState('');
  const [stockVideos, setStockVideos] = useState<any[]>([]);
  const [selectedStockVideo, setSelectedStockVideo] = useState<any>(null);
  const [uploadedVideo, setUploadedVideo] = useState<File | null>(null);
  const [uploadedAudio, setUploadedAudio] = useState<File | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewData, setReviewData] = useState<any>(null);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [estimatedTime, setEstimatedTime] = useState('');

  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

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

    newSocket.on('job-deleted', (deletedId: string) => {
      setJobs(prev => prev.filter(j => j.id !== deletedId));
      setSelectedJob(prev => prev?.id === deletedId ? null : prev);
    });

    fetch('/api/jobs')
      .then(res => res.json())
      .then(setJobs);

    return () => {
      newSocket.close();
    };
  }, []);

  const handleDeleteJob = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this job?')) return;
    try {
      await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
    } catch (error) {
      console.error('Failed to delete job:', error);
    }
  };

  const handleRetryJob = (job: Job, e: React.MouseEvent) => {
    e.stopPropagation();
    setTopic(job.topic || '');
    setVoice(job.voice || 'Kore');
    setTone(job.tone || 'Inspiring');
    if (job.script && job.script.hook) {
      setUseCustomScript(true);
      setCustomScript(`${job.script.hook}\n${job.script.body.join('\n')}\n${job.script.cta}`);
    }
    setIsCreating(true);
  };

  const searchStock = async () => {
    if (!stockQuery) return;
    setGenerationStep('Searching stock videos...');
    try {
      const res = await fetch(`/api/stock-videos?query=${encodeURIComponent(stockQuery)}`);
      const data = await res.json();
      setStockVideos(data.videos || []);
    } catch (error) {
      console.error(error);
    } finally {
      setGenerationStep('');
    }
  };

  const handlePrepare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic && !useCustomScript && mode === 'video') return;
    if (mode === 'lyrics' && !uploadedAudio && !musicUrl) return;

    setIsGenerating(true);
    setGenerationProgress(0);
    setEstimatedTime('Calculating...');
    try {
      let script;
      let audioBlob: Blob | null = null;
      let wordTimestamps = null;

      if (mode === 'video') {
        if (useCustomScript) {
          script = {
            hook: customScript.split('\n')[0] || '',
            body: customScript.split('\n').slice(1, -1),
            cta: customScript.split('\n').slice(-1)[0] || '',
            visual_prompts: [topic || 'Cinematic background']
          };
        } else {
          setGenerationStep('Generating Script...');
          setGenerationProgress(10);
          setEstimatedTime('~30 seconds remaining');
          script = await generateScript(topic, tone);
        }
        
        if (!script) throw new Error('Failed to generate script');

        setGenerationStep('Synthesizing Voice...');
        setGenerationProgress(25);
        setEstimatedTime('~45 seconds remaining');
        const fullText = `${script.hook}. ${script.body.join('. ')}. ${script.cta}`;
        audioBlob = await generateSpeech(fullText, voice);
        if (!audioBlob) throw new Error('Failed to generate speech');

        setGenerationStep('Generating Word Timestamps...');
        setGenerationProgress(40);
        setEstimatedTime('~30 seconds remaining');
        wordTimestamps = await generateWordTimestamps(audioBlob, fullText);
      } else {
        // Lyrics Mode
        setGenerationStep('Preparing Lyrics...');
        setGenerationProgress(20);
        setEstimatedTime('~10 seconds remaining');
        script = {
          hook: '',
          body: customScript.split('\n'),
          cta: '',
          visual_prompts: [topic || 'Cinematic background for lyrics video']
        };
        audioBlob = uploadedAudio || null;
        
        if (audioBlob) {
          setGenerationStep('Generating Word Timestamps...');
          setGenerationProgress(40);
          setEstimatedTime('~30 seconds remaining');
          wordTimestamps = await generateWordTimestamps(audioBlob, customScript);
        }
      }

      let images: Blob[] = [];
      if (videoSource === 'ai-images' || mode === 'lyrics') {
        setGenerationStep('Generating Visuals...');
        const prompts = script.visual_prompts || [];
        for (let i = 0; i < prompts.length; i++) {
          setGenerationStep(`Generating Visual ${i + 1}/${prompts.length}...`);
          setGenerationProgress(40 + ((i / prompts.length) * 60));
          setEstimatedTime(`~${(prompts.length - i) * 15} seconds remaining`);
          const imgBlob = await generateImage(prompts[i]);
          if (imgBlob) images.push(imgBlob);
        }
      }

      setGenerationProgress(100);
      setEstimatedTime('Done!');

      setReviewData({
        script,
        audioBlob,
        images,
        videoUrl: videoSource === 'youtube' ? youtubeUrl : (videoSource === 'stock' ? selectedStockVideo?.video_files[0]?.link : null),
        uploadedVideo,
        wordTimestamps
      });
      setIsReviewing(true);
      setIsCreating(false);
    } catch (error: any) {
      console.error(error);
      alert(error.message);
    } finally {
      setIsGenerating(false);
      setGenerationStep('');
      setGenerationProgress(0);
      setEstimatedTime('');
    }
  };

  const handleFinalSubmit = async () => {
    if (!reviewData) return;
    setIsGenerating(true);
    setGenerationStep('Starting Assembly...');
    
    try {
      const formData = new FormData();
      if (reviewData.audioBlob) {
        formData.append('audio', reviewData.audioBlob, 'narration.wav');
      }
      reviewData.images.forEach((blob: Blob, i: number) => {
        formData.append('images', blob, `image_${i}.png`);
      });
      if (reviewData.uploadedVideo) {
        formData.append('video', reviewData.uploadedVideo);
      }
      if (reviewData.videoUrl) {
        formData.append('videoUrl', reviewData.videoUrl);
      }
      formData.append('topic', topic || 'Custom Script');
      formData.append('voice', voice);
      formData.append('tone', tone);
      formData.append('script', JSON.stringify(reviewData.script));
      formData.append('musicUrl', musicUrl);
      if (reviewData.wordTimestamps) {
        formData.append('wordTimestamps', JSON.stringify(reviewData.wordTimestamps));
      }

      const res = await fetch('/api/assemble', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        setIsReviewing(false);
        setReviewData(null);
        setTopic('');
        setCustomScript('');
        setMusicUrl('');
        setYoutubeUrl('');
        setSelectedStockVideo(null);
        setUploadedVideo(null);
        setUploadedAudio(null);
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start assembly');
      }
    } catch (error: any) {
      alert(error.message);
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
          <div className="flex items-center gap-2 sm:gap-4">
            <button className="p-2 hover:bg-white/5 rounded-lg transition-colors text-white/60 hover:text-white">
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setIsCreating(true)}
              className="px-3 sm:px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-white/90 transition-all active:scale-95 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New Video</span>
              <span className="sm:hidden">New</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        {/* Hero Section */}
        <div className="mb-12 md:mb-16">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 tracking-tight">
            Automate your <span className="text-purple-500">viral content</span>
          </h2>
          <p className="text-white/40 text-base sm:text-lg max-w-2xl">
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
                      <div className="flex items-center justify-between text-xs text-white/40 mb-3">
                        <span>{new Date(job.createdAt).toLocaleTimeString()}</span>
                        <span>{job.progress}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={(e) => handleRetryJob(job, e)}
                          className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1"
                        >
                          <RefreshCw className="w-3 h-3" /> Retry
                        </button>
                        <button 
                          onClick={(e) => handleDeleteJob(job.id, e)}
                          className="flex-1 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
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
            <div className="lg:sticky lg:top-28 space-y-6">
              {selectedJob ? (
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-white/5 border border-white/10 rounded-3xl p-6"
                >
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <Layout className="w-5 h-5 text-purple-500" />
                      Production Details
                    </h3>
                    <button onClick={() => setSelectedJob(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
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
              className="relative w-full max-w-2xl bg-[#111] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            >
              <div className="p-6 sm:p-8 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-xl sm:text-2xl font-bold">Configure Production</h3>
                <button onClick={() => setIsCreating(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <Plus className="w-6 h-6 rotate-45" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 sm:p-8">
                <div className="flex items-center gap-4 p-1 bg-white/5 rounded-xl border border-white/5 mb-8">
                  <button
                    type="button"
                    onClick={() => setMode('video')}
                    className={cn(
                      "flex-1 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2",
                      mode === 'video' ? "bg-white text-black shadow-lg" : "text-white/40 hover:text-white"
                    )}
                  >
                    <Video className="w-4 h-4" />
                    Faceless Video
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('lyrics')}
                    className={cn(
                      "flex-1 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2",
                      mode === 'lyrics' ? "bg-white text-black shadow-lg" : "text-white/40 hover:text-white"
                    )}
                  >
                    <Music2 className="w-4 h-4" />
                    Lyrics Video
                  </button>
                </div>

                <form onSubmit={handlePrepare} className="space-y-8">
                  <div className="space-y-6">
                    {mode === 'video' && (
                      <div className="flex items-center gap-4 p-1 bg-white/5 rounded-xl border border-white/5">
                        <button
                          type="button"
                          onClick={() => setUseCustomScript(false)}
                          className={cn(
                            "flex-1 py-2 rounded-lg text-sm font-medium transition-all",
                            !useCustomScript ? "bg-white text-black shadow-lg" : "text-white/40 hover:text-white"
                          )}
                        >
                          AI Script
                        </button>
                        <button
                          type="button"
                          onClick={() => setUseCustomScript(true)}
                          className={cn(
                            "flex-1 py-2 rounded-lg text-sm font-medium transition-all",
                            useCustomScript ? "bg-white text-black shadow-lg" : "text-white/40 hover:text-white"
                          )}
                        >
                          Custom Script
                        </button>
                      </div>
                    )}

                    {mode === 'lyrics' || useCustomScript ? (
                      <div className="space-y-4">
                        <label className="text-sm font-medium text-white/60 flex items-center gap-2">
                          <Type className="w-4 h-4" />
                          {mode === 'lyrics' ? 'Song Lyrics' : 'Your Script'}
                        </label>
                        <textarea
                          value={customScript}
                          onChange={(e) => setCustomScript(e.target.value)}
                          placeholder={mode === 'lyrics' ? "Paste song lyrics here..." : "Paste your script here. Each line will be a scene..."}
                          className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 min-h-[150px] focus:outline-none focus:border-purple-500/50 transition-colors resize-none"
                        />
                      </div>
                    ) : (
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
                          className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 min-h-[100px] focus:outline-none focus:border-purple-500/50 transition-colors resize-none"
                        />
                      </div>
                    )}
                  </div>

                  {mode === 'lyrics' && (
                    <div className="space-y-6">
                      <label className="text-sm font-medium text-white/60 flex items-center gap-2">
                        <Music className="w-4 h-4" />
                        Song Source
                      </label>
                      <div 
                        onClick={() => audioInputRef.current?.click()}
                        className="p-8 border-2 border-dashed border-white/10 rounded-2xl text-center cursor-pointer hover:border-purple-500/50 transition-all"
                      >
                        <input 
                          type="file" 
                          ref={audioInputRef} 
                          className="hidden" 
                          accept="audio/*" 
                          onChange={(e) => setUploadedAudio(e.target.files?.[0] || null)}
                        />
                        {uploadedAudio ? (
                          <div className="flex items-center justify-center gap-2 text-purple-400">
                            <CheckCircle2 className="w-5 h-5" />
                            {uploadedAudio.name}
                          </div>
                        ) : (
                          <div className="text-white/40">
                            <Upload className="w-8 h-8 mx-auto mb-2" />
                            <p>Click to upload song file</p>
                          </div>
                        )}
                      </div>
                      <div className="text-center text-white/20 text-xs">OR</div>
                      <input 
                        type="text"
                        value={musicUrl}
                        onChange={(e) => setMusicUrl(e.target.value)}
                        placeholder="Direct Song URL..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:border-purple-500/50"
                      />
                    </div>
                  )}

                  {mode === 'video' && (
                    <div className="space-y-6">
                      <label className="text-sm font-medium text-white/60 flex items-center gap-2">
                        <Layout className="w-4 h-4" />
                        Visual Source
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                        {[
                          { id: 'ai-images', label: 'AI Images', icon: Sparkles },
                          { id: 'upload', label: 'Upload', icon: Upload },
                          { id: 'stock', label: 'Stock', icon: Search },
                          { id: 'youtube', label: 'YouTube', icon: Youtube },
                        ].map((source) => (
                          <button
                            key={source.id}
                            type="button"
                            onClick={() => setVideoSource(source.id as any)}
                            className={cn(
                              "flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all",
                              videoSource === source.id 
                                ? "bg-purple-500/10 border-purple-500 text-purple-400" 
                                : "bg-white/5 border-white/5 text-white/40 hover:border-white/20 hover:text-white"
                            )}
                          >
                            <source.icon className="w-5 h-5" />
                            <span className="text-[10px] font-bold uppercase tracking-wider">{source.label}</span>
                          </button>
                        ))}
                      </div>

                      {videoSource === 'upload' && (
                        <div 
                          onClick={() => videoInputRef.current?.click()}
                          className="p-8 border-2 border-dashed border-white/10 rounded-2xl text-center cursor-pointer hover:border-purple-500/50 transition-all"
                        >
                          <input 
                            type="file" 
                            ref={videoInputRef} 
                            className="hidden" 
                            accept="video/*" 
                            onChange={(e) => setUploadedVideo(e.target.files?.[0] || null)}
                          />
                          {uploadedVideo ? (
                            <div className="flex items-center justify-center gap-2 text-purple-400">
                              <CheckCircle2 className="w-5 h-5" />
                              {uploadedVideo.name}
                            </div>
                          ) : (
                            <div className="text-white/40">
                              <Upload className="w-8 h-8 mx-auto mb-2" />
                              <p>Click to upload background video</p>
                            </div>
                          )}
                        </div>
                      )}

                      {videoSource === 'stock' && (
                        <div className="space-y-4">
                          <div className="flex gap-2">
                            <input 
                              type="text"
                              value={stockQuery}
                              onChange={(e) => setStockQuery(e.target.value)}
                              placeholder="Search Pexels..."
                              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-purple-500/50"
                            />
                            <button 
                              type="button"
                              onClick={searchStock}
                              className="p-2 bg-white text-black rounded-xl hover:bg-white/90"
                            >
                              <Search className="w-5 h-5" />
                            </button>
                          </div>
                          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 max-h-[150px] overflow-y-auto p-2 bg-black/20 rounded-xl">
                            {stockVideos.map((v) => (
                              <div 
                                key={v.id}
                                onClick={() => setSelectedStockVideo(v)}
                                className={cn(
                                  "aspect-[9/16] rounded-lg overflow-hidden cursor-pointer border-2 transition-all",
                                  selectedStockVideo?.id === v.id ? "border-purple-500" : "border-transparent"
                                )}
                              >
                                <img src={v.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {videoSource === 'youtube' && (
                        <div className="space-y-4">
                          <div className="relative">
                            <Youtube className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-red-500" />
                            <input 
                              type="text"
                              value={youtubeUrl}
                              onChange={(e) => setYoutubeUrl(e.target.value)}
                              placeholder="YouTube Video URL..."
                              className="w-full bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 py-3 focus:outline-none focus:border-purple-500/50"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {mode === 'video' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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
                          <Music className="w-4 h-4" />
                          Background Music
                        </label>
                        <input 
                          type="text"
                          value={musicUrl}
                          onChange={(e) => setMusicUrl(e.target.value)}
                          placeholder="Direct Audio URL (optional)..."
                          className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:border-purple-500/50"
                        />
                      </div>
                    </div>
                  )}

                  {mode === 'lyrics' && (
                    <div className="space-y-4">
                      <label className="text-sm font-medium text-white/60 flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        Background Mood/Topic
                      </label>
                      <input 
                        type="text"
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        placeholder="e.g. A lonely rainy night in Tokyo, or a vibrant sunset..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:border-purple-500/50"
                      />
                    </div>
                  )}

                  <div className="pt-4">
                    <button 
                      type="submit"
                      disabled={isGenerating}
                      className={cn(
                        "w-full py-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-2xl font-bold text-lg hover:shadow-lg hover:shadow-purple-500/20 transition-all active:scale-[0.98] flex flex-col items-center justify-center gap-1 relative overflow-hidden",
                        isGenerating && "opacity-90 cursor-not-allowed"
                      )}
                    >
                      {isGenerating && (
                        <div 
                          className="absolute left-0 top-0 bottom-0 bg-white/20 transition-all duration-500"
                          style={{ width: `${generationProgress}%` }}
                        />
                      )}
                      
                      <div className="flex items-center justify-center gap-3 relative z-10">
                        {isGenerating ? (
                          <>
                            <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                            {generationStep}
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-5 h-5" />
                            Prepare Assets for Review
                          </>
                        )}
                      </div>
                      
                      {isGenerating && estimatedTime && (
                        <div className="text-xs text-white/70 font-medium relative z-10">
                          {estimatedTime}
                        </div>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Review Modal */}
      <AnimatePresence>
        {isReviewing && reviewData && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-4xl bg-[#111] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  Review Production Assets
                </h3>
                <button onClick={() => setIsReviewing(false)} className="p-2 hover:bg-white/5 rounded-full">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-8 grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-12">
                <div className="space-y-8">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-white/40 mb-4 block">Script Preview</label>
                    <div className="space-y-4 bg-white/5 p-4 sm:p-6 rounded-2xl border border-white/5">
                      <p className="text-purple-400 font-bold italic">"{reviewData.script.hook}"</p>
                      {reviewData.script.body.map((s: string, i: number) => (
                        <p key={i} className="text-white/80 text-sm leading-relaxed">{s}</p>
                      ))}
                      <p className="text-blue-400 font-bold italic">"{reviewData.script.cta}"</p>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-white/40 mb-4 block">Narration Preview</label>
                    <audio 
                      src={URL.createObjectURL(reviewData.audioBlob)} 
                      controls 
                      className="w-full"
                    />
                  </div>
                </div>

                <div className="space-y-8">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-white/40 mb-4 block">Visual Assets</label>
                    {reviewData.images.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {reviewData.images.map((blob: Blob, i: number) => (
                          <div key={i} className="aspect-[9/16] bg-black rounded-xl overflow-hidden border border-white/10">
                            <img src={URL.createObjectURL(blob)} className="w-full h-full object-cover" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="aspect-video bg-black rounded-2xl overflow-hidden border border-white/10 flex items-center justify-center text-white/20">
                        {reviewData.uploadedVideo ? (
                          <video src={URL.createObjectURL(reviewData.uploadedVideo)} className="w-full h-full object-cover" />
                        ) : (
                          <div className="text-center p-8">
                            <Video className="w-12 h-12 mx-auto mb-4 opacity-20" />
                            <p className="text-sm">Remote video will be downloaded during assembly</p>
                            <p className="text-xs mt-2 opacity-50">{reviewData.videoUrl}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-4 sm:p-6 border-t border-white/5 bg-black/50 flex flex-col sm:flex-row gap-4">
                <button 
                  onClick={() => setIsReviewing(false)}
                  className="w-full sm:flex-1 py-4 bg-white/5 text-white rounded-2xl font-bold hover:bg-white/10 transition-all"
                >
                  Reject & Edit
                </button>
                <button 
                  onClick={handleFinalSubmit}
                  disabled={isGenerating}
                  className="w-full sm:flex-[2] py-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-2xl font-bold text-lg hover:shadow-lg hover:shadow-green-500/20 transition-all flex items-center justify-center gap-3"
                >
                  {isGenerating ? (
                    <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Check className="w-6 h-6" />
                      Approve & Start Assembly
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
