import React, { useState, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, Sparkles, ArrowRight, ArrowLeft, Search, LogOut, User as UserIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface AnalysisResult {
  score: number;
  missingKeywords: string[];
  newSkillsToLearn: string[];
  skillsToImprove: string[];
  improvements: { title: string; suggestion: string; impact: string }[];
  resumePreview: string;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [user, setUser] = useState<{ id: number; name: string; email: string } | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [view, setView] = useState<'home' | 'scanning' | 'results'>('home');
  const [numPages, setNumPages] = useState<number | null>(null);

  const PREDEFINED_JOB_TITLES = [
    "Software Engineer", "Senior Software Engineer", "Frontend Developer", "Backend Developer",
    "Full Stack Developer", "Data Scientist", "Data Analyst", "Machine Learning Engineer",
    "Product Manager", "Project Manager", "UI/UX Designer", "DevOps Engineer",
    "Cloud Architect", "Cybersecurity Analyst", "Systems Administrator", "Database Administrator",
    "Network Engineer", "Quality Assurance (QA) Engineer", "Business Analyst", "Marketing Manager",
    "Sales Representative", "Human Resources Manager", "Financial Analyst", "Accountant",
    "Operations Manager", "Customer Success Manager", "Technical Writer"
  ].sort();

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      } catch (err) {
        console.error('Auth check failed', err);
      } finally {
        setIsAuthReady(true);
      }
    };
    checkAuth();
  }, []);

  useEffect(() => {
    const fetchJobDesc = async () => {
      try {
        const res = await fetch('/api/job-description');
        const contentType = res.headers.get('content-type');
        const isJson = contentType && contentType.includes('application/json');

        if (!res.ok) {
          if (isJson) {
            const errData = await res.json();
            throw new Error(errData.error || 'Failed to load job description');
          } else {
            const text = await res.text();
            console.error('Expected JSON but got:', text.substring(0, 100));
            throw new Error('Server returned non-JSON response');
          }
        }

        if (!isJson) {
          throw new Error('Server returned non-JSON response');
        }

        const data = await res.json();
        setJobTitle(data.title || '');
      } catch (err: any) {
        console.error('Failed to load job description', err);
      }
    };
    fetchJobDesc();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const isPdf = selectedFile.type === 'application/pdf' || selectedFile.name.toLowerCase().endsWith('.pdf');
      
      if (isPdf) {
        setFile(selectedFile);
        setError(null);
      } else {
        setError('Please upload a PDF file.');
        setFile(null);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      const isPdf = droppedFile.type === 'application/pdf' || droppedFile.name.toLowerCase().endsWith('.pdf');
      
      if (isPdf) {
        setFile(droppedFile);
        setError(null);
      } else {
        setError('Please upload a PDF file.');
        setFile(null);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !jobTitle) return;

    if (!user) {
      setShowSignIn(true);
      return;
    }

    setIsAnalyzing(true);
    setView('scanning');
    setError(null);
    setResult(null);

    try {
      // Save job title first
      const jobDescResponse = await fetch('/api/job-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: jobTitle, content: '' }),
      });
      
      if (!jobDescResponse.ok) {
        throw new Error('Failed to save job title');
      }

      const formData = new FormData();
      formData.append('resume', file);
      formData.append('jobTitle', jobTitle);

      const [response] = await Promise.all([
        fetch('/api/analyze', {
          method: 'POST',
          body: formData,
        }),
        new Promise(resolve => setTimeout(resolve, 2500)) // Ensure animation plays for at least 2.5s
      ]);

      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');

      if (!response.ok) {
        if (isJson) {
          const errData = await response.json();
          throw new Error(errData.error || 'Analysis failed');
        } else {
          const text = await response.text();
          console.error('Expected JSON but got:', text.substring(0, 100));
          throw new Error('Server returned non-JSON response');
        }
      }

      if (!isJson) {
        throw new Error('Server returned non-JSON response');
      }

      const data = await response.json();
      setResult(data);
      setView('results');
    } catch (err: any) {
      setError(err.message || 'Something went wrong during analysis. Please try again.');
      console.error(err);
      setView('home');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGoHome = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setView('home');
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsAuthLoading(true);
    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload = authMode === 'login' 
        ? { email: authForm.email, password: authForm.password }
        : authForm;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      setUser(data.user);
      setShowSignIn(false);
      setAuthForm({ name: '', email: '', password: '' });
    } catch (error: any) {
      setAuthError(error.message);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      setResult(null);
      setFile(null);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA]">
        <Loader2 className="w-8 h-8 animate-spin text-black/40" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-black selection:text-white">
      {/* Header */}
      <header className="border-b border-black/5 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={handleGoHome} className="flex items-center gap-2 hover:opacity-80 transition-opacity text-left">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight">ATS Resume Pro</span>
          </button>
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm font-medium text-black/80">
                  <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center border border-black/10">
                    <UserIcon className="w-4 h-4 text-black/60" />
                  </div>
                  <span className="hidden sm:inline">{user.name || user.email}</span>
                </div>
                <button 
                  onClick={handleSignOut}
                  className="p-2 text-black/60 hover:text-black hover:bg-black/5 rounded-full transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setShowSignIn(true)}
                className="bg-black text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-black/80 transition-all"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center min-h-[80vh]"
            >
              <div className="space-y-12">
                <section>
                  <h1 className="text-5xl lg:text-7xl font-bold tracking-tight mb-6 leading-[0.9]">
                    Analyze your resume <br />
                    <span className="text-black/40">against any job description.</span>
                  </h1>
                  <p className="text-lg text-black/60 max-w-md">
                    Provide the target role details and upload your resume to get instant feedback.
                  </p>
                </section>

                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Job Title Block */}
                  <div className="bg-white border border-black/5 rounded-3xl p-6 shadow-xl shadow-black/5 space-y-3">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-black/40">1. Job Title</h3>
                    <select
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      className="w-full px-4 py-3 bg-black/5 rounded-xl border-none focus:ring-2 focus:ring-black/10 outline-none transition-all font-sans text-sm custom-scrollbar"
                      required
                    >
                      <option value="" disabled>Select a target role...</option>
                      {PREDEFINED_JOB_TITLES.map(title => (
                        <option key={title} value={title}>{title}</option>
                      ))}
                    </select>
                  </div>

                  {/* Upload Resume Block */}
                  <div className="bg-white border border-black/5 rounded-3xl p-6 shadow-xl shadow-black/5 space-y-3">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-black/40">2. Upload Resume</h3>
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`relative group border-2 border-dashed rounded-2xl p-8 transition-all duration-300 flex flex-col items-center justify-center gap-4 ${
                        isDragging 
                          ? 'border-black bg-black/5 scale-[0.99]' 
                          : 'border-black/10 hover:border-black/20 bg-black/5'
                      }`}
                    >
                      <input
                        type="file"
                        accept=".pdf"
                        onChange={handleFileChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        required
                      />
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${
                        file ? 'bg-emerald-50 text-emerald-600' : 'bg-white text-black/40 group-hover:bg-black/5 group-hover:text-black/60 shadow-sm'
                      }`}>
                        {file ? <CheckCircle className="w-6 h-6" /> : <Upload className="w-6 h-6" />}
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-sm">
                          {file ? file.name : 'Drop your resume here'}
                        </p>
                        <p className="text-xs text-black/40">
                          {file ? 'Click to change file' : 'or click to browse (PDF only)'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600"
                      >
                        <AlertCircle className="w-5 h-5" />
                        <p className="text-sm font-medium">{error}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <button
                    type="submit"
                    disabled={!file || !jobTitle || isAnalyzing}
                    className={`w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-all ${
                      !file || !jobTitle || isAnalyzing
                        ? 'bg-black/5 text-black/20 cursor-not-allowed'
                        : 'bg-black text-white hover:bg-black/90 active:scale-[0.98] shadow-xl shadow-black/10'
                    }`}
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        Analyze Resume
                        <ArrowRight className="w-5 h-5" />
                      </>
                    )}
                  </button>
                </form>
              </div>
              
              <div className="hidden lg:flex relative h-full items-center justify-center">
                <div className="absolute inset-0 bg-black/5 rounded-[3rem] -z-10 transform rotate-3"></div>
                <div className="bg-white p-12 rounded-[3rem] shadow-2xl border border-black/5 relative w-full aspect-square flex flex-col items-center justify-center text-center space-y-8">
                  <div className="rail-text absolute left-6 top-1/2 -translate-y-1/2 text-black/20 font-bold">
                    ATS RESUME PRO
                  </div>
                  <div className="feature-bubble absolute top-12 right-12">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <div className="feature-bubble absolute bottom-12 left-24">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div className="cta-circle absolute bottom-12 right-12 bg-black text-white">
                    START
                  </div>
                  
                  <h2 className="text-3xl font-bold tracking-tight">
                    Beat the bots. <br/> Land the interview.
                  </h2>
                  <p className="text-black/60 max-w-sm">
                    Our advanced AI analyzes your resume against industry taxonomies to ensure you're speaking the same language as the Applicant Tracking Systems.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'scanning' && (
            <motion.div
              key="scanning"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="flex flex-col items-center justify-center min-h-[60vh] space-y-12"
            >
              <div className="relative">
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                  className="absolute -inset-8 border-[1px] border-dashed border-black/20 rounded-full"
                />
                <motion.div 
                  animate={{ rotate: -360 }}
                  transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
                  className="absolute -inset-12 border-[1px] border-dashed border-black/10 rounded-full"
                />
                <div className="relative w-40 h-52 bg-white border-4 border-black/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col p-6 gap-4">
                  <div className="h-3 bg-black/10 rounded-full w-3/4"></div>
                  <div className="h-3 bg-black/10 rounded-full w-full"></div>
                  <div className="h-3 bg-black/10 rounded-full w-5/6"></div>
                  <div className="h-3 bg-black/10 rounded-full w-full"></div>
                  <div className="h-3 bg-black/10 rounded-full w-2/3"></div>
                  <div className="h-3 bg-black/10 rounded-full w-4/5"></div>
                  <div className="h-3 bg-black/10 rounded-full w-full"></div>
                  
                  <motion.div 
                    animate={{ y: [-20, 220, -20] }} 
                    transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-transparent via-emerald-500/20 to-emerald-500/50 border-b-2 border-emerald-500 shadow-[0_5px_15px_rgba(16,185,129,0.5)]"
                  />
                </div>
              </div>
              <div className="text-center space-y-3">
                <h2 className="text-3xl font-bold tracking-tight flex items-center justify-center gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                  Analyzing Resume
                </h2>
                <p className="text-black/50 text-base font-medium animate-pulse">
                  Extracting keywords and calculating TF-IDF score...
                </p>
              </div>
            </motion.div>
          )}

          {view === 'results' && result && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full space-y-8"
            >
              <button onClick={handleGoHome} className="flex items-center gap-2 text-sm font-bold text-black/40 hover:text-black transition-colors">
                <ArrowLeft className="w-4 h-4" /> Back to Upload
              </button>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Side: PDF Viewer */}
                <div className="bg-white border border-black/5 rounded-3xl p-6 shadow-xl shadow-black/5 flex flex-col h-[800px]">
                  <h2 className="text-xl font-bold mb-4 shrink-0">Uploaded Resume</h2>
                  <div className="flex-1 overflow-y-auto rounded-2xl border border-black/5 bg-black/5 p-4 custom-scrollbar">
                    {file ? (
                      <Document
                        file={file}
                        onLoadSuccess={onDocumentLoadSuccess}
                        loading={
                          <div className="flex items-center justify-center h-full">
                            <Loader2 className="w-8 h-8 animate-spin text-black/40" />
                          </div>
                        }
                        error={
                          <div className="flex items-center justify-center h-full text-red-500">
                            Failed to load PDF.
                          </div>
                        }
                        className="flex flex-col items-center gap-4"
                      >
                        {Array.from(new Array(numPages || 0), (el, index) => (
                          <Page
                            key={`page_${index + 1}`}
                            pageNumber={index + 1}
                            renderTextLayer={true}
                            renderAnnotationLayer={true}
                            className="shadow-md rounded-lg overflow-hidden"
                            width={500}
                          />
                        ))}
                      </Document>
                    ) : (
                      <div className="flex-1 flex items-center justify-center h-full">
                        <p className="text-black/40">PDF preview not available</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Side: Analysis Results */}
                <div className="bg-white border border-black/5 rounded-3xl p-10 shadow-xl shadow-black/5 space-y-10 h-[800px] overflow-y-auto">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold">Analysis Result</h2>
                    <span className="text-xs font-bold uppercase tracking-widest text-black/40">Score</span>
                  </div>

                  <div className="flex justify-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="relative w-32 h-32 flex items-center justify-center shrink-0">
                        <svg className="w-full h-full -rotate-90">
                          <circle
                            cx="64"
                            cy="64"
                            r="56"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="10"
                            className="text-black/5"
                          />
                          <circle
                            cx="64"
                            cy="64"
                            r="56"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="10"
                            strokeDasharray={351.8}
                            strokeDashoffset={351.8 - (351.8 * result.score) / 100}
                            className={`${
                              result.score > 70 ? 'text-emerald-500' : result.score > 40 ? 'text-amber-500' : 'text-red-500'
                            } transition-all duration-1000 ease-out`}
                          />
                        </svg>
                        <span className="absolute text-3xl font-black">{Math.round(result.score)}%</span>
                      </div>
                      <div className="text-center">
                        <h3 className="font-bold text-lg">Overall Match</h3>
                        <p className="text-sm text-black/60">Keyword & Industry Score</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-black/5 p-6 rounded-2xl">
                    <p className="text-lg font-medium text-black/70 leading-relaxed text-center">
                      {result.score > 70 
                        ? "Excellent match! Your resume is highly optimized for this role." 
                        : result.score > 40 
                        ? "Good start, but there's room for improvement in keyword matching." 
                        : "Low match. Consider tailoring your resume more closely to the job description."}
                    </p>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-black/40">Missing Keywords</h3>
                    <div className="flex flex-wrap gap-2">
                      {result.missingKeywords.length > 0 ? (
                        result.missingKeywords.map((keyword, i) => (
                          <span 
                            key={i} 
                            className="px-4 py-2 bg-black/5 rounded-full text-sm font-semibold text-black/70 border border-black/5"
                          >
                            {keyword}
                          </span>
                        ))
                      ) : (
                        <p className="text-sm text-emerald-600 font-medium flex items-center gap-2">
                          <CheckCircle className="w-5 h-5" />
                          No critical keywords missing!
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {result.skillsToImprove && result.skillsToImprove.length > 0 && (
                      <div className="space-y-4 bg-amber-50/50 border border-amber-100 p-6 rounded-3xl">
                        <h3 className="text-sm font-bold uppercase tracking-widest text-amber-600">Skills to Improve</h3>
                        <p className="text-sm text-amber-700/70 mb-4">You mentioned these, but consider highlighting them more prominently based on the job description.</p>
                        <div className="flex flex-wrap gap-2">
                          {result.skillsToImprove.map((skill, i) => (
                            <span 
                              key={i} 
                              className="px-4 py-2 bg-amber-100/50 text-amber-800 rounded-full text-sm font-semibold border border-amber-200/50"
                            >
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {result.newSkillsToLearn && result.newSkillsToLearn.length > 0 && (
                      <div className="space-y-4 bg-emerald-50/50 border border-emerald-100 p-6 rounded-3xl">
                        <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-600">New Skills to Learn</h3>
                        <p className="text-sm text-emerald-700/70 mb-4">These are highly relevant to the role but appear to be missing from your resume.</p>
                        <div className="flex flex-wrap gap-2">
                          {result.newSkillsToLearn.map((skill, i) => (
                            <span 
                              key={i} 
                              className="px-4 py-2 bg-emerald-100/50 text-emerald-800 rounded-full text-sm font-semibold border border-emerald-200/50"
                            >
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {result.improvements && result.improvements.length > 0 && (
                    <div className="space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-black/40">AI Improvement Suggestions</h3>
                      <div className="space-y-4">
                        {result.improvements.map((improvement, i) => (
                          <div key={i} className="flex flex-col gap-2 bg-black/5 p-5 rounded-2xl border border-black/5">
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-emerald-600" />
                                <h4 className="font-bold text-black/80">{improvement.title}</h4>
                              </div>
                              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${
                                improvement.impact.toLowerCase() === 'high' 
                                  ? 'bg-red-100 text-red-700' 
                                  : improvement.impact.toLowerCase() === 'medium'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-blue-100 text-blue-700'
                              }`}>
                                {improvement.impact} Impact
                              </span>
                            </div>
                            <p className="text-sm text-black/60 leading-relaxed pl-6">
                              {improvement.suggestion}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-black/40">Resume Preview</h3>
                    <p className="text-sm text-black/50 bg-black/5 p-6 rounded-2xl italic leading-relaxed">
                      "{result.resumePreview}"
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-black/5 py-12 mt-12">
        <div className="max-w-5xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2 opacity-40">
            <Sparkles className="w-4 h-4" />
            <span className="font-bold text-sm">ATS Resume Pro</span>
          </div>
          <div className="flex gap-8 text-sm font-medium text-black/40">
            <a href="#" className="hover:text-black transition-colors">Privacy</a>
            <a href="#" className="hover:text-black transition-colors">Terms</a>
            <a href="#" className="hover:text-black transition-colors">Contact</a>
          </div>
          <p className="text-xs text-black/20 font-medium">
            © 2026 ATS Resume Pro. All rights reserved.
          </p>
        </div>
      </footer>

      {/* Sign In Modal */}
      <AnimatePresence>
        {showSignIn && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSignIn(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl relative overflow-hidden"
            >
              <button 
                onClick={() => setShowSignIn(false)}
                className="absolute top-6 right-6 text-black/40 hover:text-black transition-colors"
              >
                <AlertCircle className="w-6 h-6 rotate-45" />
              </button>
              
              <div className="flex flex-col items-center mt-4">
                <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-black/10">
                  <Sparkles className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-2xl font-bold tracking-tight mb-2">
                  {authMode === 'login' ? 'Welcome Back' : 'Create Account'}
                </h2>
                <p className="text-black/60 text-sm mb-6 text-center leading-relaxed">
                  {authMode === 'login' 
                    ? 'Sign in to analyze your resume and get personalized feedback.' 
                    : 'Register to analyze your resume and get personalized feedback.'}
                </p>
                
                {authError && (
                  <div className="w-full bg-red-50 text-red-600 text-sm p-3 rounded-xl mb-4 border border-red-100 text-center">
                    {authError}
                  </div>
                )}

                <form onSubmit={handleSignIn} className="w-full space-y-4">
                  {authMode === 'register' && (
                    <div>
                      <label className="block text-xs font-bold text-black/60 mb-1 uppercase tracking-wider">Name</label>
                      <input 
                        type="text" 
                        required
                        value={authForm.name}
                        onChange={e => setAuthForm({...authForm, name: e.target.value})}
                        className="w-full px-4 py-3 rounded-xl bg-black/5 border-none focus:ring-2 focus:ring-black/10 outline-none transition-all"
                        placeholder="John Doe"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-bold text-black/60 mb-1 uppercase tracking-wider">Email</label>
                    <input 
                      type="email" 
                      required
                      value={authForm.email}
                      onChange={e => setAuthForm({...authForm, email: e.target.value})}
                      className="w-full px-4 py-3 rounded-xl bg-black/5 border-none focus:ring-2 focus:ring-black/10 outline-none transition-all"
                      placeholder="you@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-black/60 mb-1 uppercase tracking-wider">Password</label>
                    <input 
                      type="password" 
                      required
                      value={authForm.password}
                      onChange={e => setAuthForm({...authForm, password: e.target.value})}
                      className="w-full px-4 py-3 rounded-xl bg-black/5 border-none focus:ring-2 focus:ring-black/10 outline-none transition-all"
                      placeholder="••••••••"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isAuthLoading}
                    className="w-full flex items-center justify-center gap-2 bg-black text-white font-bold py-4 px-4 rounded-2xl hover:bg-black/90 transition-all disabled:opacity-70 mt-2"
                  >
                    {isAuthLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (authMode === 'login' ? 'Sign In' : 'Register')}
                  </button>
                </form>

                <div className="mt-6 text-sm text-black/60">
                  {authMode === 'login' ? "Don't have an account? " : "Already have an account? "}
                  <button 
                    onClick={() => {
                      setAuthMode(authMode === 'login' ? 'register' : 'login');
                      setAuthError('');
                    }}
                    className="text-black font-bold hover:underline"
                  >
                    {authMode === 'login' ? 'Register' : 'Sign In'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
