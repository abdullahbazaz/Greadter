# AI check data

Teachers start the check with **Run AI check** on a submission, or **Run AI check on selected** in
the list. `POST /api/ai_check { id, text }` sends the PDF to the model (backend/ai.js), then writes
two columns on `submissions`:

## `ai_review` (teachers only, never sent to students)

```jsonc
{
  "status": "done",                  // "processing" | "done" | "failed"
  "started_at": "2026-11-13T09:30:00Z",
  "checked_at": "2026-11-13T09:31:10Z",
  "model": "claude-opus-5-5",
  "error": "…",                      // only when status = "failed"; shown to the teacher
  "text": "plain text of the PDF",   // extracted in the teacher's browser; used for similarity
  "suggested_marks": 14,             // never higher than the topic's total marks
  "criteria": [ { "name": "Meets the requirements", "marks": 6, "out_of": 8, "comment": "…" } ],
  "summary": "Overall comment for the teacher.",
  "ai_text": {                       // a weak signal: detectors misjudge real writing
    "likelihood": 62, "reasons": "…",
    "passages": [ { "page": 2, "quote": "exact words" } ]   // shown to teachers as yellow highlights
  },
  "similarity": [                    // plain text comparison with the same topic, no AI
    { "submission_id": "s…", "pct": 48, "passages": [ { "other_quote": "matching words" } ] }
  ]
}
```

`ai_marks` mirrors `suggested_marks` and `similarity_pct` the highest `similarity[].pct`, so lists
and the CSV export don't need to read the JSON.

## `annotations` (the issues; students see them once published)

Each check replaces the previous AI issues (`source: "ai"`) and keeps the teacher's own. Teachers
can delete any issue and add their own by selecting text or drawing a box around a diagram.
Shape and validation: backend/annotations.js.

```jsonc
[
  {
    "id": "ai3",
    "page": 1,
    "kind": "text",                 // "text" | "region" (a box around a diagram, figure or table)
    "category": "fact",             // spelling | grammar | fact | logic | requirement | diagram | other
    "quote": "a linked list stores in arrays",
    "note": "Linked lists store nodes linked by pointers, not in an array.",   // the dropdown text
    "suggestion": "Each node holds a value and a pointer to the next node.",
    "rects": [[0.12, 0.31, 0.42, 0.018]],   // fractions of the page, top-left origin
    "source": "ai"                  // "ai" | "teacher" (students don't receive this field)
  }
]
```

AI text issues arrive with a `quote` and no `rects`; the review page finds the quote on the page
the first time a teacher opens it and saves the positions. Issues it can't find stay in the list
(and on the notes page of the marked PDF) without a red mark.

The marked PDF students download (`GET /api/marked_pdf?id=`) is built on request from the original
file plus `annotations`: red boxes, numbers, and a "Teacher's notes" page at the end.
