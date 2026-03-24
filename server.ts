import express from 'express';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pdfModule from 'pdf-parse';
import natural from 'natural';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import db from './db.js';
import { GoogleGenAI, Type } from "@google/genai";

const { PDFParse } = pdfModule;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TfIdf = natural.TfIdf;
const tokenizer = new natural.WordTokenizer();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-prod';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Use memory storage for multer
  const storage = multer.memoryStorage();
  const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
  });

  // Auth Middleware
  const authenticateToken = (req: any, res: any, next: any) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.status(403).json({ error: 'Forbidden' });
      req.user = user;
      next();
    });
  };

  // Auth Routes
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { name, email, password } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
      }

      const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (existingUser) {
        return res.status(400).json({ error: 'Email already in use' });
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      const stmt = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)');
      const info = stmt.run(name, email, passwordHash);

      const token = jwt.sign({ id: info.lastInsertRowid, email, name }, JWT_SECRET, { expiresIn: '7d' });
      res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
      res.status(201).json({ user: { id: info.lastInsertRowid, name, email } });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
      }

      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
      if (!user) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }

      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
      res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
      res.json({ user: { id: user.id, name: user.name, email: user.email } });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
  });

  app.get('/api/auth/me', authenticateToken, (req: any, res) => {
    res.json({ user: req.user });
  });

  // API Routes
  app.post('/api/analyze', (req, res, next) => {
    upload.single('resume')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File is too large. Max size is 10MB.' });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      } else if (err) {
        return res.status(500).json({ error: `Server error during upload: ${err.message}` });
      }
      next();
    });
  }, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const isPdfMime = req.file.mimetype === 'application/pdf';
      const isPdfExt = req.file.originalname.toLowerCase().endsWith('.pdf');

      if (!isPdfMime && !isPdfExt) {
        console.warn('Rejected file with mimetype:', req.file.mimetype, 'and name:', req.file.originalname);
        return res.status(400).json({ error: 'Only PDF files are allowed. Please ensure your file has a .pdf extension.' });
      }

      // Extract text from PDF
      const dataBuffer = req.file.buffer;
      
      if (!PDFParse) {
        console.error('PDFParse class is not available in the module.');
        return res.status(500).json({ error: 'Server configuration error: PDF parser not available.' });
      }

      console.log('Starting PDF extraction for file:', req.file.originalname, 'Size:', req.file.size);
      
      let resumeText = '';
      try {
        const parser = new PDFParse({ data: dataBuffer });
        const result = await parser.getText();
        resumeText = result.text || '';
        await parser.destroy();
      } catch (pdfError: any) {
        console.error('PDF extraction failed:', pdfError);
        return res.status(400).json({ error: `Failed to parse PDF: ${pdfError.message || 'The file might be corrupted or encrypted.'}` });
      }

      if (!resumeText.trim()) {
        return res.status(400).json({ error: 'Could not extract text from the PDF. It might be an image-based PDF or encrypted.' });
      }

      // Load job title
      const jobTitle = req.body.jobTitle || 'Software Engineer';

      let improvements: { title: string; suggestion: string; impact: string }[] = [];
      let newSkillsToLearn: string[] = [];
      let skillsToImprove: string[] = [];
      let missingKeywords: string[] = [];
      let overallScore: number = 0;
      
      try {
        if (process.env.GEMINI_API_KEY) {
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const response = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: `You are an expert ATS resume reviewer and career coach.
            
            Target Job Title: ${jobTitle}
            
            Resume:
            ${resumeText.substring(0, 3000)}
            
            Perform a highly accurate and comprehensive skill gap analysis by evaluating the candidate's resume against the standard industry requirements and expectations for a "${jobTitle}".
            
            Provide the following:
            1. "overallScore": A highly accurate score from 0 to 100 representing the overall match of the resume to the industry standard for a ${jobTitle}.
            2. "improvements": 3-5 specific, actionable improvement suggestions to better tailor the resume for a ${jobTitle}. Each improvement must have a short "title", a detailed "suggestion" based specifically on the resume content, and an "impact" level (High, Medium, Low).
            3. "newSkillsToLearn": 4-6 skills highly relevant to a ${jobTitle} that are missing from the resume.
            4. "skillsToImprove": 4-6 skills present in the resume that should be highlighted better or advanced.
            5. "missingKeywords": 4-6 critical industry keywords for a ${jobTitle} that are missing in the resume.
            
            Return the result as a JSON object with these five keys.`,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  overallScore: { type: Type.NUMBER, description: "Overall match score (0-100)" },
                  improvements: { 
                    type: Type.ARRAY, 
                    items: { 
                      type: Type.OBJECT,
                      properties: {
                        title: { type: Type.STRING, description: "Short title of the improvement" },
                        suggestion: { type: Type.STRING, description: "Detailed, actionable suggestion based on the resume" },
                        impact: { type: Type.STRING, description: "Impact level: High, Medium, or Low" }
                      },
                      required: ["title", "suggestion", "impact"]
                    }, 
                    description: "Actionable improvement suggestions" 
                  },
                  newSkillsToLearn: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Missing skills relevant to industry taxonomy" },
                  skillsToImprove: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Present skills to highlight or advance" },
                  missingKeywords: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Critical missing industry keywords" }
                },
                required: ["overallScore", "improvements", "newSkillsToLearn", "skillsToImprove", "missingKeywords"]
              }
            }
          });
          
          if (response.text) {
            const parsed = JSON.parse(response.text);
            overallScore = parsed.overallScore || 0;
            improvements = parsed.improvements || [];
            newSkillsToLearn = parsed.newSkillsToLearn || [];
            skillsToImprove = parsed.skillsToImprove || [];
            missingKeywords = parsed.missingKeywords || [];
          }
        }
      } catch (e) {
        console.error("Gemini API error:", e);
      }

      // Fallback if Gemini fails
      if (overallScore === 0) {
        overallScore = 50;
        improvements.push({
          title: "Mention Job Title",
          suggestion: `Ensure your resume explicitly mentions the target job title "${jobTitle}".`,
          impact: "High"
        });
        improvements.push({
          title: "Quantify Achievements",
          suggestion: "Quantify your past achievements with metrics (e.g., 'increased sales by 20%') to make your impact more concrete.",
          impact: "High"
        });
        improvements.push({
          title: "Use Action Verbs",
          suggestion: "Start each bullet point in your experience section with a strong action verb (e.g., 'Spearheaded', 'Developed', 'Optimized').",
          impact: "Medium"
        });
      }

      res.json({
        score: overallScore,
        missingKeywords,
        newSkillsToLearn,
        skillsToImprove,
        improvements,
        resumePreview: resumeText.substring(0, 200).replace(/\s+/g, ' ') + '...'
      });
    } catch (error: any) {
      console.error('Error analyzing resume:', error);
      res.status(500).json({ error: `Analysis failed: ${error.message || 'Please ensure it is a valid PDF.'}` });
    }
  });

  app.get('/api/job-description', (req, res) => {
    try {
      const jobDataPath = path.join(process.cwd(), 'job_data.json');
      if (fs.existsSync(jobDataPath)) {
        const jobData = JSON.parse(fs.readFileSync(jobDataPath, 'utf-8'));
        res.json(jobData);
      } else {
        res.json({ title: "Software Engineer", content: "We are looking for a professional with strong skills in software development, communication, and problem solving." });
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to load job data' });
    }
  });

  app.post('/api/job-description', (req, res) => {
    try {
      const { title, content } = req.body;
      if (typeof content !== 'string' || typeof title !== 'string') {
        return res.status(400).json({ error: 'Invalid data' });
      }
      const jobDataPath = path.join(process.cwd(), 'job_data.json');
      fs.writeFileSync(jobDataPath, JSON.stringify({ title, content }), 'utf-8');
      res.json({ success: true, title, content });
    } catch (error) {
      console.error('Failed to save job data:', error);
      res.status(500).json({ error: 'Failed to save job data' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
