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

import { generateScript, generateSpeech, generateImage, generateWordTimestamps, generateVideo, pollVideoOperation } from './lib/ai-engine';

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
  script?: any;
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
  const [videoSource, setVideoSource] = useState<'ai-images' | 'ai-animations' | 'upload' | 'stock' | 'youtube'>('ai-images');
  const [useCustomScript, setUseCustomScript] = useState(false);
  const [customScript, setCustomScript] = useState('');
  const [musicUrl, setMusicUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [stockQuery, setStockQuery] = useState('');
  const [stockVideos, setStockVideos] = useState<any[]>([]);
  const [selectedStockVideo, setSelectedStockVideo] = useState<any>(null);
  const [uploadedVideo, setUploadedVideo] = useState<File | null>(null);
  const [uploadedAudio, setUploadedAudio] = useState<File | null>(null);
  const [uploadedMusic, setUploadedMusic] = useState<File | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewData, setReviewData] = useState<any>(null);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [estimatedTime, setEstimatedTime] = useState('');

  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const safeFetchJson = async (url: string, options?: RequestInit) => {
    const fetchOptions = {
      ...options,
      credentials: 'include' as RequestCredentials
    };
    const res = await fetch(url, fetchOptions);
    
    if (res.url.includes('__cookie_check.html')) {
      throw new Error('Authentication required. Please open the app in a new tab to continue, or refresh the page.');
    }

    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return res.json();
    }
    const text = await res.text();
    console.error(`Expected JSON from ${url} but got ${contentType}. Final URL after redirects: ${res.url}. Response preview:`, text.substring(0, 100));
    throw new Error(`Server returned non-JSON response for ${url} (Final URL: ${res.url}): ${res.status} ${res.statusText}`);
  };

  useEffect(() => {
    const newSocket = io({
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      timeout: 10000,
    });
    
    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
      setSocket(newSocket);
    });

    newSocket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
    });

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

    safeFetchJson('/api/jobs')
      .then(setJobs)
      .catch(err => console.error('Failed to fetch jobs:', err));

    return () => {
      newSocket.close();
    };
  }, []);

  const handleDeleteJob = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await safeFetchJson(`/api/jobs/${id}`, { method: 'DELETE' });
    } catch (error) {
      console.error('Failed to delete job:', error);
    }
  };

  const handleCancelJob = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await safeFetchJson(`/api/jobs/${id}/cancel`, { method: 'POST' });
    } catch (error) {
      console.error('Failed to cancel job:', error);
    }
  };

  const handleRetryJob = async (job: Job, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await safeFetchJson(`/api/jobs/${job.id}/retry`, { method: 'POST' });
    } catch (error: any) {
      console.error('Failed to retry job on backend, falling back to form:', error);
      // Fallback to populating the form
      setTopic(job.topic || '');
      setVoice(job.voice || 'Kore');
      setTone(job.tone || 'Inspiring');
      if (job.script && job.script.hook) {
        setUseCustomScript(true);
        setCustomScript(`${job.script.hook}\n${job.script.body.join('\n')}\n${job.script.cta}`);
      }
      setIsCreating(true);
    }
  };

  const searchStock = async () => {
    if (!stockQuery) return;
    setGenerationStep('Searching stock videos...');
    try {
      const data = await safeFetchJson(`/api/stock-videos?query=${encodeURIComponent(stockQuery)}`);
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
      // Check for API key if using animations
      if (videoSource === 'ai-animations') {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await (window as any).aistudio.openSelectKey();
        }
      }

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
      let sceneVideos: Blob[] = [];
      if (videoSource === 'ai-images' || videoSource === 'ai-animations' || mode === 'lyrics') {
        setGenerationStep('Generating Visuals...');
        const prompts = script.visual_prompts || [];
        for (let i = 0; i < prompts.length; i++) {
          setGenerationStep(`Generating Visual ${i + 1}/${prompts.length}...`);
          setGenerationProgress(40 + ((i / prompts.length) * 60));
          setEstimatedTime(`~${(prompts.length - i) * (videoSource === 'ai-animations' ? 60 : 15)} seconds remaining`);
          
          if (videoSource === 'ai-animations') {
            const operation = await generateVideo(prompts[i]);
            if (operation) {
              const videoBlob = await pollVideoOperation(operation);
              if (videoBlob) sceneVideos.push(videoBlob);
            }
          } else {
            const imgBlob = await generateImage(prompts[i]);
            if (imgBlob) images.push(imgBlob);
          }
        }
      }

      setGenerationProgress(100);
      setEstimatedTime('Done!');

      setReviewData({
        script,
        audioBlob,
        audioUrl: mode === 'lyrics' && !audioBlob ? musicUrl : null,
        images,
        sceneVideos,
        videoUrl: videoSource === 'youtube' ? youtubeUrl : (videoSource === 'stock' ? selectedStockVideo?.video_files[0]?.link : null),
        uploadedVideo,
        wordTimestamps
      });
      setIsReviewing(true);
      setIsCreating(false);
    } catch (error: any) {
      console.error(error);
      setGenerationStep(`Error: ${error.message}`);
      // Keep the error visible for a few seconds
      await new Promise(resolve => setTimeout(resolve, 3000));
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
      } else if (musicUrl && mode === 'lyrics') {
        formData.append('audioUrl', musicUrl);
      }
      reviewData.images.forEach((blob: Blob, i: number) => {
        formData.append('images', blob, `image_${i}.png`);
      });
      if (reviewData.sceneVideos) {
        reviewData.sceneVideos.forEach((blob: Blob, i: number) => {
          formData.append('sceneVideos', blob, `scene_${i}.mp4`);
        });
      }
      if (reviewData.uploadedVideo) {
        formData.append('video', reviewData.uploadedVideo);
      }
      if (reviewData.videoUrl) {
        formData.append('videoUrl', reviewData.videoUrl);
      }
      formData.append('topic', topic || 'Custom Script');
      formData.append('voice', voice);
      formData.append('tone', tone);
      formData.append('mode', mode);
      formData.append('script', JSON.stringify(reviewData.script));
      formData.append('musicUrl', musicUrl);
      if (uploadedMusic) {
        formData.append('music', uploadedMusic);
      }
      if (reviewData.wordTimestamps) {
        formData.append('wordTimestamps', JSON.stringify(reviewData.wordTimestamps));
      }

      const job = await safeFetchJson('/api/assemble', {
        method: 'POST',
        body: formData,
      });

      setJobs(prev => {
        if (prev.some(j => j.id === job.id)) {
          return prev.map(j => j.id === job.id ? job : j);
        }
        return [job, ...prev];
      });
      setIsReviewing(false);
      setReviewData(null);
      setTopic('');
      setCustomScript('');
      setMusicUrl('');
      setYoutubeUrl('');
      setSelectedStockVideo(null);
      setUploadedVideo(null);
      setUploadedAudio(null);
      setUploadedMusic(null);
    } catch (error: any) {
      console.error(error);
      setGenerationStep(`Error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 3000));
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

        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">Active Productions</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <AnimatePresence mode="popLayout">
              {jobs.map((job) => (
                <motion.div
                  key={job.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className={cn(
                    "group relative bg-white/5 border rounded-2xl overflow-hidden transition-all",
                    selectedJob?.id === job.id ? "border-purple-500 ring-1 ring-purple-500" : "border-white/5 hover:border-white/20"
                  )}
                >
                  <div className="aspect-video bg-neutral-900 relative overflow-hidden group/video">
                    {job.status === 'completed' ? (
                      <>
                        <video 
                          id={`video-${job.id}`}
                          src={job.videoUrl} 
                          className="w-full h-full object-cover" 
                          controls 
                          playsInline 
                        />
                        <div 
                          className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover/video:opacity-100 transition-opacity pointer-events-none"
                        >
                          <div className="w-16 h-16 bg-purple-500/80 backdrop-blur-sm rounded-full flex items-center justify-center text-white shadow-xl">
                            <Play className="w-8 h-8 ml-1" />
                          </div>
                        </div>
                      </>
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
                    <div className="flex items-center justify-between text-xs text-white/40 mb-4">
                      <span>{new Date(job.createdAt).toLocaleTimeString()}</span>
                      <span>{job.progress}%</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button 
                        onClick={() => setSelectedJob(selectedJob?.id === job.id ? null : job)}
                        className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1"
                      >
                        <Layout className="w-3 h-3" /> {selectedJob?.id === job.id ? 'Hide Details' : 'View Details'}
                      </button>
                      {job.status === 'completed' && (
                        <a 
                          href={job.videoUrl} 
                          download={`production_${job.id}.mp4`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1"
                        >
                          <Download className="w-3 h-3" /> Download
                        </a>
                      )}
                      <button 
                        onClick={(e) => handleRetryJob(job, e)}
                        className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" /> Retry
                      </button>
                      {job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled' && (
                        <button 
                          onClick={(e) => handleCancelJob(job.id, e)}
                          className="flex-1 py-1.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1"
                        >
                          <X className="w-3 h-3" /> Cancel
                        </button>
                      )}
                      <button 
                        onClick={(e) => handleDeleteJob(job.id, e)}
                        className="flex-1 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>

                    <AnimatePresence>
                      {selectedJob?.id === job.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="pt-4 mt-4 border-t border-white/10 space-y-4">
                            <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                              <label className="text-[10px] uppercase tracking-widest text-white/40 mb-2 block">Current Status</label>
                              <div className="flex items-center gap-3">
                                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                  <motion.div 
                                    initial={{ width: 0 }}
                                    animate={{ width: `${job.progress}%` }}
                                    className={cn("h-full", job.status === 'failed' ? "bg-red-500" : "bg-purple-500")}
                                  />
                                </div>
                                <span className="text-sm font-mono">{job.progress}%</span>
                              </div>
                              <p className={cn("text-xs mt-2 font-medium", job.status === 'failed' ? "text-red-400" : "text-purple-400")}>
                                {job.status}
                              </p>
                            </div>
                            <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                              <label className="text-[10px] uppercase tracking-widest text-white/40 mb-2 block">Metadata</label>
                              <div className="grid grid-cols-2 gap-4 text-xs mb-3">
                                <div>
                                  <p className="text-white/40">Tone</p>
                                  <p className="capitalize">{job.tone || 'Inspiring'}</p>
                                </div>
                                <div>
                                  <p className="text-white/40">Voice</p>
                                  <p className="capitalize">{job.voice || 'Kore'}</p>
                                </div>
                              </div>
                              {job.script?.hashtags && job.script.hashtags.length > 0 && (
                                <div>
                                  <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">Viral Hashtags</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {job.script.hashtags.map((tag: string, i: number) => (
                                      <span key={i} className="px-2 py-1 bg-purple-500/10 text-purple-400 rounded-md text-[10px] font-medium border border-purple-500/20">
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
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
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
                        {[
                          { id: 'ai-images', label: 'AI Images', icon: Sparkles },
                          { id: 'ai-animations', label: 'AI Animation', icon: Video },
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
                        <div className="space-y-3">
                          <div 
                            onClick={() => {
                              const input = document.createElement('input');
                              input.type = 'file';
                              input.accept = 'audio/*';
                              input.onchange = (e: any) => {
                                if (e.target.files?.[0]) {
                                  setUploadedMusic(e.target.files[0]);
                                  setMusicUrl('');
                                }
                              };
                              input.click();
                            }}
                            className="flex items-center justify-center w-full p-4 border-2 border-dashed border-white/10 rounded-xl hover:border-purple-500/50 hover:bg-purple-500/5 transition-all cursor-pointer group"
                          >
                            {uploadedMusic ? (
                              <div className="flex items-center gap-2 text-purple-400">
                                <CheckCircle2 className="w-5 h-5" />
                                <span className="text-sm truncate max-w-[200px]">{uploadedMusic.name}</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-2">
                                <Upload className="w-6 h-6 text-white/40 group-hover:text-purple-400 transition-colors" />
                                <span className="text-sm text-white/60 group-hover:text-white transition-colors">
                                  Upload Audio File
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="h-[1px] flex-1 bg-white/10"></div>
                            <span className="text-xs text-white/40 font-medium uppercase tracking-wider">OR</span>
                            <div className="h-[1px] flex-1 bg-white/10"></div>
                          </div>
                          <input 
                            type="text"
                            value={musicUrl}
                            onChange={(e) => {
                              setMusicUrl(e.target.value);
                              if (e.target.value) setUploadedMusic(null);
                            }}
                            placeholder="Direct Audio URL (optional)..."
                            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:border-purple-500/50"
                          />
                        </div>
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
                    {reviewData.audioBlob ? (
                      <audio 
                        src={URL.createObjectURL(reviewData.audioBlob)} 
                        controls 
                        className="w-full"
                      />
                    ) : reviewData.audioUrl ? (
                      <audio 
                        src={reviewData.audioUrl} 
                        controls 
                        className="w-full"
                      />
                    ) : (
                      <div className="p-4 bg-white/5 rounded-xl border border-white/5 text-center text-white/40 text-xs">
                        No audio preview available
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-8">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-white/40 mb-4 block">Visual Assets</label>
                    {reviewData.images.length > 0 || (reviewData.sceneVideos && reviewData.sceneVideos.length > 0) ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {reviewData.images.map((blob: Blob, i: number) => (
                          <div key={i} className="aspect-[9/16] bg-black rounded-xl overflow-hidden border border-white/10">
                            <img src={URL.createObjectURL(blob)} className="w-full h-full object-cover" />
                          </div>
                        ))}
                        {reviewData.sceneVideos?.map((blob: Blob, i: number) => (
                          <div key={`v-${i}`} className="aspect-[9/16] bg-black rounded-xl overflow-hidden border border-white/10">
                            <video src={URL.createObjectURL(blob)} className="w-full h-full object-cover" autoPlay muted loop />
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
                  onClick={() => {
                    setIsReviewing(false);
                    setIsCreating(true);
                  }}
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
