import { readdir, stat, mkdir, copyFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const inboxDir = path.resolve("data/inbox");
const reportsDir = path.resolve("data/reports");
const room = process.env.APPROVED_ROOM || "희영이";
const externalSearch = process.env.EXTERNAL_SEARCH || "ask_first";
const intervalMs = Number(process.env.WATCH_INTERVAL_MS || 5000);

let lastProcessed = "";
let running = false;

async function latestExportFile() {
  await mkdir(inboxDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });

  const entries = await readdir(inboxDir);
  const txtFiles = [];

  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".txt")) continue;
    const fullPath = path.join(inboxDir, entry);
    const fileStat = await stat(fullPath);
    if (fileStat.isFile()) {
      txtFiles.push({ path: fullPath, mtimeMs: fileStat.mtimeMs });
    }
  }

  txtFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return txtFiles[0] || null;
}

function runAnalyzer(filePath) {
  return new Promise((resolve, reject) => {
    const reportPath = path.join(reportsDir, "latest-report.md");
    const child = spawn(process.execPath, [
      "export_analyzer.js",
      `--file=${filePath}`,
      `--room=${room}`,
      `--external_search=${externalSearch}`,
      `--output=${reportPath}`
    ], {
      cwd: process.cwd(),
      stdio: "inherit"
    });

    child.on("exit", (code) => {
      if (code === 0) resolve(reportPath);
      else reject(new Error(`export_analyzer exited with code ${code}`));
    });
  });
}

async function tick() {
  if (running) return;
  running = true;

  try {
    const latest = await latestExportFile();
    if (!latest || latest.path === lastProcessed) return;

    lastProcessed = latest.path;
    console.log(`New Kakao export detected: ${latest.path}`);
    const reportPath = await runAnalyzer(latest.path);
    await copyFile(reportPath, path.resolve("report.md"));
    console.log(`Updated latest report: ${reportPath}`);
  } catch (error) {
    console.error(`Watch failed: ${error.message}`);
  } finally {
    running = false;
  }
}

console.log(`Watching ${inboxDir}`);
console.log(`Approved room/contact: ${room}`);
console.log(`External search mode: ${externalSearch}`);
console.log("Drop a KakaoTalk exported .txt file into data/inbox to update the report.");

await tick();
setInterval(tick, intervalMs);
