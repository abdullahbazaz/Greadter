import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

const sql = neon(process.env.DATABASE_URL);

const files = [
  { file: 'CSE2024A.csv', sectionKey: 'cse 2024 a' },
  { file: 'CSE2024B.csv', sectionKey: 'cse 2024 b' },
  { file: 'ME2023B.csv',  sectionKey: 'me 2023 b' },
  { file: 'ECE2025A.csv', sectionKey: 'ece 2025 a' },
  { file: 'ECE2023B.csv', sectionKey: 'ece 2023 b' },
  { file: 'CE2025A.csv',  sectionKey: 'ce 2025 a' },
];

async function importRoster() {
  for (const { file, sectionKey } of files) {
    const filePath = path.join(process.cwd(), file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const lines = text.trim().split('\n');
    const rows = lines.slice(1).map(line => {
      const [reg_no, name, roll_no, dept, email] = line.split(',').map(c => c.trim());
      return { reg_no, name, roll_no, dept, email, section_key: sectionKey };
    });

    for (const row of rows) {
      await sql`
        INSERT INTO student_roster (reg_no, name, roll_no, dept, email, section_key)
        VALUES (${row.reg_no}, ${row.name}, ${row.roll_no}, ${row.dept}, ${row.email}, ${row.section_key})
      `;
    }

    console.log(`✓ Imported ${rows.length} rows from ${file} as section "${sectionKey}"`);
  }

  console.log('\nDone. All CSVs imported into student_roster.');
}

importRoster().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});