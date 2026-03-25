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
      let workExperienceMatchScore: number = 0;
      let overallScore: number = 0;
      let sectionScores = {
        education: 0,
        experience: 0,
        skills: 0,
        formatting: 0
      };
      
      try {
        const textLower = resumeText.toLowerCase();
        const jobTitleLower = jobTitle.toLowerCase();
        
        // Simple keyword matching based on job title
        const keywordMap: Record<string, string[]> = {
          'software engineer': ['javascript', 'typescript', 'react', 'node.js', 'python', 'java', 'c++', 'git', 'agile', 'api', 'sql', 'nosql', 'aws', 'docker'],
          'frontend developer': ['html', 'css', 'javascript', 'react', 'vue', 'angular', 'typescript', 'responsive design', 'webpack', 'ui/ux'],
          'backend developer': ['node.js', 'python', 'java', 'ruby', 'php', 'sql', 'nosql', 'api', 'rest', 'graphql', 'docker', 'kubernetes', 'aws'],
          'data scientist': ['python', 'r', 'sql', 'machine learning', 'data analysis', 'statistics', 'pandas', 'numpy', 'scikit-learn', 'tensorflow', 'pytorch'],
          'product manager': ['agile', 'scrum', 'roadmap', 'jira', 'user stories', 'market research', 'data analysis', 'stakeholder management', 'strategy']
        };

        const defaultKeywords = ['communication', 'teamwork', 'problem solving', 'leadership', 'project management', 'agile'];
        const targetKeywords = keywordMap[jobTitleLower] || defaultKeywords;

        let matchCount = 0;
        targetKeywords.forEach(keyword => {
          if (textLower.includes(keyword)) {
            matchCount++;
            skillsToImprove.push(keyword);
          } else {
            missingKeywords.push(keyword);
            newSkillsToLearn.push(keyword);
          }
        });

        const keywordScore = Math.round((matchCount / targetKeywords.length) * 100);
        
        // Basic heuristics for section scores
        sectionScores.education = textLower.includes('bachelor') || textLower.includes('master') || textLower.includes('degree') || textLower.includes('university') ? 85 : 40;
        sectionScores.experience = textLower.includes('experience') || textLower.includes('work') || textLower.includes('employment') ? 80 : 30;
        sectionScores.skills = keywordScore;
        sectionScores.formatting = resumeText.length > 500 ? 90 : 50;

        workExperienceMatchScore = sectionScores.experience;
        overallScore = Math.round((sectionScores.education + sectionScores.experience + sectionScores.skills + sectionScores.formatting) / 4);

        if (missingKeywords.length > 0) {
          improvements.push({
            title: 'Add Missing Keywords',
            suggestion: `Your resume is missing key industry terms like ${missingKeywords.slice(0, 3).join(', ')}. Add them to pass ATS filters.`,
            impact: 'High'
          });
        }

        if (sectionScores.education < 50) {
          improvements.push({
            title: 'Highlight Education',
            suggestion: 'Make sure your education section is clearly labeled with terms like "Bachelor", "Master", or "Degree".',
            impact: 'Medium'
          });
        }

        if (sectionScores.experience < 50) {
          improvements.push({
            title: 'Detail Work Experience',
            suggestion: 'Ensure your work experience is clearly separated and uses strong action verbs.',
            impact: 'High'
          });
        }

        if (improvements.length === 0) {
           improvements.push({
            title: 'Great Job',
            suggestion: 'Your resume looks solid. Keep tailoring it for specific roles.',
            impact: 'Low'
          });
        }

      } catch (e: any) {
        console.error("Analysis error:", e);
        return res.status(500).json({ error: `Analysis failed: ${e.message}` });
      }

      res.json({
        score: overallScore,
        sectionScores,
        missingKeywords,
        newSkillsToLearn,
        skillsToImprove,
        improvements,
        workExperienceMatchScore,
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
