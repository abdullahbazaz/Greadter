const routeMap = {
  login: '../backend/login.js',
  signup: '../backend/signup.js',
  logout: '../backend/logout.js',
  me: '../backend/me.js',
  submissions: '../backend/submissions.js',
  submissions_admin: '../backend/submissions_admin.js',
  subjects: '../backend/subjects.js',
  subjects_create: '../backend/subjects_create.js',
  topics: '../backend/topics.js',
  topics_create: '../backend/topics_create.js',
  custom_topics: '../backend/custom_topics.js',
  sections: '../backend/sections.js',
  teachers: '../backend/teachers.js',
  teacher_approve: '../backend/teacher_approve.js',
  teacher_sections: '../backend/teacher_sections.js',
  enroll: '../backend/enroll.js',
  csv: '../backend/csv.js',
  download: '../backend/download.js',
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
      const urlPath = req.url.split('/api/')[1] || '';
      path = urlPath.split('/')[0].split('?')[0];
    }
    
    const modulePath = routeMap[path];
    if (!modulePath) {
      return res.status(404).json({ error: 'Not found' });
    }
    
    const mod = await import(modulePath);
    const handlerFn = mod.default || mod;
    return handlerFn(req, res);
  } catch (e) {
    console.error('catchall error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
