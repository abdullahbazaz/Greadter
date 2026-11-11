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
  const { route = [] } = req.query;
  const path = Array.isArray(route) ? route.join('/') : route;
  const name = path.split('/')[0];
  const handlerFn = routes[name];

  if (!handlerFn) {
    return res.status(404).json({ error: 'Not found' });
  }

  // Set query params for routes that expect them
  if (path.includes('/')) {
    const parts = path.split('/');
    // pass remaining as needed - handlers read from req.query
  }
  return handlerFn(req, res);
}
