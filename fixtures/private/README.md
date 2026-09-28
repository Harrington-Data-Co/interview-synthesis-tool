# Private fixtures

Real transcript exports, kept here to check the parsers against the formats
that actually arrive. Everything in this folder except this README is
gitignored: these are client interviews and must not be committed, pushed, or
pasted into tests. Committed tests use the synthetic files in `fixtures/`.

Drop exports in as they come, one folder per project if that helps:

| Source | When it's used | Expected export |
|---|---|---|
| Google Meet | Meetings Ryan owns | Transcript Google Doc, downloaded as `.docx` |
| Wispr Flow | Meetings Ryan doesn't own | Whatever Wispr Flow exports |
| Zoom | Occasionally sent by clients | `.vtt` |
| Teams | Occasionally sent by clients | `.vtt` or `.docx` |

Keep the original filenames. If a file needs anonymising before it goes here,
say so in a note next to it rather than editing it silently: the parser has
to handle what the tools really produce.
