import login from '../backend/login.js';
import signup from '../backend/signup.js';
import logout from '../backend/logout.js';
import me from '../backend/me.js';
import submissions from '../backend/submissions.js';
import submissions_admin from '../backend/submissions_admin.js';
import subjects from '../backend/subjects.js';
import subjects_create from '../backend/subjects_create.js';
import topics from '../backend/topics.js';
import topics_create from '../backend/topics_create.js';
import custom_topics from '../backend/custom_topics.js';
import sections from '../backend/sections.js';
import teachers from '../backend/teachers.js';
import teacher_approve from '../backend/teacher_approve.js';
import teacher_sections from '../backend/teacher_sections.js';
import enroll from '../backend/enroll.js';
import csv from '../backend/csv.js';
import download from '../backend/download.js';

const routes = {
  login,
  signup,
  logout,
  me,
  submissions,
  submissions_admin,
  subjects,
  subjects_create,
  topics,
  topics_create,
  custom_topics,
  sections,
  teachers,
  teacher_approve,
  teacher_sections,
  enroll,
  csv,
  download,
};

export default async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const { route } = req.query;
    let path = '';
    if (Array.isArray(route)) {
      path = route[0]; // Get first segment
    } else if (typeof route === 'string') {
      path = route.split('/')[0];
    }
    
    const name = path || req.url.split('/api/')[1]?.split('/')[0]?.split('?')[0];
    const handlerFn = routes[name];

    if (!handlerFn) {
      return res.status(404).json({ error: 'Not found', name });
    }
    
    return handlerFn(req, res);
  } catch (e) {
    console.error('catchall error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
EOF
