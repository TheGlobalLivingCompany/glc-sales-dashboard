// scripts/build-standalone.js
//
// Produces GLC-Sales-Dashboard.html — a single self-contained file with the
// data and commentary inlined, suitable for emailing as an attachment.
// Recipients can double-click it and view the dashboard offline.
//
// This file is NOT committed to the repo (the workflow's git adds are
// explicit), it's only built for the email step. dashboard.html itself
// is never modified.
import fs from 'fs';
const OUT = 'GLC-Sales-Dashboard.html';
if (!fs.existsSync('dashboard.html') || !fs.existsSync('data.js')) {
  console.error('dashboard.html or data.js missing — cannot build standalone file.');
  process.exit(1);
}
let html = fs.readFileSync('dashboard.html', 'utf8');
const dataJs = fs.readFileSync('data.js', 'utf8');
// Inline data.js
const dataTag = '<script src="data.js"></script>';
if (!html.includes(dataTag)) {
  console.error('Could not find the data.js include in dashboard.html — aborting.');
  process.exit(1);
}
html = html.replace(dataTag, '<script>\n' + dataJs + '\n</script>');
// Inline commentary.js if it exists (it may not, before the first agent run)
const commentaryTagMatch = html.match(/<script src="commentary\.js"[^>]*><\/script>/);
if (commentaryTagMatch) {
  const inline = fs.existsSync('commentary.js')
    ? '<script>\n' + fs.readFileSync('commentary.js', 'utf8') + '\n</script>'
    : ''; // no commentary yet — the card hides itself
  html = html.replace(commentaryTagMatch[0], inline);
}
// Inline reminders.js if it exists (same pattern)
const remindersTagMatch = html.match(/<script src="reminders\.js"[^>]*><\/script>/);
if (remindersTagMatch) {
  const inline = fs.existsSync('reminders.js')
    ? '<script>\n' + fs.readFileSync('reminders.js', 'utf8') + '\n</script>'
    : '';
  html = html.replace(remindersTagMatch[0], inline);
}
// Inline projects-data.js if it exists (same pattern — Projects tab shows its own
// setup notice if this hasn't been generated yet)
const projectsTagMatch = html.match(/<script src="projects-data\.js"[^>]*><\/script>/);
if (projectsTagMatch) {
  const inline = fs.existsSync('projects-data.js')
    ? '<script>\n' + fs.readFileSync('projects-data.js', 'utf8') + '\n</script>'
    : '';
  html = html.replace(projectsTagMatch[0], inline);
}
// Inline pipeline-history.js if it exists (same pattern)
const pipelineTagMatch = html.match(/<script src="pipeline-history\.js"[^>]*><\/script>/);
if (pipelineTagMatch) {
  const inline = fs.existsSync('pipeline-history.js')
    ? '<script>\n' + fs.readFileSync('pipeline-history.js', 'utf8') + '\n</script>'
    : '';
  html = html.replace(pipelineTagMatch[0], inline);
}
fs.writeFileSync(OUT, html);
console.log(`Built ${OUT} (${(html.length / 1024).toFixed(0)} KB), fully self-contained.`);
