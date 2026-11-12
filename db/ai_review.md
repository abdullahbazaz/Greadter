# `submissions.ai_review` — what the AI pipeline writes

The review page (`review.html`) reads this JSON. Teachers see it; students never do
(the student API uses an allow-list that excludes it). Every field is optional except
`status`; the page shows whatever is present.

```jsonc
{
  "status": "done",                 // "pending" | "processing" | "done" | "failed"
  "error": "Could not read the file", // only when status = "failed"; shown to the teacher
  "checked_at": "2026-11-12T09:30:00Z",
  "model": "name of the model or pipeline version",

  // The text the checks ran on, extracted from the uploaded file.
  // All "start"/"end" values below are character offsets into this string.
  "text": "Full extracted text …",

  // Suggested grade. The teacher accepts or changes it; it is never shown to students.
  "suggested_marks": 14,
  "criteria": [
    { "name": "Meets the requirements", "marks": 6, "out_of": 8, "comment": "Covers insertion and deletion, not traversal." }
  ],
  "summary": "One-paragraph overall comment, written for the teacher.",

  // Mistakes, in reading order. kind: "spelling" | "grammar" | "fact" | "logic" | "requirement".
  // "quote" is the exact text at [start, end); it is used to recover if offsets drift.
  "mistakes": [
    { "start": 120, "end": 151, "quote": "a linked list stores in arrays", "kind": "fact",
      "note": "Linked lists store nodes with pointers, not in a contiguous array.",
      "suggestion": "Each node holds a value and a pointer to the next node." }
  ],

  // Likelihood (0–100) that passages were AI-generated. A signal, not proof.
  "ai_text": { "likelihood": 62, "passages": [ { "start": 400, "end": 610 } ] },

  // Other submissions on the same topic with overlapping text.
  "similarity": [
    { "submission_id": "s…", "pct": 48,
      "passages": [ { "start": 700, "end": 860, "other_quote": "matching text from the other submission" } ] }
  ]
}
```

Also keep these plain columns in step so lists and the CSV export work without parsing JSON:
`ai_marks` = `suggested_marks`, `similarity_pct` = highest `similarity[].pct`,
`similarity_group` = a shared label for submissions that match each other.
