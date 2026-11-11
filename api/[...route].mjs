import login from '../backend/login.js';
import signup from '../backend/signup.js';
import logout from '../backend/logout.js';
import me from '../backend/me.js';
import submissions from '../backend/submissions.js';
import submissionsAdmin from '../backend/submissions_admin.js';
import subjects from '../backend/subjects.js';
import topics from '../backend/topics.js';
import customTopics from '../backend/custom_topics.js';
import sections from '../backend/sections.js';
import teachers from '../backend/teachers.js';
import teacherApprove from '../backend/teacher_approve.js';
import teacherSections from '../backend/teacher_sections.js';
import enroll from '../backend/enroll.js';
import csv from '../backend/csv.js';
import download from '../backend/download.js';
import upload from '../backend/upload.js';
import departments from '../backend/departments.js';

const routes = {
  login,
  signup,
  logout,
  me,
  submissions,
  submissions_admin: submissionsAdmin,
  subjects,
  topics,
  custom_topics: customTopics,
  sections,
  teachers,
  teacher_approve: teacherApprove,
  teacher_sections: teacherSections,
  enroll,
  csv,
  download,
  upload,
  departments,
};

export default async function handler(req, res) {
  try {
    // Same-origin app: no CORS headers, so other sites cannot call the API from a browser.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const { route } = req.query;
    let path = '';
    if (Array.isArray(route)) {
      path = route[0];
    } else if (typeof route === 'string') {
      path = route.split('/')[0];
    }
    if (!path) {
      const urlPath = (req.url || '').split('/api/')[1] || '';
      path = urlPath.split('/')[0].split('?')[0];
    }

    const handlerFn = Object.hasOwn(routes, path) ? routes[path] : null;
    if (!handlerFn) return res.status(404).json({ error: 'Not found' });

    // Handlers destructure req.body; make sure it is always an object.
    if (typeof req.body === 'string') {
      try { req.body = JSON.parse(req.body); } catch { req.body = {}; }
    }
    if (!req.body || typeof req.body !== 'object') req.body = {};

    return await handlerFn(req, res);
  } catch (e) {
    console.error('catchall error:', e);
    // Never echo internal error details to the client.
    if (!res.headersSent) return res.status(500).json({ error: 'Server error' });
  }
}
