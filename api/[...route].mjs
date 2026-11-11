import login from '../backend/login.js';
import signup from '../backend/signup.js';
import logout from '../backend/logout.js';
import me from '../backend/me.js';
import submissions from '../backend/submissions.js';
import submissionsAdmin from '../backend/submissions_admin.js';
import subjects from '../backend/subjects.js';
import subjectsCreate from '../backend/subjects_create.js';
import topics from '../backend/topics.js';
import topicsCreate from '../backend/topics_create.js';
import customTopics from '../backend/custom_topics.js';
import sections from '../backend/sections.js';
import teachers from '../backend/teachers.js';
import teacherApprove from '../backend/teacher_approve.js';
import teacherSections from '../backend/teacher_sections.js';
import enroll from '../backend/enroll.js';
import csv from '../backend/csv.js';
import download from '../backend/download.js';

const routes = {
  login,
  signup,
  logout,
  me,
  submissions,
  submissions_admin: submissionsAdmin,
  subjects,
  subjects_create: subjectsCreate,
  topics,
  topics_create: topicsCreate,
  custom_topics: customTopics,
  sections,
  teachers,
  teacher_approve: teacherApprove,
  teacher_sections: teacherSections,
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
      path = route[0];
    } else if (typeof route === 'string') {
      path = route.split('/')[0];
    }

    if (!path) {
      const urlPath = (req.url || '').split('/api/')[1] || '';
      path = urlPath.split('/')[0].split('?')[0];
    }

    const handlerFn = routes[path];
    if (!handlerFn) {
      return res.status(404).json({ error: 'Not found', path });
    }

    return handlerFn(req, res);
  } catch (e) {
    console.error('catchall error:', e);
    return res.status(500).json({ error: 'Server error', detail: String(e) });
  }
}
